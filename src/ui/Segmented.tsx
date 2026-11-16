/**
 * A row of mutually exclusive options in one bordered box; the chosen one is filled black with
 * white bold text. `size: 'small'` is the compact form for table cells (Any / Yes / No).
 * `direction: 'column'` stacks the options (Export's page scope).
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {COLORS, FONT, RADII, SPACING} from './theme';

export interface SegmentOption<K extends string> {
  key: K;
  label: string;
  disabled?: boolean;
}

interface Props<K extends string> {
  options: SegmentOption<K>[];
  value: K;
  onChange: (key: K) => void;
  size?: 'normal' | 'small';
  direction?: 'row' | 'column';
  accessibilityLabel?: string;
}

export default function Segmented<K extends string>({
  options,
  value,
  onChange,
  size = 'normal',
  direction = 'row',
  accessibilityLabel,
}: Props<K>): React.JSX.Element {
  const column = direction === 'column';
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={[styles.box, column ? styles.column : styles.row]}>
      {options.map((option, index) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="radio"
            accessibilityState={{selected: active, disabled: !!option.disabled}}
            disabled={option.disabled}
            onPress={() => onChange(option.key)}
            style={[
              size === 'small' ? styles.optionSmall : styles.option,
              !column && styles.optionInRow,
              column && styles.optionInColumn,
              index > 0 && (column ? styles.dividerTop : styles.dividerLeft),
              active && styles.active,
            ]}>
            <Text
              numberOfLines={1}
              style={[
                size === 'small' ? styles.textSmall : styles.text,
                active && styles.textActive,
                option.disabled && styles.textDisabled,
              ]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 2,
    borderColor: COLORS.accent,
    borderRadius: RADII.md,
    overflow: 'hidden',
    alignSelf: 'stretch',
  },
  row: {
    flexDirection: 'row',
  },
  column: {
    flexDirection: 'column',
  },
  option: {
    minHeight: 40,
    paddingHorizontal: SPACING.md,
    justifyContent: 'center',
    backgroundColor: COLORS.background,
  },
  optionSmall: {
    minHeight: 32,
    paddingHorizontal: SPACING.sm,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  optionInRow: {
    flex: 1,
    alignItems: 'center',
  },
  optionInColumn: {
    alignItems: 'flex-start',
  },
  dividerLeft: {
    borderLeftWidth: 2,
    borderLeftColor: COLORS.accent,
  },
  dividerTop: {
    borderTopWidth: 2,
    borderTopColor: COLORS.accent,
  },
  active: {
    backgroundColor: COLORS.accent,
  },
  text: {
    fontSize: FONT.medium,
    color: COLORS.text,
  },
  textSmall: {
    fontSize: FONT.small,
    color: COLORS.text,
  },
  textActive: {
    color: COLORS.accentText,
    fontWeight: '700',
  },
  textDisabled: {
    color: COLORS.disabled,
  },
});
