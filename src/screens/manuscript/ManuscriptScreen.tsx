/**
 * The Manuscript card, Review (technical-design-manuscript.md §4, §6; canvas row "Manuscript").
 *
 * Above the list, "Needs attention": pen text without a usable mark, marks that couldn't be read,
 * one at a time with Select mark › and Drop. Left: every change of the page in reading order,
 * each with its changed text in full and a few words of context, and Drop. Right, the side bar:
 * the selected change (the first one on open), with its text to correct, its edges and its
 * actions; Drop asks there, so rows never change height. One button applies every ready change.
 * Details (calibration, diagnostics) is a sub-screen with the same state.
 */
import React, {useEffect, useMemo, useState} from 'react';
import {Pressable, StyleSheet, Text, View, type LayoutChangeEvent} from 'react-native';
import {dropItemOfIgnored, dropItemOfOperation, type DropItem} from '../../actions/editMarkerDrop';
import {firstWords, lastWords} from '../../domain/markerHunks';
import type {ChangeHunk, IgnoredEditMarker, PenTextState} from '../../domain/markerTypes';
import {plural} from '../../domain/plural';
import {segmentsText} from '../../domain/textPages';
import PagedSection from '../../ui/PagedSection';
import PillButton from '../../ui/PillButton';
import ScreenFrame from '../../ui/ScreenFrame';
import {renderSegments} from '../../ui/Segments';
import {COLORS, FONT, LINE_HEIGHT, RADII, SPACING} from '../../ui/theme';
import ChangeSide, {DropConfirm} from './ChangeSide';
import ManuscriptDetailsScreen from './ManuscriptDetailsScreen';
import {useManuscriptReview} from './useManuscriptReview';

/** Words of context a list row shows on each side of a change. */
const ROW_CONTEXT_WORDS = 6;
/** Room a row needs besides its text: padding, the label line, the meta line. */
const ROW_CHROME = 2 * SPACING.sm + 2 * LINE_HEIGHT.small + SPACING.xs;
/** Width taken from a row's text by the number, the Drop button and the gaps. */
const ROW_SIDES = 44 + 96 + 3 * SPACING.md;
/** An average character of the body font, a little generous so rows are never cut. */
const CHAR_WIDTH = FONT.medium * 0.56;

type PendingDrop = {title: string; items: DropItem[]; withHandwriting: boolean; forAttention: boolean};

interface Props {
  onClose: () => void;
  /** The pen edit whose mark was just selected (Select mark): shown first. */
  focusPenEditId?: string | null;
}

