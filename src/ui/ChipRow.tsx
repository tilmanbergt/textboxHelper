/**
 * A row of small choice chips (technical-design-manuscript.md §6): the Review's page strip and the
 * Outline's filters. The chosen chip is filled black; a "faint" chip (a page not read yet) has a
 * dashed border. `trailing` sits at the right end of the row.
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {COLORS, FONT, RADII, SPACING} from './theme';

export interface Chip<K extends string> {
  key: K;
  label: string;
  faint?: boolean;
  accessibilityLabel?: string;
}

interface Props<K extends string> {
  chips: Chip<K>[];
  value: K;
  onChange: (key: K) => void;
  trailing?: React.ReactNode;
}

export default function ChipRow<K extends string>({chips, value, onChange, trailing}: Props<K>): React.JSX.Element {
  return (
    <View style={styles.row}>
      {chips.map(chip => {
        const on = chip.key === value;
        return (
          <Pressable
            key={chip.key}
            accessibilityRole="button"
            accessibilityState={{selected: on}}
            accessibilityLabel={chip.accessibilityLabel ?? chip.label}
            onPress={() => onChange(chip.key)}
            hitSlop={4}
            style={[styles.chip, chip.faint && styles.faint, on && styles.on]}>
            <Text style={[styles.text, on && styles.textOn]}>{chip.label}</Text>
          </Pressable>
        );
      })}
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  chip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
    borderWidth: 2,
    borderColor: COLORS.accent,
    borderRadius: RADII.pill,
    backgroundColor: COLORS.background,
  },
  faint: {
    borderStyle: 'dashed',
    borderColor: COLORS.muted,
  },
  on: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  text: {
    fontSize: FONT.small,
    color: COLORS.text,
  },
  textOn: {
    color: COLORS.accentText,
    fontWeight: '700',
  },
  trailing: {
    marginLeft: 'auto',
    flexDirection: 'row',
    gap: SPACING.sm,
  },
});
