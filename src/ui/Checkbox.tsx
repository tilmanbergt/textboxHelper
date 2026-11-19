/**
 * A checkbox with its label; the whole row is the touch target. Checked = a filled black box with
 * a white tick, so it reads without colour.
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {COLORS, FONT, RADII, SPACING} from './theme';

interface Props {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export default function Checkbox({label, checked, onChange, disabled}: Props): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{checked, disabled: !!disabled}}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={[styles.row, disabled && styles.disabled]}>
      <View style={[styles.box, checked && styles.boxChecked]}>
        {checked && <Text style={styles.tick}>✓</Text>}
      </View>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
  },
  disabled: {
    opacity: 0.35,
  },
  box: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: COLORS.accent,
    borderRadius: RADII.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
    backgroundColor: COLORS.background,
  },
  boxChecked: {
    backgroundColor: COLORS.accent,
  },
  tick: {
    color: COLORS.accentText,
    fontSize: FONT.small,
    fontWeight: '700',
    lineHeight: 18,
  },
  label: {
    fontSize: FONT.medium,
    color: COLORS.text,
    flexShrink: 1,
  },
});
