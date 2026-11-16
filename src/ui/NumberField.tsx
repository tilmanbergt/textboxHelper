/**
 * A labelled whole-number field. The text the user types is kept as typed; `onChange` gets the
 * number only when it is a whole number in [min, max], so a half-typed value never reaches the
 * settings. A value out of range shows its range under the field.
 */
import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, TextInput, View} from 'react-native';
import {COLORS, FONT, RADII, SPACING} from './theme';

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  width?: number;
}

export default function NumberField({label, value, min, max, onChange, disabled, width = 96}: Props): React.JSX.Element {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(current => (Number(current) === value ? current : String(value)));
  }, [value]);

  const parsed = Number(text.trim());
  const valid = text.trim() !== '' && Number.isInteger(parsed) && parsed >= min && parsed <= max;

  return (
    <View style={[styles.field, {width}]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={[styles.input, disabled && styles.disabled]}
        value={text}
        editable={!disabled}
        keyboardType="number-pad"
        onChangeText={next => {
          setText(next);
          const n = Number(next.trim());
          if (next.trim() !== '' && Number.isInteger(n) && n >= min && n <= max) {
            onChange(n);
          }
        }}
      />
      <Text style={styles.error}>{valid ? ' ' : `${min}–${max}`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: 2,
  },
  label: {
    fontSize: FONT.small,
    color: COLORS.muted,
  },
  input: {
    height: 40,
    borderWidth: 2,
    borderColor: COLORS.accent,
    borderRadius: RADII.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 0,
    fontSize: FONT.medium,
    color: COLORS.text,
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.35,
  },
  error: {
    fontSize: FONT.small - 2,
    color: COLORS.text,
    fontWeight: '700',
  },
});
