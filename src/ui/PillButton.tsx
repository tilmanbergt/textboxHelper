/**
 * The rounded button every screen uses (after Kept GTD's ui/PillButton.tsx).
 *
 * - `primary`: black fill, white label - the one main action of a screen (footer).
 * - `size: 'large'`: a 44 dp high target for footer and header buttons; `'small'` for buttons
 *   inside a screen's content (calibration steps, Choose ›).
 */
import React from 'react';
import {Pressable, StyleSheet, Text} from 'react-native';
import {COLORS, FONT, RADII, SPACING} from './theme';

interface Props {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  size?: 'small' | 'large';
  accessibilityLabel?: string;
}

const HIT_SLOP = {top: 8, bottom: 8, left: 8, right: 8};

export default function PillButton({
  label,
  onPress,
  primary,
  disabled,
  size = 'large',
  accessibilityLabel,
}: Props): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{disabled: !!disabled}}
      onPress={onPress}
      disabled={disabled}
      hitSlop={HIT_SLOP}
      style={[
        styles.pill,
        size === 'large' ? styles.large : styles.small,
        primary && styles.primary,
        disabled && styles.disabled,
      ]}>
      <Text
        numberOfLines={1}
        style={[styles.text, size === 'large' && styles.textLarge, primary && styles.textPrimary]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderWidth: 2,
    borderColor: COLORS.accent,
    borderRadius: RADII.pill,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  large: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: SPACING.base,
  },
  small: {
    minHeight: 36,
    minWidth: 36,
    paddingHorizontal: SPACING.md,
  },
  primary: {
    backgroundColor: COLORS.accent,
    paddingHorizontal: SPACING.xl,
  },
  disabled: {
    opacity: 0.35,
  },
  text: {
    fontSize: FONT.small,
    fontWeight: '600',
    color: COLORS.text,
  },
  textLarge: {
    fontSize: FONT.medium,
  },
  textPrimary: {
    color: COLORS.accentText,
    fontWeight: '700',
  },
});
