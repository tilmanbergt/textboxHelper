/**
 * Edit markers review (technical-design-calmer-screens.md §3.4, canvas "Edit markers · review").
 *
 * Left: the recognized changes and the ignored markers, as tabs with counts and a paged list.
 * Right: one affected textbox at a time, removed words struck through, replacements in bold; a
 * tap on a change shows its textbox at the page holding it. All or nothing: one button applies
 * every change. Details (calibration, diagnostics) is a sub-screen with the same state.
 */
import React, {useEffect, useMemo, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {EDIT_MARKERS_HELP} from '../../domain/helpTexts';
import type {
  EditMarkerPreviewScope,
  IgnoredEditMarker,
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
  const [view, setView] = useState<'review' | 'details'>('review');
  const [tab, setTab] = useState<ListTab>('changes');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [jumpKey, setJumpKey] = useState(0);

  const operations = useMemo(() => preview?.operations ?? [], [preview]);
  const ignored = useMemo(() => preview?.ignoredMarkers ?? [], [preview]);
  const textboxes = useMemo(() => preview?.textboxes ?? [], [preview]);

  // A new preview selects its first change; with only ignored markers, the Ignored tab opens.
  useEffect(() => {
    setSelectedId(operations[0]?.id ?? null);
    setTab(operations.length === 0 && ignored.length > 0 ? 'ignored' : 'changes');
    setJumpKey(key => key + 1);
  }, [operations, ignored]);

  const selected = operations.find(operation => operation.id === selectedId) ?? operations[0] ?? null;
  const textboxIndex = selected
    ? Math.max(0, textboxes.findIndex(textbox => textbox.uuid === selected.targetTextboxUuid))
    : 0;
  const textbox = textboxes[textboxIndex] ?? null;

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

  const context = [
    scope === 'page' ? 'Whole page' : 'Lasso selection',
    loading && !preview ? null : plural(operations.length, 'change'),
    ignored.length > 0 ? `${ignored.length} ignored` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const primary = applied
    ? {label: 'Close', onPress: onClose}
    : {
        label: operations.length > 0 ? `Apply ${plural(operations.length, 'change')}` : 'Nothing to apply',
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
                header={`Textbox ${textbox.numInPage} · ${plural(textbox.changeCount, 'change')}`}
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
              <Text style={styles.legend}>Struck through: removed. Bold: inserted by a replace mark.</Text>
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
  const text =
    operation.kind === 'replace' && operation.replacementText ? `${words} → ${operation.replacementText}` : words;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{selected}}
      onPress={onPress}
      style={[styles.row, selected && styles.rowSelected]}>
      <Text style={styles.kind}>{operation.kind === 'replace' ? 'Replace' : 'Delete'}</Text>
      <Text style={styles.rowText} numberOfLines={1}>
        {text}
      </Text>
      <Text style={styles.rowMeta} numberOfLines={1}>
        Textbox {operation.targetTextboxNumInPage} · line {operation.lineIndex + 1}
      </Text>
    </Pressable>
  );
}

function IgnoredRow({marker}: {marker: IgnoredEditMarker}): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.kind}>Marker {marker.markerNumInPage}</Text>
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
        Delete: draw a line through the words. Replace: add two short vertical lines across it and write
        the new words below the paragraph in a line starting with #. ? has the details.
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
  emptyHint: {
    fontSize: FONT.small,
    color: COLORS.muted,
    lineHeight: 22,
  },
});
