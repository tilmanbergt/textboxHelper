/**
 * Edit markers review (technical-design-calmer-screens.md §3.4, canvas "Edit markers · review").
 *
 * Left: the recognized changes and the ignored markers, as tabs with counts and a paged list.
 * Right: one affected textbox at a time, removed words struck through, replacements in bold; a
 * tap on a change shows its textbox at the page holding it. A pen edit (technical-design-pen-
 * edits.md §3.6) shows its handwriting below, with Correct, Skip for later and Recognize again;
 * until its text is there, a grey placeholder stands in the text. One button applies every ready
 * change. Details (calibration, diagnostics) is a sub-screen with the same state.
 */
import React, {useEffect, useMemo, useState} from 'react';
import {Image, Pressable, StyleSheet, Text, View} from 'react-native';
import {EDIT_MARKERS_HELP} from '../../domain/helpTexts';
import type {
  EditMarkerPreviewScope,
  IgnoredEditMarker,
  PenEditView,
  PenOperationStatus,
  RecognizedEditOperation,
} from '../../domain/markerTypes';
import {plural} from '../../domain/plural';
import CountTabs from '../../ui/CountTabs';
import PagedSection from '../../ui/PagedSection';
import PagedText from '../../ui/PagedText';
import PillButton from '../../ui/PillButton';
import ScreenFrame from '../../ui/ScreenFrame';
import {COLORS, FONT, SPACING} from '../../ui/theme';
import MarkerDetailsScreen from './MarkerDetailsScreen';
import PenEditCorrectionScreen from './PenEditCorrectionScreen';
import {useEditMarkerReview} from './useEditMarkerReview';

type ListTab = 'changes' | 'ignored';

const ROW_HEIGHT = 96;

interface Props {
  scope: EditMarkerPreviewScope;
  onClose: () => void;
}

