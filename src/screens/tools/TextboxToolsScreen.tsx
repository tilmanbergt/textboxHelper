/**
 * The lasso screen, "Textbox Tools" (technical-design-calmer-screens.md §3.5, canvas "Lasso
 * actions"). Left: the actions; one that doesn't fit the selection is greyed with its reason.
 * Right: After / Before of the chosen action as paged text. Details holds "Log All Textboxes".
 */
import React, {useMemo, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {TEXTBOX_TOOLS_HELP} from '../../domain/helpTexts';
import {plural} from '../../domain/plural';
import {ACTION_LABELS, ACTION_ORDER} from '../../domain/textboxActionKinds';
import type {TextSegment} from '../../domain/textPages';
import CountTabs from '../../ui/CountTabs';
import PagedText from '../../ui/PagedText';
import ScreenFrame from '../../ui/ScreenFrame';
import {COLORS, FONT, SPACING} from '../../ui/theme';
import ToolsDetailsScreen from './ToolsDetailsScreen';
import {useTextboxTools, type ScreenAction} from './useTextboxTools';

type PreviewTab = 'after' | 'before';

interface Props {
  onClose: () => void;
}

export default function TextboxToolsScreen({onClose}: Props): React.JSX.Element {
  const tools = useTextboxTools();
  const {preview, action, applied, busy, loading} = tools;
  const [view, setView] = useState<'tools' | 'details'>('tools');
  const [tab, setTab] = useState<PreviewTab>('after');

  const before = useMemo(() => preview?.beforeBlocks ?? [], [preview]);
  const after = useMemo(
    () => (action && preview ? preview.afterBlocksByAction[action] ?? [] : []),
    [action, preview],
  );
  const shownTab: PreviewTab = action ? tab : 'before';
  const segments = useMemo(() => blocksToSegments(shownTab === 'after' ? after : before), [after, before, shownTab]);

  if (view === 'details') {
    return <ToolsDetailsScreen tools={tools} onBack={() => setView('tools')} onClose={onClose} />;
  }

  const primary = applied
    ? {label: 'Close', onPress: onClose}
    : {
        label: action ? `Apply ${ACTION_LABELS[action]}` : 'Choose an action',
        onPress: tools.apply,
        disabled: !action || loading,
        busy,
        busyLabel: 'Applying…',
      };

  return (
    <ScreenFrame
      title="Textbox Tools"
      context={preview ? plural(preview.selectedCount, 'textbox', 'textboxes') + ' selected' : undefined}
      actions={[{label: 'Details', onPress: () => setView('details')}]}
      help={{title: 'Textbox Tools', text: TEXTBOX_TOOLS_HELP}}
      onClose={onClose}
      status={tools.status}
      primary={primary}
      screenKey={`tools-${shownTab}-${action ?? ''}`}>
      <View style={styles.columns}>
        <View style={styles.left}>
          <Text style={styles.label}>Action</Text>
          {ACTION_ORDER.map(kind => (
            <ActionRow
              key={kind}
              kind={kind}
              reason={loading ? 'reading the selection…' : preview?.reasons[kind]}
              selected={kind === action}
              disabled={applied || busy}
              onPress={() => {
                tools.select(kind);
                setTab('after');
              }}
            />
          ))}
        </View>
        <View style={styles.right}>
          <CountTabs
            tabs={[
              {key: 'after', label: 'After'},
              {key: 'before', label: 'Before'},
            ]}
            activeKey={shownTab}
            onChange={setTab}
            trailing={
              action ? (
                <Text style={styles.count}>
                  {plural(before.length, 'textbox', 'textboxes')} → {after.length}
                </Text>
              ) : undefined
            }
          />
          {shownTab === 'after' || before.length > 0 ? (
            <PagedText
              header={shownTab === 'after' && action ? ACTION_LABELS[action] : 'As it is now'}
              segments={segments}
              resetKey={`${shownTab}-${action ?? ''}`}
            />
          ) : (
            <Text style={styles.empty}>{loading ? 'Reading the selection…' : 'No textboxes in the lasso.'}</Text>
          )}
          {!action && before.length > 0 && <Text style={styles.hint}>Choose an action to see its result.</Text>}
        </View>
      </View>
    </ScreenFrame>
  );
}

/** The blocks as one text, each block introduced by a muted "Textbox n" line. */
function blocksToSegments(blocks: string[]): TextSegment[] {
  const segments: TextSegment[] = [];
  blocks.forEach((block, index) => {
    segments.push({text: `${index > 0 ? '\n' : ''}Textbox ${index + 1}\n`, style: 'muted'});
    segments.push({text: `${block || '(empty)'}\n`});
  });
  return segments;
}

function ActionRow({
  kind,
  reason,
  selected,
  disabled,
  onPress,
}: {
  kind: ScreenAction;
  reason?: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const unavailable = !!reason;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{selected, disabled: unavailable || disabled}}
      disabled={unavailable || disabled}
      onPress={onPress}
      style={[styles.row, selected && styles.rowSelected]}>
      <Text style={[styles.rowText, selected && styles.rowTextSelected, unavailable && styles.unavailable]}>
        {ACTION_LABELS[kind]}
      </Text>
      {reason ? <Text style={[styles.reason, styles.unavailable]}>{reason}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  columns: {
    flex: 1,
    flexDirection: 'row',
  },
  left: {
    width: 300,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.base,
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
  },
  right: {
    flex: 1,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.base,
    paddingBottom: SPACING.sm,
  },
  label: {
    fontSize: FONT.small,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: COLORS.muted,
    marginBottom: SPACING.sm,
  },
  row: {
    minHeight: 64,
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    marginBottom: SPACING.xs,
    borderWidth: 2,
    borderColor: 'transparent',
    borderBottomColor: COLORS.border,
    borderRadius: 6,
  },
  rowSelected: {
    borderColor: COLORS.accent,
    borderBottomColor: COLORS.accent,
  },
  rowText: {
    fontSize: FONT.medium,
    color: COLORS.text,
  },
  rowTextSelected: {
    fontWeight: '700',
  },
  reason: {
    fontSize: FONT.small,
    marginTop: 2,
  },
  unavailable: {
    color: COLORS.disabled,
  },
  count: {
    fontSize: FONT.small,
    color: COLORS.muted,
  },
  empty: {
    fontSize: FONT.medium,
    color: COLORS.muted,
  },
  hint: {
    fontSize: FONT.small,
    color: COLORS.muted,
    paddingTop: SPACING.sm,
  },
});
