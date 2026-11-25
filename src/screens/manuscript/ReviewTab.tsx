/**
 * The Manuscript card's Review tab (technical-design-manuscript.md §4, §6; canvas row
 * "Manuscript").
 *
 * The page strip: every page of the note with its count of changes and items to decide (✓ none,
 * ? not read yet); tapping a page shows only its own (and reads it first), "Read n pages" reads
 * the rest. Four tabs, New text n · Marks m · To decide k · Notes j (technical-design-mark-dialogue.md
 * §5.3, §13.5; technical-design-comments-images.md §5.2). New text: the changes with tagged text, by their number on the page, which is
 * circled as on the page; Marks: the other changes in reading order, each with its kind's symbol.
 * Left, the changes, each with its changed text in full and a few words of context, and Drop; right, the side bar for the selected change, with its text to correct, its
 * edges and its actions. To decide: left, what the review can't make a change of on its own;
 * right, its side (`ToDecideSide`). Notes: the comments and images, which are no changes, and
 * their side (`NoteSide`). Drop asks in the side bar, so rows never change height.
 */
import React, {useEffect, useMemo, useState} from 'react';
import {Pressable, StyleSheet, Text, View, type LayoutChangeEvent} from 'react-native';
import {dropItemOfToDecide, dropItemOfOperation, type DropItem} from '../../actions/editMarkerDrop';
import {chipLabel, unreadPages, type ManuscriptEntry} from '../../domain/manuscriptPages';
import {firstWords, lastWords} from '../../domain/markerHunks';
import type {ChangeHunk, PenTextState} from '../../domain/markerTypes';
import {plural} from '../../domain/plural';
import {estimateLines, segmentsText} from '../../domain/textPages';
import {NO_MARKS} from '../../domain/helpTexts';
import {notesList, rowMarker, splitReviewLists} from '../../domain/reviewLists';
import ChipRow from '../../ui/ChipRow';
import CountTabs from '../../ui/CountTabs';
import EmptyState from '../../ui/EmptyState';
import PagedSection from '../../ui/PagedSection';
import PillButton from '../../ui/PillButton';
import {renderSegments} from '../../ui/Segments';
import {COLORS, FONT, LINE_HEIGHT, RADII, SPACING} from '../../ui/theme';
import ChangeSide, {DropConfirm, type PenDetail} from './ChangeSide';
import ToDecideList from './ToDecideList';
import ToDecideSide, {penOf} from './ToDecideSide';
import NotesList from './NotesList';
import NoteSide, {NoteDropConfirm} from './NoteSide';
import type {ManuscriptReview} from './useManuscriptReview';
import {useNotes} from './useNotes';

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
type ReviewList = 'text' | 'marks' | 'decide' | 'notes';
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
  /** The page shown (chosen, or the selected change's): Apply applies it (§5.6). */
  onPageShown: (page: number | null) => void;
}

