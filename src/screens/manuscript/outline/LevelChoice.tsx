/**
 * Changing the level of a heading that has subheadings (technical-design-outline-sections.md §4):
 * two choices side by side, each with how the headings will read — with its subheadings (the shape
 * below stays) or only this heading (its subheadings become its siblings). The previews come from
 * the plan itself, so they show exactly what Apply will do.
 */
import React, {useMemo} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {HeadingLevel} from '../../../domain/headingText';
import type {OutlineBlock} from '../../../domain/outlineModel';
import {plannedOrder, sectionOf, type PlannedChange} from '../../../domain/outlinePlan';
import {COLORS, FONT, RADII, SPACING} from '../../../ui/theme';

interface Props {
  order: OutlineBlock[];
  plan: PlannedChange[];
  headingKey: string;
  level: 0 | HeadingLevel;
  onChoose: (withSubheadings: boolean) => void;
}

const PREVIEW_LINES = 4;

function preview(order: OutlineBlock[], plan: PlannedChange[], change: PlannedChange, keys: string[]): string[] {
  const after = plannedOrder(order, [...plan, change]).order;
  const lines = after
    .filter(block => keys.includes(block.key) && block.kind === 'heading')
    .map(block => `${'    '.repeat(Math.max(0, (block.level ?? 1) - 1))}${block.firstLine}`);
  const first = after.find(block => block.key === change.key);
  return [first && first.kind === 'paragraph' ? `¶ ${first.firstLine}` : null, ...lines]
    .filter((line): line is string => !!line)
    .slice(0, PREVIEW_LINES);
}

export default function LevelChoice({order, plan, headingKey, level, onChoose}: Props): React.JSX.Element {
  const keys = useMemo(() => sectionOf(order, headingKey), [headingKey, order]);
  const along = useMemo(
    () => preview(order, plan, {kind: 'level', key: headingKey, level, withSubheadings: true}, keys),
    [headingKey, keys, level, order, plan],
  );
  const alone = useMemo(
    () => preview(order, plan, {kind: 'level', key: headingKey, level, withSubheadings: false}, keys),
    [headingKey, keys, level, order, plan],
  );
  return (
    <View style={styles.row}>
      <Card
        title="With its subheadings"
        hint="The shape below stays."
        lines={along}
        onPress={() => onChoose(true)}
      />
      <Card
        title="Only this heading"
        hint="Its subheadings keep their level."
        lines={alone}
        onPress={() => onChoose(false)}
      />
    </View>
  );
}

function Card({
  title,
  hint,
  lines,
  onPress,
}: {
  title: string;
  hint: string;
  lines: string[];
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.hint}>{hint}</Text>
      {lines.map((line, index) => (
        <Text key={index} style={styles.line} numberOfLines={1}>
          {line}
        </Text>
      ))}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: SPACING.base,
  },
  card: {
    flex: 1,
    gap: SPACING.xs,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.disabled,
    borderRadius: RADII.md,
  },
  title: {
    fontSize: FONT.medium,
    fontWeight: '700',
    color: COLORS.text,
  },
  hint: {
    fontSize: FONT.small,
    color: COLORS.muted,
    marginBottom: SPACING.xs,
  },
  line: {
    fontSize: FONT.small,
    lineHeight: 20,
    color: COLORS.text,
  },
});
