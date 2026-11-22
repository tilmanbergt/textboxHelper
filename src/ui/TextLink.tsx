/**
 * A button drawn as underlined text ("Go to page 2 ›", "Undo last", "Cancel"): for actions that
 * sit inside a line of text, where a framed button would weigh too much
 * (technical-design-outline-sections.md §3.1). Greyed when it can't be used.
 */
import React from 'react';
import {Pressable, StyleSheet, Text} from 'react-native';
import {COLORS, FONT} from './theme';

interface Props {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}

export default function TextLink({label, onPress, disabled = false, accessibilityLabel}: Props): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{disabled}}
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={10}
      style={styles.link}>
      <Text style={[styles.text, disabled && styles.disabled]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: {
    minHeight: 36,
    justifyContent: 'center',
  },
  text: {
    fontSize: FONT.small,
    color: COLORS.text,
    textDecorationLine: 'underline',
    includeFontPadding: false,
  },
  disabled: {
    color: COLORS.disabled,
  },
});