export default function ManuscriptScreen({onClose, focusPenEditId = null}: Props): React.JSX.Element {
  const review = useManuscriptReview();
  const {preview, loading, busy, applied} = review;
  const [view, setView] = useState<'review' | 'details'>('review');
  const [editing, setEditing] = useState(false);
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [attentionIndex, setAttentionIndex] = useState(0);
  const [listWidth, setListWidth] = useState(0);

  const operations = useMemo(() => preview?.operations ?? [], [preview]);
  const hunks = useMemo(() => preview?.hunks ?? [], [preview]);
  const attention = useMemo(() => preview?.ignoredMarkers ?? [], [preview]);
  useEffect(() => setPendingDrop(null), [preview?.base]);

  // A new set of changes selects the first one (or the one whose mark was just selected); a pen
  // edit's text arriving re-assembles the preview but keeps the selection.
  const changeKey = hunks.map(hunk => hunk.operationId).join('|');
  const focused = focusPenEditId
    ? operations.find(operation => operation.penEditId === focusPenEditId) ?? null
    : null;
  const firstId = focused?.id ?? hunks[0]?.operationId ?? null;
  useEffect(() => {
    setSelectedId(firstId);
    setAttentionIndex(0);
  }, [changeKey, firstId]);

  const selectedHunk = hunks.find(hunk => hunk.operationId === selectedId) ?? hunks[0] ?? null;
  const selected = selectedHunk
    ? operations.find(operation => operation.id === selectedHunk.operationId) ?? null
    : null;
  const selectedPen = selected?.penEditId
    ? preview?.penEdits.find(penEdit => penEdit.id === selected.penEditId) ?? null
    : null;
  const {setSelectedPenEdit} = review;
  // The selected pen edit is recognized first.
  useEffect(() => {
    setSelectedPenEdit(selected?.penEditId ?? null);
  }, [selected?.penEditId, setSelectedPenEdit]);

  const focusNote =
    !focusPenEditId || loading
      ? null
      : focused
      ? 'Mark found: the change is in the list now.'
      : attention.some(marker => marker.penEditId === focusPenEditId)
      ? 'Mark selected, but the text still needs attention: see the line above the list.'
      : null;

  if (view === 'details') {
    return <ManuscriptDetailsScreen review={review} onBack={() => setView('review')} onClose={onClose} />;
  }

  const select = (operationId: string) => {
    setEditing(false);
    setPendingDrop(null);
    setSelectedId(operationId);
  };
  const askDrop = (title: string, items: DropItem[], forAttention: boolean) => {
    setEditing(false);
    setPendingDrop({title, items, withHandwriting: items.some(item => !!item.penEditId), forAttention});
  };
  const dropConfirm = pendingDrop ? (
    <DropConfirm
      title={pendingDrop.title}
      withHandwriting={pendingDrop.withHandwriting}
      busy={busy}
      onDrop={erase => {
        const items = pendingDrop.items;
        setPendingDrop(null);
        review.drop(items, erase);
      }}
      onCancel={() => setPendingDrop(null)}
    />
  ) : null;

  const readyCount = preview?.applyPlan?.operations.length ?? 0;
  const pendingCount = preview?.pendingCount ?? 0;
  const page = preview?.base ? `Page ${preview.base.page + 1}` : 'This page';
  const context = [
    page,
    loading && !preview ? null : plural(hunks.length, 'edit'),
    pendingCount > 0 ? `${pendingCount} recognizing` : null,
    attention.length > 0 ? `${attention.length} need${attention.length === 1 ? 's' : ''} attention` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const primary = applied
    ? {label: 'Close', onPress: onClose}
    : {
        label: readyCount > 0 ? `Apply ${plural(readyCount, 'edit')}` : 'Nothing to apply',
        onPress: review.apply,
        disabled: !preview?.canApply || loading || editing || !!pendingDrop,
        busy,
        busyLabel: 'Applying…',
      };

  const charsPerLine = Math.max(20, Math.floor((listWidth - ROW_SIDES) / CHAR_WIDTH));
  const rowHeight = (hunk: ChangeHunk) =>
    ROW_CHROME + Math.ceil(rowText(hunk).length / charsPerLine) * LINE_HEIGHT.medium;

  return (
    <ScreenFrame
      title="Manuscript"
      context={context}
      actions={[{label: 'Details', onPress: () => setView('details')}]}
      help={{title: 'Edit marks', marks: true}}
      onClose={onClose}
      status={review.status ?? (focusNote ? {text: focusNote} : null)}
      primary={primary}
      screenKey="manuscript-review">
      {attention.length > 0 ? (
        <AttentionLine
          items={attention}
          index={Math.min(attentionIndex, attention.length - 1)}
          onIndex={setAttentionIndex}
          disabled={busy || loading || applied}
          onSelectMark={id => review.selectMark(id, onClose)}
          onDrop={marker => {
            const item = dropItemOfIgnored(marker);
            if (item) {
              askDrop(`Drop ${marker.summary.toLowerCase()}?`, [item], true);
            }
          }}
        />
      ) : null}
      <View style={styles.columns}>
        <View
          style={styles.list}
          onLayout={(event: LayoutChangeEvent) => setListWidth(event.nativeEvent.layout.width)}>
          {listWidth > 0 ? (
            <PagedSection
              header={applied ? 'Applied' : 'Edits on this page'}
              rows={hunks}
              rowHeight={rowHeight}
              resetKey={changeKey}
              emptyHint={loading ? 'Reading the marks…' : undefined}
              viewportContent={!loading && hunks.length === 0 ? <EmptyState /> : undefined}
              renderRow={hunk => {
                const operation = operations.find(item => item.id === hunk.operationId);
                const dropItem = operation && !applied ? dropItemOfOperation(operation) : null;
                return (
                  <HunkRow
                    key={hunk.operationId}
                    hunk={hunk}
                    number={hunks.indexOf(hunk) + 1}
                    height={rowHeight(hunk)}
                    selected={hunk.operationId === selectedHunk?.operationId}
                    onPress={() => select(hunk.operationId)}
                    onDrop={
                      dropItem
                        ? () => {
                            select(hunk.operationId);
                            askDrop(`Drop ${hunk.label.toLowerCase()}?`, [dropItem], false);
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
          ) : selected && selectedHunk ? (
            <ChangeSide
              operation={selected}
              hunk={selectedHunk}
              pen={
                selectedPen
                  ? {
                      view: selectedPen,
                      status: selected.penStatus ?? 'recognizing',
                      text: penTextNow(review.penStates[selectedPen.id]),
                    }
                  : null
              }
              editing={editing && !!selectedPen}
              onEditing={setEditing}
              busy={busy || applied}
              onSaveText={text => selectedPen && review.correct(selectedPen.id, text)}
              onRecognizeAgain={() => selectedPen && review.recognizeAgain(selectedPen.id)}
              onNudge={(edge, delta) => review.nudge(selected, edge, delta)}
              onFixCase={fixCase => review.setFixCase(selected.id, fixCase)}
              onDrop={
                !applied && dropItemOfOperation(selected)
                  ? () =>
                      askDrop(`Drop ${selectedHunk.label.toLowerCase()}?`, [
                        dropItemOfOperation(selected) as DropItem,
                      ], false)
                  : null
              }
              dropConfirm={dropConfirm}
            />
          ) : null}
        </View>
      </View>
    </ScreenFrame>
  );
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
  number,
  height,
  selected,
  onPress,
  onDrop,
  disabled,
}: {
  hunk: ChangeHunk;
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
            {hunk.meta}
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
  items: IgnoredEditMarker[];
  index: number;
  onIndex: (index: number) => void;
  disabled: boolean;
  onSelectMark: (penEditId: string) => void;
  onDrop: (marker: IgnoredEditMarker) => void;
}): React.JSX.Element {
  const item = items[index];
  const name = item.penEditNumber !== undefined ? item.summary : `Mark ${item.markerNumInPage}`;
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
        <PillButton size="small" label="Drop" onPress={() => onDrop(item)} disabled={disabled} />
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
    borderWidth: 2,
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