export default function ReviewTab({
  review,
  onClose,
  focusPenEditId,
  onBlockedChange,
  showPage,
  onGoToPage,
  onPageShown,
}: Props): React.JSX.Element {
  const {note, pages, view, loading, busy, applied} = review;
  const [editing, setEditing] = useState(false);
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Null: New text when it has changes, else Marks (technical-design-mark-dialogue.md §13.5).
  const [chosenList, setList] = useState<ReviewList | null>(null);
  const [decideKey, setDecideKey] = useState<string | null>(null);
  const [noteKey, setNoteKey] = useState<string | null>(null);
  const [droppingNote, setDroppingNote] = useState(false);
  const notes = useNotes(review);
  const [listWidth, setListWidth] = useState(0);
  const [pageFilter, setPageFilter] = useState<PageFilter>('all');

  useEffect(() => onBlockedChange(editing || !!pendingDrop || droppingNote), [droppingNote, editing, onBlockedChange, pendingDrop]);
  useEffect(() => {
    if (showPage !== null) {
      setPageFilter(`${showPage}`);
    }
  }, [showPage]);

  const lists = useMemo(() => splitReviewLists(onPage(view.entries, pageFilter)), [view.entries, pageFilter]);
  const list: ReviewList = chosenList ?? (lists.text.length > 0 ? 'text' : 'marks');
  const entries = list === 'marks' ? lists.marks : lists.text;
  const toDecide = useMemo(() => onPage(view.toDecide, pageFilter), [view.toDecide, pageFilter]);
  const noteEntries = useMemo(() => notesList(onPage(view.notes, pageFilter)), [view.notes, pageFilter]);
  const noted = noteEntries.find(entry => entry.key === noteKey) ?? noteEntries[0] ?? null;
  useEffect(() => {
    setPendingDrop(null);
    setDroppingNote(false);
  }, [view]);

  // A new set of changes selects the first one (or the one whose mark was just selected); a pen
  // edit's text arriving re-assembles the list but keeps the selection.
  const changeKey = entries.map(entry => entry.key).join('|');
  const focused = focusPenEditId
    ? view.entries.find(entry => entry.operation.penEditId === focusPenEditId) ?? null
    : null;
  const firstKey = (focused && entries.includes(focused) ? focused.key : null) ?? entries[0]?.key ?? null;
  useEffect(() => {
    setSelectedKey(firstKey);
  }, [changeKey, firstKey]);
  const focusedList: ReviewList | null = focused ? (focused.operation.penEditId ? 'text' : 'marks') : null;
  useEffect(() => {
    if (focusedList) {
      setList(focusedList);
    }
  }, [focusedList, focusPenEditId]);
  // A text whose mark was selected but still can't be placed is shown in To decide.
  const focusedDecide = focusPenEditId && !focused ? view.toDecide.find(entry => entry.item.penEditId === focusPenEditId) ?? null : null;
  useEffect(() => {
    if (focusedDecide) {
      setList('decide');
      setDecideKey(focusedDecide.key);
    }
  }, [focusedDecide]);
  const decided = toDecide.find(entry => entry.key === decideKey) ?? toDecide[0] ?? null;
  const decidedReview = decided ? pages[decided.page] : undefined;
  const decidedPen =
    decided && decidedReview?.state === 'read' ? penOf(decidedReview.preview.penEdits, decided.item.penEditId) : null;

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
  const shownPage =
    pageFilter !== 'all'
      ? Number(pageFilter)
      : list === 'decide'
      ? decided?.page ?? null
      : list === 'notes'
      ? noted?.page ?? null
      : selected?.page ?? null;
  useEffect(() => onPageShown(shownPage), [onPageShown, shownPage]);
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
      <View style={styles.tabs}>
        <CountTabs<ReviewList>
          tabs={[
            {key: 'text', label: 'New text', count: lists.text.length},
            {key: 'marks', label: 'Marks', count: lists.marks.length},
            {key: 'decide', label: 'To decide', count: toDecide.length},
            {key: 'notes', label: 'Notes', count: noteEntries.length},
          ]}
          activeKey={list}
          onChange={key => {
            setEditing(false);
            setPendingDrop(null);
            setDroppingNote(false);
            setList(key);
          }}
        />
      </View>
      <View style={styles.columns}>
        <View style={styles.list} onLayout={(event: LayoutChangeEvent) => setListWidth(event.nativeEvent.layout.width)}>
          {list === 'notes' ? (
            <NotesList
              entries={noteEntries}
              selectedKey={noted?.key ?? null}
              onSelect={key => {
                setEditing(false);
                setNoteKey(key);
              }}
              penStates={review.penStates}
              severalPages={pageCount > 1}
              resetKey={`${pageFilter}|${noteEntries.map(entry => entry.key).join('|')}`}
            />
          ) : list === 'decide' ? (
            <ToDecideList
              entries={toDecide}
              selectedKey={decided?.key ?? null}
              onSelect={key => {
                setEditing(false);
                setPendingDrop(null);
                setDecideKey(key);
              }}
              penStates={review.penStates}
              severalPages={pageCount > 1}
              resetKey={`${pageFilter}|${toDecide.map(entry => entry.key).join('|')}`}
            />
          ) : listWidth > 0 ? (
            <PagedSection
              header={header}
              rows={entries}
              rowHeight={rowHeight}
              resetKey={`${pageFilter}|${changeKey}`}
              emptyHint={loading ? 'Reading the marks…' : list === 'text' ? 'No tagged text here.' : 'No other marks here.'}
              viewportContent={!loading && view.entries.length === 0 ? <EmptyState {...NO_MARKS} /> : undefined}
              renderRow={entry => {
                const dropItem = !applied ? dropItemOfOperation(entry.operation) : null;
                return (
                  <HunkRow
                    key={entry.key}
                    hunk={entry.hunk}
                    page={pageCount > 1 ? entry.page : null}
                    marker={rowMarker(entry)}
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
          {list === 'notes' ? (
            noted ? (
              <NoteSide
                entry={noted}
                pageRects={notes.paragraphs(noted.page).map(item => item.rect)}
                penState={review.penStates[noted.row.id] ?? null}
                busy={busy || loading || applied}
                editing={editing}
                onEditing={setEditing}
                onRead={() => review.readNote(noted.row.id, noted.page)}
                onSaveText={text => review.correct(noted.row.id, text)}
                onStep={direction => notes.step(noted.row, direction)}
                onDone={done => notes.setDone(noted.row, done)}
                onPlace={place => notes.setPlace(noted.row, place)}
                onUseAsText={() => notes.useAsText(noted.row)}
                onUpdateImage={() => notes.updateImage(noted.row)}
                onDrop={() => notes.drop(noted.row)}
              />
            ) : null
          ) : list === 'decide' ? (
            decided ? (
              <ToDecideSide
                entry={decided}
                pageRects={decidedReview?.state === 'read' ? decidedReview.preview.base?.pageRects ?? [] : []}
                pen={
                  decidedPen
                    ? {
                        view: decidedPen,
                        status: penStatusOf(review.penStates[decidedPen.id]),
                        text: penTextNow(review.penStates[decidedPen.id]),
                      }
                    : null
                }
                insert={decidedPen ? penTextNow(review.penStates[decidedPen.id]) : ''}
                busy={busy || loading || applied}
                editing={editing && !!decidedPen}
                onEditing={setEditing}
                onSaveText={text => decidedPen && review.correct(decidedPen.id, text)}
                onHere={(edges, option) => review.here(decided.page, decided.item, edges, option)}
                onSelectMark={() => decided.item.penEditId && review.selectMark(decided.item.penEditId, onClose)}
                onPlaceHere={() => decided.item.penEditId && review.placeHere(decided.page, decided.item.penEditId)}
                onKeepAs={kind => decided.item.penEditId && review.convert(decided.page, decided.item.penEditId, kind)}
                onStepParagraph={direction =>
                  decided.item.penEditId && notes.step({id: decided.item.penEditId, page: decided.page, at: null}, direction)
                }
                onIgnore={() => review.ignore(decided.page, decided.item)}
                onDrop={
                  decided.item.kind === 'noParagraph'
                    ? () => setDroppingNote(true)
                    : !applied && dropItemOfToDecide(decided.item)
                    ? () =>
                        askDrop(
                          decided.item.kind === 'unclear'
                            ? 'Remove these strokes from the page?'
                            : `Drop ${decided.item.summary.toLowerCase()}?`,
                          decided.page,
                          [dropItemOfToDecide(decided.item) as DropItem],
                          true,
                        )
                    : null
                }
                dropConfirm={
                  decided.item.kind === 'noParagraph' && droppingNote ? (
                    <NoteDropConfirm
                      kind={decided.item.summary === 'Image' ? 'image' : 'comment'}
                      busy={busy}
                      onDrop={() => {
                        setDroppingNote(false);
                        if (decided.item.penEditId) {
                          notes.drop({id: decided.item.penEditId, page: decided.page, at: null});
                        }
                      }}
                      onCancel={() => setDroppingNote(false)}
                    />
                  ) : pendingDrop?.forAttention ? (
                    dropConfirm
                  ) : null
                }
              />
            ) : null
          ) : selected ? (
            <ChangeSide
              operation={selected.operation}
              hunk={selected.hunk}
              result={
                selectedPreview?.state === 'read'
                  ? selectedPreview.preview.results[selected.operation.targetTextboxUuid] ?? null
                  : null
              }
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
              onRemovePunct={removePunct => review.setRemovePunct(selected.operation.id, removePunct)}
              onPunctChar={char => review.setPunctChar(selected.operation.id, char)}
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

/** What the header says about the review: pages, edits, recognizing, to decide. */
export function reviewContext(review: ManuscriptReview): string {
  const {note, view, loading} = review;
  return [
    note && note.pageCount > 1 ? plural(note.pageCount, 'page') : note ? `Page ${note.currentPage + 1}` : null,
    loading && view.entries.length === 0 ? null : plural(view.entries.length, 'edit'),
    view.pendingCount > 0 ? `${view.pendingCount} recognizing` : null,
    view.toDecide.length > 0 ? `${view.toDecide.length} to decide` : null,
    view.notes.length > 0 ? plural(view.notes.length, 'note') : null,
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

/** A To decide text's state for its pen text: being recognized until its text is known. */
function penStatusOf(state: PenTextState | undefined): PenDetail['status'] {
  if (!state || state.status === 'recognizing' || state.status === 'waiting') {
    return 'recognizing';
  }
  return state.status === 'done' ? 'ready' : state.status;
}

/** The text a snippet has now: the correction, else the recognition. */
function penTextNow(state: PenTextState | undefined): string {
  return state ? (state.correctedText ?? state.text).trim() : '';
}

function HunkRow({
  hunk,
  page,
  marker,
  height,
  selected,
  onPress,
  onDrop,
  disabled,
}: {
  hunk: ChangeHunk;
  /** Shown before the place when the note has several pages. */
  page: number | null;
  /** The number on the page in a circle (new text), or the kind's symbol (other marks). */
  marker: {circled: boolean; text: string};
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
        <Text style={marker.circled ? styles.number : styles.symbol}>{marker.text}</Text>
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

const styles = StyleSheet.create({
  tab: {
    flex: 1,
  },
  strip: {
    marginHorizontal: SPACING.xl,
    marginTop: SPACING.base,
  },
  tabs: {
    marginHorizontal: SPACING.xl,
    marginTop: SPACING.sm,
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
  symbol: {
    width: 32,
    textAlign: 'center',
    lineHeight: 32,
    fontSize: FONT.medium,
    fontWeight: '700',
    color: COLORS.text,
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
});
