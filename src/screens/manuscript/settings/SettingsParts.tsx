/**
 * Parts the Settings tabs share: a titled section, a hint line, a row of controls, and the
 * stepper of the calibration.
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import PillButton from '../../../ui/PillButton';
import {COLORS, FONT, SPACING} from '../../../ui/theme';

export function Section({title, children}: {title: string; children: React.ReactNode}): React.JSX.Element {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function Hint({children}: {children: React.ReactNode}): React.JSX.Element {
  return <Text style={styles.hint}>{children}</Text>;
}

export function Row({children}: {children: React.ReactNode}): React.JSX.Element {
  return <View style={styles.row}>{children}</View>;
}

export function Stepper({
  label,
  value,
  step,
  disabled,
  onMinus,
  onPlus,
}: {
  label: string;
  value: string;
  step: number;
  disabled: boolean;
  onMinus: () => void;
  onPlus: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <PillButton size="small" label={`−${step}`} accessibilityLabel={`${label} minus ${step}`} disabled={disabled} onPress={onMinus} />
      <Text style={styles.stepperValue}>{value}</Text>
      <PillButton size="small" label={`+${step}`} accessibilityLabel={`${label} plus ${step}`} disabled={disabled} onPress={onPlus} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: SPACING.sm,
  },
  sectionTitle: {
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
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: SPACING.md,
  },
  stepperLabel: {
    width: 90,
    fontSize: FONT.medium,
    color: COLORS.text,
  },
  stepperValue: {
    minWidth: 70,
    textAlign: 'center',
    fontSize: FONT.medium,
    fontWeight: '700',
    color: COLORS.text,
  },
});
