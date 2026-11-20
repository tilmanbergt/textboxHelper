/**
 * The Manuscript card's Review tab (technical-design-manuscript.md §4, §6; canvas row
 * "Manuscript").
 *
 * The page strip: every page of the note with its count of changes (✓ none, ? not read yet);
 * tapping a page shows only its changes (and reads it first), "Read n pages" reads the rest.
 * "Needs attention": pen text without a mark and marks that couldn't be used, one at a time with
 * Select mark › and Drop. Left: the changes in reading order, each with its changed text in full
 * and a few words of context, and Drop. Right, the side bar: the selected change (the first one on
 * open), with its text to correct, its edges and its actions; Drop asks there, so rows never change
 * height.
 */
import React, {useEffect, useMemo, useState} from 'react';
import {Pressable, StyleSheet, Text, View, type LayoutChangeEvent} from 'react-native';
import {dropItemOfIgnored, dropItemOfOperation, type DropItem} from '../../actions/editMarkerDrop';
import {chipLabel, unreadPages, type AttentionItem, type ManuscriptEntry} from '../../domain/manuscriptPages';
import {firstWords, lastWords} from '../../domain/markerHunks';
import type {ChangeHunk, PenTextState} from '../../domain/markerTypes';
import {plural} from '../../domain/plural';
import {estimateLines, segmentsText} from '../../domain/textPages';
import ChipRow from '../../ui/ChipRow';
import PagedSection from '../../ui/PagedSection';
import PillButton from '../../ui/PillButton';
import {renderSegments} from '../../ui/Segments';
import {COLORS, FONT, LINE_HEIGHT, RADII, SPACING} from '../../ui/theme';
import ChangeSide, {DropConfirm} from './ChangeSide';
import type {ManuscriptReview} from './useManuscriptReview';

/** Words of context a list row shows on each side of a change. */
const ROW_CONTEXT_WORDS = 6;
/** The row's border width (the selected row's frame), top and bottom. */
const ROW_BORDER = 2;
/** Room a row needs besides its text: border, padding, the label line, the meta line, a spare. */
const ROW_CHROME = 2 * ROW_BORDER + 2 * SPACING.sm + 2 * LINE_HEIGHT.small + SPACING.sm;
/** Width taken from a row's text: the number (32), the Drop button (generous), the gaps, padding and border. */
const ROW_SIDES = 32 + 96 + 2 * SPACING.md + 2 * (SPACING.sm + ROW_BORDER);
/** Average character width of the row text as a share of its size; generous, as changes are bold. */
const ROW_CHAR_WIDTH_SHARE = 0.6;

type PageFilter = 'all' | `${number}`;
type PendingDrop = {title: string; page: number; items: DropItem[]; withHandwriting: boolean; forAttention: boolean};

interface Props {
  review: ManuscriptReview;
  onClose: () => void;
  /** The pen edit whose mark was just selected (Select mark): shown first. */
  focusPenEditId: string | null;
  /** True while a text is being corrected or Drop asks: Apply waits. */
  onBlockedChange: (blocked: boolean) => void;
  /** A page to show (from the Outline's "Review its edits"). */
  showPage: number | null;
  /** Close the card and show a page of the note in NOTE. */
  onGoToPage: (page: number) => void;
}

