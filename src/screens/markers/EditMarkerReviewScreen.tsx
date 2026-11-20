/**
 * Edit markers review (technical-design-calmer-screens.md §3.4, canvas "Edit markers · review").
 *
 * Left: the recognized changes and the ignored markers, as tabs with counts and a paged list.
 * Right: one affected textbox at a time, removed words struck through, replacements in bold; a
 * tap on a change shows its textbox at the page holding it. Below it, the change's detail
 * (`ChangeDetail`, technical-design-pen-edits-2.md §5–§7): a tagged snippet's handwriting and its
 * text, edited in place; the edge control; Skip for later, Recognize again and Drop, which asks in
 * the same place. Until a snippet's text is there, a grey placeholder stands in the text. Ignored
 * snippets offer Select mark. One button applies every ready change. Details (calibration,
 * diagnostics) is a sub-screen with the same state.
 */
import React, {useEffect, useMemo, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {
  dropItemOfIgnored,
  dropItemOfOperation,
  type DropItem,
} from '../../actions/editMarkerDrop';
import type {
  EditMarkerPreviewScope,
  IgnoredEditMarker,
  PenEditView,
  PenOperationStatus,
  PenTextState,
  RecognizedEditOperation,
} from '../../domain/markerTypes';
import {plural} from '../../domain/plural';
import CountTabs from '../../ui/CountTabs';
import PagedSection from '../../ui/PagedSection';
import PagedText from '../../ui/PagedText';
import PillButton from '../../ui/PillButton';
import ScreenFrame from '../../ui/ScreenFrame';
import {COLORS, FONT, SPACING} from '../../ui/theme';
import ChangeDetail, {DropConfirm} from './ChangeDetail';
import MarkerDetailsScreen from './MarkerDetailsScreen';
import {useEditMarkerReview} from './useEditMarkerReview';

type ListTab = 'changes' | 'ignored';

const ROW_HEIGHT = 96;

interface Props {
  scope: EditMarkerPreviewScope;
  onClose: () => void;
  /** The pen edit whose mark was just selected (Select mark): shown first. */
  focusPenEditId?: string | null;
}

export default function EditMarkerReviewScreen({
  scope,
  onClose,
  focusPenEditId = null,
}: Props): React.JSX.Element {
  const review = useEditMarkerReview(scope);
  const {preview, loading, busy, applied} = review;
  const [view, setView] = useState<'review' | 'details'>('review');
  // The recognized text of the selected snippet is being edited: the textbox makes room.
  const [editing, setEditing] = useState(false);
  // Drop asks first, in the detail area.
  const [pendingDrop, setPendingDrop] = useState<{
    title: string;
    items: DropItem[];
    withHandwriting: boolean;
  } | null>(null);
  const [tab, setTab] = useState<ListTab>('changes');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [jumpKey, setJumpKey] = useState(0);

  const operations = useMemo(() => preview?.operations ?? [], [preview]);
  const ignored = useMemo(() => preview?.ignoredMarkers ?? [], [preview]);
  const droppableIgnored = useMemo(
    () =>
      ignored
        .map(marker => ({marker, item: dropItemOfIgnored(marker)}))
        .filter(
          (entry): entry is {marker: IgnoredEditMarker; item: DropItem} =>
            !!entry.item,
        ),
    [ignored],
  );
  useEffect(() => setPendingDrop(null), [preview?.base, tab]);
  const askDrop = (title: string, items: DropItem[]) => {
    setEditing(false);
    setPendingDrop({
      title,
      items,
      withHandwriting: items.some(item => !!item.penEditId),
    });
  };
  const textboxes = useMemo(() => preview?.textboxes ?? [], [preview]);

  // A new set of changes selects its first one; with only ignored markers, the Ignored tab opens.
  // A pen edit's text arriving re-assembles the preview but keeps the selection.
  // After Select mark, the change of that snippet is selected (or the Ignored tab shows why not).
  const changeKey = operations.map(operation => operation.id).join('|');
  const focusedOperation = focusPenEditId
    ? operations.find(operation => operation.penEditId === focusPenEditId) ?? null
    : null;
  const focusedIgnored = focusPenEditId
    ? ignored.find(marker => marker.penEditId === focusPenEditId) ?? null
    : null;
  const firstId = focusedOperation?.id ?? operations[0]?.id ?? null;
  const onlyIgnored =
    (operations.length === 0 && ignored.length > 0) ||
    (!focusedOperation && !!focusedIgnored);
  useEffect(() => {
    setSelectedId(firstId);
    setTab(onlyIgnored ? 'ignored' : 'changes');
    setJumpKey(key => key + 1);
  }, [changeKey, firstId, onlyIgnored]);
  const focusNote =
    !focusPenEditId || loading
      ? null
      : focusedOperation
      ? `Mark found: ${kindLabel(focusedOperation).toLowerCase()} is in the changes now.`
      : focusedIgnored
      ? `Mark selected for ${focusedIgnored.summary.toLowerCase()}, but it is still ignored: see why on the left.`
      : null;

  const selected =
    operations.find(operation => operation.id === selectedId) ??
    operations[0] ??
    null;
  const textboxIndex = selected
    ? Math.max(
        0,
        textboxes.findIndex(
          textbox => textbox.uuid === selected.targetTextboxUuid,
        ),
      )
    : 0;
  const textbox = textboxes[textboxIndex] ?? null;
  const selectedPen: PenEditView | null = selected?.penEditId
    ? preview?.penEdits.find(penEdit => penEdit.id === selected.penEditId) ??
      null
    : null;
  const {setSelectedPenEdit} = review;

  // The selected pen edit is recognized first.
  useEffect(() => {
    setSelectedPenEdit(selected?.penEditId ?? null);
  }, [selected?.penEditId, setSelectedPenEdit]);

  const selectOperation = (operation: RecognizedEditOperation) => {
    setEditing(false);
    setPendingDrop(null);
    setSelectedId(operation.id);
    setJumpKey(key => key + 1);
  };

  const showNextTextbox = () => {
    const next = textboxes[(textboxIndex + 1) % textboxes.length];
    const first = operations.find(
      operation => operation.targetTextboxUuid === next.uuid,
    );
    if (first) {
      selectOperation(first);
    }
  };

  if (view === 'details') {
    return (
      <MarkerDetailsScreen
        review={review}
        scope={scope}
        onBack={() => setView('review')}
        onClose={onClose}
      />
    );
  }

  const readyCount = preview?.applyPlan?.operations.length ?? 0;
  const pendingCount = preview?.pendingCount ?? 0;
  const checkCount = operations.filter(operation => operation.uncertain).length;

  const context = [
    scope === 'page' ? 'Whole page' : 'Lasso selection',
    loading && !preview ? null : plural(operations.length, 'change'),
    pendingCount > 0 ? `${pendingCount} recognizing` : null,
    checkCount > 0 ? `${checkCount} to check` : null,
    ignored.length > 0 ? `${ignored.length} ignored` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const primary = applied
    ? {label: 'Close', onPress: onClose}
    : {
        label:
          readyCount > 0
            ? `Apply ${plural(readyCount, 'change')}`
            : 'Nothing to apply',
        onPress: review.apply,
        disabled: !preview?.canApply || loading || editing || !!pendingDrop,
        busy,
        busyLabel: 'Applying…',
      };

  return (
    <ScreenFrame
      title="Edit markers"
      context={context}
      actions={[{label: 'Details', onPress: () => setView('details')}]}
      help={{title: 'Edit markers', marks: true}}
      onClose={onClose}
      status={review.status ?? (focusNote ? {text: focusNote} : null)}
      primary={primary}
      screenKey={`review-${tab}`}>
      <View style={styles.columns}>
        <View style={styles.left}>
          <CountTabs
            tabs={[
              {key: 'changes', label: 'Changes', count: operations.length},
              {
                key: 'ignored',
                label: 'Ignored',
                count: ignored.length,
                hideWhenZero: true,
              },
            ]}
            activeKey={tab}
            onChange={setTab}
          />
          {tab === 'changes' ? (
            <PagedSection
              header={applied ? 'Applied' : 'Will change'}
              rows={operations}
              rowHeight={() => ROW_HEIGHT}
              resetKey={preview ? operations.length : undefined}
              emptyHint={
                loading ? 'Reading markers…' : 'No changes recognized.'
              }
              renderRow={operation => (
                <ChangeRow
                  key={operation.id}
                  operation={operation}
                  selected={operation.id === selected?.id}
                  onPress={() => selectOperation(operation)}
                />
              )}
            />
          ) : (
            <PagedSection
              header="Not used"
              headerAccessory={
                droppableIgnored.length > 1 && !applied ? (
                  <PillButton
                    size="small"
                    label={`Drop all (${droppableIgnored.length})`}
                    onPress={() =>
                      askDrop(
                        `Drop all ${droppableIgnored.length} ignored?`,
                        droppableIgnored.map(entry => entry.item),
                      )
                    }
                    disabled={busy || loading}
                  />
                ) : undefined
              }
              rows={ignored}
              rowHeight={() => ROW_HEIGHT}
              renderRow={marker => (
                <IgnoredRow
                  key={marker.markerUuid}
                  marker={marker}
                  onSelectMark={
                    marker.penEditId && !applied
                      ? () =>
                          review.selectMark(marker.penEditId as string, onClose)
                      : null
                  }
                  onDrop={
                    !applied && dropItemOfIgnored(marker)
                      ? () =>
                          askDrop(`Drop ${marker.summary.toLowerCase()}?`, [
                            dropItemOfIgnored(marker) as DropItem,
                          ])
                      : null
                  }
                  disabled={busy || loading}
                />
              )}
            />
          )}
        </View>
        <View style={styles.right}>
          {textbox && !editing ? (
            <>
              <PagedText
                header={
                  textbox.title ??
                  `Textbox ${textbox.numInPage} · ${plural(
                    textbox.changeCount,
                    'change',
                  )}`
                }
                headerAccessory={
                  textboxes.length > 1 ? (
                    <PillButton
                      size="small"
                      label={`Next textbox (${textboxIndex + 1}/${
                        textboxes.length
                      })`}
                      onPress={showNextTextbox}
                    />
                  ) : undefined
                }
                segments={textbox.segments}
                resetKey={textbox.uuid}
                jumpTo={
                  selected
                    ? {
                        key: `${jumpKey}-${selected.id}`,
                        index: selected.textStart,
                      }
                    : null
                }
              />
              <Text style={styles.legend}>
                Struck through: removed. Bold: new text. Grey: new text not
                there yet.
              </Text>
            </>
          ) : null}
          {pendingDrop ? (
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
          ) : selected && textbox && tab === 'changes' ? (
            <ChangeDetail
              operation={selected}
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
              onSaveText={text =>
                selectedPen && review.correct(selectedPen.id, text)
              }
              onSkip={skipped =>
                selectedPen && review.setSkipped(selectedPen.id, skipped)
              }
              onRecognizeAgain={() =>
                selectedPen && review.recognizeAgain(selectedPen.id)
              }
              onNudge={(edge, delta) => review.nudge(selected, edge, delta)}
              onFixCase={fixCase => review.setFixCase(selected.id, fixCase)}
              onDrop={
                !applied && dropItemOfOperation(selected)
                  ? () =>
                      askDrop(`Drop ${kindLabel(selected).toLowerCase()}?`, [
                        dropItemOfOperation(selected) as DropItem,
                      ])
                  : null
              }
            />
          ) : null}
          {!textbox && !pendingDrop ? (
            <EmptyState
              loading={loading}
              message={preview?.summaryMessage ?? ''}
            />
          ) : null}
        </View>
      </View>
    </ScreenFrame>
  );
}

/** The text a snippet has now: the correction, else the recognition. */
function penTextNow(state: PenTextState | undefined): string {
  return state ? (state.correctedText ?? state.text).trim() : '';
}

function ChangeRow({
  operation,
  selected,
  onPress,
}: {
  operation: RecognizedEditOperation;
  selected: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const words = operation.words.join(' ');
  const newText =
    operation.replacementText ??
    (operation.penStatus ? STATUS_TEXT[operation.penStatus] : '');
  const text =
    operation.kind === 'insert'
      ? newText
      : operation.kind === 'split'
      ? 'New paragraph from here'
      : operation.kind === 'space' || operation.kind === 'swap'
      ? operation.summary.replace(/^(Space|Swap) · /, '')
      : operation.kind === 'replace'
      ? `${words} → ${newText}`
      : words;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{selected}}
      onPress={onPress}
      style={[styles.row, selected && styles.rowSelected]}>
      <Text style={styles.kind}>{kindLabel(operation)}</Text>
      <Text style={styles.rowText} numberOfLines={1}>
        {text}
      </Text>
      <Text style={styles.rowMeta} numberOfLines={1}>
        {operation.kind === 'insert' ||
        operation.kind === 'split' ||
        operation.kind === 'space'
          ? operation.detail
          : `Textbox ${operation.targetTextboxNumInPage} · line ${
              operation.lineIndex + 1
            }`}
        {operation.uncertain ? ' · Check place' : ''}
        {operation.insideSwap ? ' · inside swap' : ''}
        {operation.swap?.waitingFor ? ' · waiting' : ''}
      </Text>
    </Pressable>
  );
}

const STATUS_TEXT: Record<PenOperationStatus, string> = {
  recognizing: 'recognizing…',
  ready: '',
  skipped: 'skipped for later',
  failed: 'not recognized',
  empty: 'no text recognized',
};

function kindLabel(operation: RecognizedEditOperation): string {
  if (operation.kind === 'insert') {
    return `Insert ${operation.penEditNumber ?? ''}`.trim();
  }
  if (operation.kind === 'split') {
    return 'Paragraph break';
  }
  if (operation.kind === 'space') {
    return 'Space';
  }
  if (operation.kind === 'swap') {
    return 'Swap';
  }
  if (operation.kind === 'replace') {
    return operation.penEditNumber !== undefined
      ? `Replace ${operation.penEditNumber}`
      : 'Replace';
  }
  return 'Delete';
}

function IgnoredRow({
  marker,
  disabled,
  onDrop,
  onSelectMark,
}: {
  marker: IgnoredEditMarker;
  disabled: boolean;
  /** Null when the strokes may be ordinary handwriting: they are never offered for removal. */
  onDrop: (() => void) | null;
  /** Pen edits only: wait for a mark drawn or lassoed on the page (the review closes). */
  onSelectMark: (() => void) | null;
}): React.JSX.Element {
  return (
    <View style={styles.row}>
      <View style={styles.ignoredHead}>
        <Text style={styles.kind}>
          {marker.penEditNumber !== undefined
            ? marker.summary
            : `Marker ${marker.markerNumInPage}`}
        </Text>
        <View style={styles.rowButtons}>
          {onSelectMark ? (
            <PillButton
              size="small"
              label="Select mark ›"
              onPress={onSelectMark}
              disabled={disabled}
            />
          ) : null}
          {onDrop ? (
            <PillButton
              size="small"
              label="Drop"
              onPress={onDrop}
              disabled={disabled}
            />
          ) : null}
        </View>
      </View>
      <Text style={styles.rowMeta} numberOfLines={onDrop ? 2 : 3}>
        {marker.reason}
      </Text>
    </View>
  );
}

function EmptyState({
  loading,
  message,
}: {
  loading: boolean;
  message: string;
}): React.JSX.Element {
  if (loading) {
    return <Text style={styles.emptyText}>Reading markers…</Text>;
  }
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{message || 'No changes to show.'}</Text>
      <Text style={styles.emptyHint}>
        Delete: draw a line through the words. Replace: add a small loop at its
        end, write the new words right after, lasso them and tap Insertion or
        Replacement. ? has the details.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  columns: {
    flex: 1,
    flexDirection: 'row',
  },
  left: {
    width: 340,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.base,
    paddingBottom: SPACING.sm,
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
  },
  right: {
    flex: 1,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.base,
    paddingBottom: SPACING.sm,
  },
  row: {
    height: ROW_HEIGHT - SPACING.xs,
    marginBottom: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderWidth: 2,
    borderColor: 'transparent',
    borderBottomColor: COLORS.border,
    borderRadius: 6,
  },
  rowSelected: {
    borderColor: COLORS.accent,
    borderBottomColor: COLORS.accent,
  },
  kind: {
    fontSize: FONT.small - 2,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: COLORS.muted,
  },
  rowText: {
    fontSize: FONT.medium,
    color: COLORS.text,
    marginTop: 2,
  },
  rowButtons: {
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  ignoredHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowMeta: {
    fontSize: FONT.small,
    color: COLORS.muted,
    marginTop: 2,
  },
  legend: {
    fontSize: FONT.small,
    color: COLORS.muted,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: SPACING.sm,
    marginTop: SPACING.sm,
  },
  empty: {
    gap: SPACING.md,
  },
  emptyText: {
    fontSize: FONT.medium,
    color: COLORS.text,
  },
  emptyHint: {
    fontSize: FONT.small,
    color: COLORS.muted,
    lineHeight: 22,
  },
});
