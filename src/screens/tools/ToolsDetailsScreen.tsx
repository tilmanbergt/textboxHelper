/**
 * Details of the lasso screen: "Log All Textboxes" writes every textbox of the current page with
 * its rectangle and font to the log and a summary to the clipboard, to check sizes and positions.
 * The result list is paged here.
 */
import React, {useMemo} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {TextSegment} from '../../domain/textPages';
import PagedText from '../../ui/PagedText';
import PillButton from '../../ui/PillButton';
import ScreenFrame from '../../ui/ScreenFrame';
import {COLORS, FONT, SPACING} from '../../ui/theme';
import type {TextboxTools} from './useTextboxTools';

interface Props {
  tools: TextboxTools;
  onBack: () => void;
  onClose: () => void;
}

export default function ToolsDetailsScreen({tools, onBack, onClose}: Props): React.JSX.Element {
  const segments = useMemo<TextSegment[]>(
    () => (tools.logBlocks ?? []).map(block => ({text: `${block}\n\n`})),
    [tools.logBlocks],
  );
  return (
    <ScreenFrame
      title="Details"
      back={{label: 'Textbox Tools', onPress: onBack}}
      onClose={onClose}
      status={tools.status}
      primary={{label: 'Done', onPress: onBack}}
      screenKey="tools-details">
      <View style={styles.body}>
        <Text style={styles.title}>Log All Textboxes</Text>
        <Text style={styles.hint}>
          Writes every textbox of the current page with its position, size and font to the log, and a summary to
          the clipboard. Nothing on the page changes.
        </Text>
        <View style={styles.buttons}>
          <PillButton size="small" label="Log All Textboxes" disabled={tools.busy} onPress={tools.logAll} />
        </View>
        {tools.logBlocks && (
          <View style={styles.result}>
            <PagedText header="Logged textboxes" segments={segments} resetKey={tools.logBlocks.length} />
          </View>
        )}
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.base,
    gap: SPACING.sm,
  },
  title: {
    fontSize: FONT.medium,
    fontWeight: '700',
    color: COLORS.text,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingBottom: SPACING.xs,
  },
  hint: {
    fontSize: FONT.small,
    color: COLORS.muted,
    lineHeight: 21,
    maxWidth: 640,
  },
  buttons: {
    flexDirection: 'row',
    marginVertical: SPACING.sm,
  },
  result: {
    flex: 1,
  },
});