export default function ReviewTab({
  review,
  onClose,
  focusPenEditId,
  onBlockedChange,
  showPage,
  onGoToPage,
}: Props): React.JSX.Element {
  const {note, pages, view, loading, busy, applied} = review;
  const [editing, setEditing] = useState(false);
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [attentionIndex, setAttentionIndex] = useState(0);
  const [listWidth, setListWidth] = useState(0);
  const [pageFilter, setPageFilter] = useState<PageFilter>('all');

  useEffect(() => onBlockedChange(editing || !!pendingDrop), [editing, onBlockedChange, pendingDrop]);
  useEffect(() => {
    if (showPage !== null) {
      setPageFilter(`${showPage}`);
    }
  }, [showPage]);

  const entries = useMemo(() => onPage(view.entries, pageFilter), [view.entries, pageFilter]);
  const attention = useMemo(() => onPage(view.attention, pageFilter), [view.attention, pageFilter]);
  useEffect(() => setPendingDrop(null), [view]);

  // A new set of changes selects the first one (or the one whose mark was just selected); a pen
  // edit's text arriving re-assembles the list but keeps the selection.
  const changeKey = entries.map(entry => entry.key).join('|');
  const focused = focusPenEditId
    ? view.entries.find(entry => entry.operation.penEditId === focusPenEditId) ?? null
    : null;
  const firstKey = focused?.key ?? entries[0]?.key ?? null;
  useEffect(() => {
    setSelectedKey(firstKey);
    setAttentionIndex(0);
  }, [changeKey, firstKey]);

  const selected = entries.find(entry => entry.key === selectedKey) ?? entries[0] ?? null;
  const selectedPreview = selected ? pages[selected.page] : undefined;
  const selectedPen =
    selected?.operation.penEditId && selectedPreview?.state === 'read'
      ? selectedPreview.preview.penEdits.find(penEdit => penEdit.id === selected.operation.penEditId) ?? null
      : null;
  const {setSelectedPenEdit} = review;
  // The selected pen edit is recognized first.
  useEffect(() => {
    setSelectedPenEdit(selected?.operation.penEditId ?? null);
  }, [selected?.operation.penEditId, setSelectedPenEdit]);

  const select = (key: string) => {
    setEditing(false);
    setPendingDrop(null);
    setSelectedKey(key);
  };
  const askDrop = (title: string, page: number, items: DropItem[], forAttention: boolean) => {
    setEditing(false);
    setPendingDrop({title, page, items, withHandwriting: items.some(item => !!item.penEditId), forAttention});
  };
  const dropConfirm = pendingDrop ? (
    <DropConfirm
      title={pendingDrop.title}
      withHandwriting={pendingDrop.withHandwriting}
      busy={busy}
      onDrop={erase => {
        const {page, items} = pendingDrop;
        setPendingDrop(null);
        review.drop(page, items, erase);
      }}
      onCancel={() => setPendingDrop(null)}
    />
  ) : null;

  const pageCount = note?.pageCount ?? 0;
  const unread = unreadPages(pageCount, pages);
  const choosePage = (key: PageFilter) => {
    setPageFilter(key);
    const page = Number(key);
    if (key !== 'all' && unread.includes(page)) {
      review.readPages([page]);
    } else if (key !== 'all') {
      // A page read before is checked again in the background; its list updates if it changed.
      review.recheckPage(page);
    }
  };

  const textWidth = Math.max(160, listWidth - ROW_SIDES);
  const rowHeight = (entry: ManuscriptEntry) =>
    ROW_CHROME +
    estimateLines(rowText(entry.hunk), textWidth, FONT.medium, ROW_CHAR_WIDTH_SHARE) * LINE_HEIGHT.medium;
  // The page "Go to page" opens: the chosen page, else the selected change's page.
  const shownPage = pageFilter !== 'all' ? Number(pageFilter) : selected?.page ?? null;
  const header =
    pageFilter === 'all'
      ? applied
        ? 'Applied'
        : `Edits on ${plural(pageCount - unread.length, 'page')} read`
      : `Edits on page ${Number(pageFilter) + 1}`;

  return (
    <View style={styles.tab}>
      {pageCount > 1 ? (
        <View style={styles.strip}>
          <ChipRow<PageFilter>
            chips={[
              {key: 'all', label: 'All'},
              ...Array.from({length: pageCount}, (_, page) => ({
                key: `${page}` as PageFilter,
                label: chipLabel(page, pages[page]),
                faint: unread.includes(page) || review.checking.includes(page),
                accessibilityLabel: `Page ${page + 1}`,
              })),
            ]}
            value={pageFilter}
            onChange={choosePage}
            trailing={
              <>
                {unread.length > 0 ? (
                  <PillButton
                    size="small"
                    label={`Read ${plural(unread.length, 'page')}`}
                    onPress={() => review.readPages(unread)}
                    disabled={loading || busy}
                  />
                ) : null}
                {shownPage !== null ? (
                  <PillButton
                    size="small"
                    label={`Go to page ${shownPage + 1} ›`}
                    onPress={() => onGoToPage(shownPage)}
                    disabled={busy}
                  />
                ) : null}
              </>
            }
          />
        </View>
      ) : null}
      {attention.length > 0 ? (
        <AttentionLine
          items={attention}
          index={Math.min(attentionIndex, attention.length - 1)}
          onIndex={setAttentionIndex}
          disabled={busy || loading || applied}
          onSelectMark={id => review.selectMark(id, onClose)}
          onDrop={item => {
            const dropItem = dropItemOfIgnored(item.marker);
            if (dropItem) {
              askDrop(`Drop ${item.marker.summary.toLowerCase()}?`, item.page, [dropItem], true);
            }
          }}
        />
      ) : null}
      <View style={styles.columns}>
        <View style={styles.list} onLayout={(event: LayoutChangeEvent) => setListWidth(event.nativeEvent.layout.width)}>
          {listWidth > 0 ? (
            <PagedSection
              header={header}
              rows={entries}
              rowHeight={rowHeight}
              resetKey={`${pageFilter}|${changeKey}`}
              emptyHint={loading ? 'Reading the marks…' : undefined}
              viewportContent={!loading && entries.length === 0 ? <EmptyState /> : undefined}
              renderRow={entry => {
                const dropItem = !applied ? dropItemOfOperation(entry.operation) : null;
                return (
                  <HunkRow
                    key={entry.key}
                    hunk={entry.hunk}
                    page={pageCount > 1 ? entry.page : null}
                    number={entries.indexOf(entry) + 1}
                    height={rowHeight(entry)}
                    selected={entry.key === selected?.key}
                    onPress={() => select(entry.key)}
                    onDrop={
                      dropItem
                        ? () => {
                            select(entry.key);
                            askDrop(`Drop ${entry.hunk.label.toLowerCase()}?`, entry.page, [dropItem], false);
                          }
                        : null
                    }
                    disabled={busy || loading}
                  />
                );
              }}
            />
          ) : null}
        </View>
        <View style={styles.side}>
          {pendingDrop?.forAttention ? (
            dropConfirm
          ) : selected ? (
            <ChangeSide
              operation={selected.operation}
              hunk={selected.hunk}
              pen={
                selectedPen
                  ? {
                      view: selectedPen,
                      status: selected.operation.penStatus ?? 'recognizing',
                      text: penTextNow(review.penStates[selectedPen.id]),
                    }
                  : null
              }
              editing={editing && !!selectedPen}
              onEditing={setEditing}
              busy={busy || applied}
              onSaveText={text => selectedPen && review.correct(selectedPen.id, text)}
              onRecognizeAgain={() => selectedPen && review.recognizeAgain(selectedPen.id)}
              onNudge={(edge, delta) => review.nudge(selected.operation, edge, delta)}
              onFixCase={fixCase => review.setFixCase(selected.operation.id, fixCase)}
              onDrop={
                !applied && dropItemOfOperation(selected.operation)
                  ? () =>
                      askDrop(
                        `Drop ${selected.hunk.label.toLowerCase()}?`,
                        selected.page,
                        [dropItemOfOperation(selected.operation) as DropItem],
                        false,
                      )
                  : null
              }
              dropConfirm={dropConfirm}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}

/** What the header says about the review: pages, edits, recognizing, attention. */
export function reviewContext(review: ManuscriptReview): string {
  const {note, view, loading} = review;
  return [
    note && note.pageCount > 1 ? plural(note.pageCount, 'page') : note ? `Page ${note.currentPage + 1}` : null,
    loading && view.entries.length === 0 ? null : plural(view.entries.length, 'edit'),
    view.pendingCount > 0 ? `${view.pendingCount} recognizing` : null,
    view.attention.length > 0 ? `${view.attention.length} need${view.attention.length === 1 ? 's' : ''} attention` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The items on the chosen page, or all. */
function onPage<T extends {page: number}>(items: T[], filter: PageFilter): T[] {
  return filter === 'all' ? items : items.filter(item => `${item.page}` === filter);
}

/** A row's text: a few words before, the change in full, a few words after. */
function rowText(hunk: ChangeHunk): string {
  return `${lastWords(hunk.before, ROW_CONTEXT_WORDS)}${segmentsText(hunk.segments)}${firstWords(
    hunk.after,
    ROW_CONTEXT_WORDS,
  )}`;
}

/** The text a snippet has now: the correction, else the recognition. */
function penTextNow(state: PenTextState | undefined): string {
  return state ? (state.correctedText ?? state.text).trim() : '';
}

function HunkRow({
  hunk,
  page,
  number,
  height,
  selected,
  onPress,
  onDrop,
  disabled,
}: {
  hunk: ChangeHunk;
  /** Shown before the place when the note has several pages. */
  page: number | null;
  number: number;
  height: number;
  selected: boolean;
  onPress: () => void;
  onDrop: (() => void) | null;
  disabled: boolean;
}): React.JSX.Element {
  return (
    <View style={[styles.row, {height}, selected && styles.rowSelected]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{selected}}
        accessibilityLabel={`${hunk.label}, ${hunk.meta}`}
        onPress={onPress}
        style={styles.rowMain}>
        <Text style={styles.number}>{number}</Text>
        <View style={styles.rowBody}>
          <Text style={styles.kind}>{hunk.label}</Text>
          <Text style={styles.rowText}>
            {lastWords(hunk.before, ROW_CONTEXT_WORDS)}
            {renderSegments(hunk.segments)}
            {firstWords(hunk.after, ROW_CONTEXT_WORDS)}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {page !== null ? `p.${page + 1} · ${hunk.meta}` : hunk.meta}
          </Text>
        </View>
      </Pressable>
      {onDrop ? <PillButton size="small" label="Drop" onPress={onDrop} disabled={disabled} /> : null}
    </View>
  );
}

/** One item that needs attention at a time, with ‹ › when there are more. */
function AttentionLine({
  items,
  index,
  onIndex,
  disabled,
  onSelectMark,
  onDrop,
}: {
  items: AttentionItem[];
  index: number;
  onIndex: (index: number) => void;
  disabled: boolean;
  onSelectMark: (penEditId: string) => void;
  onDrop: (item: AttentionItem) => void;
}): React.JSX.Element {
  const {page, marker: item} = items[index];
  const name = `p.${page + 1} · ${item.penEditNumber !== undefined ? item.summary : `Mark ${item.markerNumInPage}`}`;
  return (
    <View style={styles.attention}>
      <Text style={styles.attentionTitle}>Needs attention</Text>
      <Text style={styles.attentionText} numberOfLines={2}>
        <Text style={styles.attentionName}>{name}: </Text>
        {item.reason}
      </Text>
      {item.penEditId ? (
        <PillButton
          size="small"
          label="Select mark ›"
          onPress={() => onSelectMark(item.penEditId as string)}
          disabled={disabled}
        />
      ) : null}
      {dropItemOfIgnored(item) ? (
        <PillButton size="small" label="Drop" onPress={() => onDrop(items[index])} disabled={disabled} />
      ) : null}
      {items.length > 1 ? (
        <View style={styles.attentionPager}>
          <PillButton
            size="small"
            label="‹"
            accessibilityLabel="Previous item"
            onPress={() => onIndex(index - 1)}
            disabled={index === 0}
          />
          <Text style={styles.meta}>
            {index + 1} / {items.length}
          </Text>
          <PillButton
            size="small"
            label="›"
            accessibilityLabel="Next item"
            onPress={() => onIndex(index + 1)}
            disabled={index === items.length - 1}
          />
        </View>
      ) : null}
    </View>
  );
}

function EmptyState(): React.JSX.Element {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>No edit marks on this page.</Text>
      <Text style={styles.meta}>
        Delete: draw a line through the words. Replace: add a small loop at its end, write the new
        words right after it, lasso them and tap the pen-text button. ? shows every mark.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tab: {
    flex: 1,
  },
  strip: {
    marginHorizontal: SPACING.xl,
    marginTop: SPACING.base,
  },
  columns: {
    flex: 1,
    flexDirection: 'row',
  },
  list: {
    flex: 1.25,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.base,
    paddingBottom: SPACING.sm,
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
  },
  side: {
    flex: 1,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.base,
    paddingBottom: SPACING.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.md,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    borderWidth: ROW_BORDER,
    borderColor: 'transparent',
    borderBottomColor: COLORS.border,
    borderRadius: RADII.md,
  },
  rowSelected: {
    borderColor: COLORS.accent,
    borderBottomColor: COLORS.accent,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    gap: SPACING.md,
  },
  number: {
    width: 32,
    height: 32,
    borderWidth: 2,
    borderColor: COLORS.muted,
    borderRadius: 16,
    textAlign: 'center',
    lineHeight: 28,
    fontSize: FONT.small,
    color: COLORS.muted,
  },
  rowBody: {
    flex: 1,
  },
  kind: {
    fontSize: FONT.small - 2,
    lineHeight: LINE_HEIGHT.small,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: COLORS.muted,
  },
  rowText: {
    fontSize: FONT.medium,
    lineHeight: LINE_HEIGHT.medium,
    color: COLORS.text,
  },
  meta: {
    fontSize: FONT.small,
    lineHeight: LINE_HEIGHT.small,
    color: COLORS.muted,
  },
  attention: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginHorizontal: SPACING.xl,
    marginTop: SPACING.base,
    padding: SPACING.sm,
    borderWidth: 2,
    borderColor: COLORS.accent,
    borderRadius: RADII.md,
  },
  attentionTitle: {
    fontSize: FONT.small,
    fontWeight: '700',
    color: COLORS.text,
  },
  attentionText: {
    flex: 1,
    fontSize: FONT.small,
    color: COLORS.text,
  },
  attentionName: {
    fontWeight: '700',
  },
  attentionPager: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  empty: {
    gap: SPACING.sm,
    paddingTop: SPACING.base,
  },
  emptyText: {
    fontSize: FONT.medium,
    color: COLORS.text,
  },
});