export default function EditMarkerReviewScreen({scope, onClose}: Props): React.JSX.Element {
  const review = useEditMarkerReview(scope);
  const {preview, loading, busy, applied} = review;
  const [view, setView] = useState<'review' | 'details' | 'correct'>('review');
  const [tab, setTab] = useState<ListTab>('changes');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [jumpKey, setJumpKey] = useState(0);

  const operations = useMemo(() => preview?.operations ?? [], [preview]);
  const ignored = useMemo(() => preview?.ignoredMarkers ?? [], [preview]);
  const textboxes = useMemo(() => preview?.textboxes ?? [], [preview]);

  // A new set of changes selects its first one; with only ignored markers, the Ignored tab opens.
  // A pen edit's text arriving re-assembles the preview but keeps the selection.
  const changeKey = operations.map(operation => operation.id).join('|');
  const firstId = operations[0]?.id ?? null;
  const onlyIgnored = operations.length === 0 && ignored.length > 0;
  useEffect(() => {
    setSelectedId(firstId);
    setTab(onlyIgnored ? 'ignored' : 'changes');
    setJumpKey(key => key + 1);
  }, [changeKey, firstId, onlyIgnored]);

  const selected = operations.find(operation => operation.id === selectedId) ?? operations[0] ?? null;
  const textboxIndex = selected
    ? Math.max(0, textboxes.findIndex(textbox => textbox.uuid === selected.targetTextboxUuid))
    : 0;
  const textbox = textboxes[textboxIndex] ?? null;
  const selectedPen: PenEditView | null = selected?.penEditId
    ? preview?.penEdits.find(penEdit => penEdit.id === selected.penEditId) ?? null
    : null;
  const {setSelectedPenEdit} = review;

  // The selected pen edit is recognized first.
  useEffect(() => {
    setSelectedPenEdit(selected?.penEditId ?? null);
  }, [selected?.penEditId, setSelectedPenEdit]);

  const selectOperation = (operation: RecognizedEditOperation) => {
    setSelectedId(operation.id);
    setJumpKey(key => key + 1);
  };

  const showNextTextbox = () => {
    const next = textboxes[(textboxIndex + 1) % textboxes.length];
    const first = operations.find(operation => operation.targetTextboxUuid === next.uuid);
    if (first) {
      selectOperation(first);
    }
  };

  if (view === 'details') {
    return <MarkerDetailsScreen review={review} scope={scope} onBack={() => setView('review')} onClose={onClose} />;
  }

  if (view === 'correct' && selectedPen) {
    const state = review.penStates[selectedPen.id];
    return (
      <PenEditCorrectionScreen
        view={selectedPen}
        initialText={state ? (state.correctedText ?? state.text) : ''}
        onSave={text => {
          review.correct(selectedPen.id, text);
          setView('review');
        }}
        onBack={() => setView('review')}
      />
    );
  }

  const readyCount = preview?.applyPlan?.operations.length ?? 0;
  const pendingCount = preview?.pendingCount ?? 0;

  const context = [
    scope === 'page' ? 'Whole page' : 'Lasso selection',
    loading && !preview ? null : plural(operations.length, 'change'),
    pendingCount > 0 ? `${pendingCount} recognizing` : null,
    ignored.length > 0 ? `${ignored.length} ignored` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const primary = applied
    ? {label: 'Close', onPress: onClose}
    : {
        label: readyCount > 0 ? `Apply ${plural(readyCount, 'change')}` : 'Nothing to apply',
        onPress: review.apply,
        disabled: !preview?.canApply || loading,
        busy,
        busyLabel: 'Applying…',
      };

  return (
    <ScreenFrame
      title="Edit markers"
      context={context}
      actions={[{label: 'Details', onPress: () => setView('details')}]}
      help={{title: 'Edit markers', text: EDIT_MARKERS_HELP}}
      onClose={onClose}
      status={review.status}
      primary={primary}
      screenKey={`review-${tab}`}>
      <View style={styles.columns}>
        <View style={styles.left}>
          <CountTabs
            tabs={[
              {key: 'changes', label: 'Changes', count: operations.length},
              {key: 'ignored', label: 'Ignored', count: ignored.length, hideWhenZero: true},
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
              emptyHint={loading ? 'Reading markers…' : 'No changes recognized.'}
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
              rows={ignored}
              rowHeight={() => ROW_HEIGHT}
              renderRow={marker => <IgnoredRow key={marker.markerUuid} marker={marker} />}
            />
          )}
        </View>
        <View style={styles.right}>
          {textbox ? (
            <>
              <PagedText
                header={textbox.title ?? `Textbox ${textbox.numInPage} · ${plural(textbox.changeCount, 'change')}`}
                headerAccessory={
                  textboxes.length > 1 ? (
                    <PillButton
                      size="small"
                      label={`Next textbox (${textboxIndex + 1}/${textboxes.length})`}
                      onPress={showNextTextbox}
                    />
                  ) : undefined
                }
                segments={textbox.segments}
                resetKey={textbox.uuid}
                jumpTo={selected ? {key: `${jumpKey}-${selected.id}`, index: selected.textStart} : null}
              />
              <Text style={styles.legend}>Struck through: removed. Bold: new text. Grey: new text not there yet.</Text>
              {selected && selectedPen ? (
                <PenEditPanel
                  view={selectedPen}
                  status={selected.penStatus ?? 'recognizing'}
                  busy={busy || applied}
                  onCorrect={() => setView('correct')}
                  onSkip={skipped => review.setSkipped(selectedPen.id, skipped)}
                  onRecognizeAgain={() => review.recognizeAgain(selectedPen.id)}
                />
              ) : null}
            </>
          ) : (
            <EmptyState loading={loading} message={preview?.summaryMessage ?? ''} />
          )}
        </View>
      </View>
    </ScreenFrame>
  );
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
  const newText = operation.replacementText ?? (operation.penStatus ? STATUS_TEXT[operation.penStatus] : '');
  const text =
    operation.kind === 'insert' ? newText : operation.kind === 'replace' ? `${words} → ${newText}` : words;
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
        {operation.kind === 'insert' ? operation.detail : `Textbox ${operation.targetTextboxNumInPage} · line ${operation.lineIndex + 1}`}
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
  if (operation.kind === 'replace') {
    return operation.penEditNumber !== undefined ? `Replace ${operation.penEditNumber}` : 'Replace';
  }
  return 'Delete';
}

/** The handwriting of the selected pen edit and what can be done with it. */
function PenEditPanel({
  view,
  status,
  busy,
  onCorrect,
  onSkip,
  onRecognizeAgain,
}: {
  view: PenEditView;
  status: PenOperationStatus;
  busy: boolean;
  onCorrect: () => void;
  onSkip: (skipped: boolean) => void;
  onRecognizeAgain: () => void;
}): React.JSX.Element {
  const skipped = status === 'skipped';
  return (
    <View style={styles.penPanel}>
      {view.pictureUri ? (
        <Image source={{uri: view.pictureUri}} style={styles.penPicture} resizeMode="contain" />
      ) : (
        <Text style={styles.rowMeta}>No picture of the handwriting was kept.</Text>
      )}
      <View style={styles.penButtons}>
        <PillButton size="small" label="Correct" onPress={onCorrect} disabled={busy} />
        <PillButton size="small" label={skipped ? 'Include' : 'Skip for later'} onPress={() => onSkip(!skipped)} disabled={busy} />
        <PillButton
          size="small"
          label="Recognize again"
          onPress={onRecognizeAgain}
          disabled={busy || status === 'recognizing'}
        />
      </View>
    </View>
  );
}

function IgnoredRow({marker}: {marker: IgnoredEditMarker}): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.kind}>{marker.penEditNumber !== undefined ? marker.summary : `Marker ${marker.markerNumInPage}`}</Text>
      <Text style={styles.rowMeta} numberOfLines={3}>
        {marker.reason}
      </Text>
    </View>
  );
}

function EmptyState({loading, message}: {loading: boolean; message: string}): React.JSX.Element {
  if (loading) {
    return <Text style={styles.emptyText}>Reading markers…</Text>;
  }
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{message || 'No changes to show.'}</Text>
      <Text style={styles.emptyHint}>
        Delete: draw a line through the words. Replace: add two short vertical lines across it, write
        the new words right after, lasso them and tap Replacement. ? has the details.
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
  penPanel: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: SPACING.sm,
    marginTop: SPACING.sm,
    gap: SPACING.sm,
  },
  penPicture: {
    height: 150,
    width: '100%',
  },
  penButtons: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  emptyHint: {
    fontSize: FONT.small,
    color: COLORS.muted,
    lineHeight: 22,
  },
});
