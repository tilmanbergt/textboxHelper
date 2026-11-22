/**
 * A row of choices drawn as text (technical-design-outline-sections.md §3.1, §7.2): the chosen one
 * bold with a 2 dp line under it, the others plain, dots between them, an optional caption in
 * front. Lighter than a segmented control, for choices that sit next to text: the Outline's Show,
 * a block's Level and Status. Each choice is a 40 dp high tap target. A thin rule instead of a dot
 * sets a choice apart from the ones before it (`ruleBefore`): the Outline's Set aside, which shows
 * a different part of the note than All, With edits and Not final.
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {GLYPH} from './glyphs';
import {COLORS, FONT, SPACING} from './theme';

export type TextChoice<K extends string | number> = {
  key: K;
  label: string;
  accessibilityLabel?: string;
};

interface Props<K extends string | number> {
  choices: TextChoice<K>[];
  value: K | null;
  onChange: (key: K) => void;
  caption?: string;
  disabled?: boolean;
  size?: 'small' | 'medium';
  /** A rule instead of a dot before this choice. */
  ruleBefore?: K;
}

export default function TextChoices<K extends string | number>({
  choices,
  value,
  onChange,
  caption,
  disabled = false,
  size = 'medium',
  ruleBefore,
}: Props<K>): React.JSX.Element {
  const fontSize = size === 'small' ? FONT.small : FONT.medium;
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={caption}>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
      {choices.map((choice, index) => {
        const chosen = choice.key === value;
        return (
          <React.Fragment key={String(choice.key)}>
            {index > 0 && choice.key === ruleBefore ? (
              <View style={styles.rule} />
            ) : index > 0 ? (
              <Text style={styles.dot}>{GLYPH.dot}</Text>
            ) : null}
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{selected: chosen, disabled}}
              accessibilityLabel={choice.accessibilityLabel ?? choice.label}
              disabled={disabled}
              onPress={() => !chosen && onChange(choice.key)}
              hitSlop={4}
              style={styles.choice}>
              <Text
                style={[
                  styles.label,
                  {fontSize},
                  chosen ? styles.chosen : styles.other,
                  disabled && !chosen && styles.disabled,
                ]}>
                {choice.label}
              </Text>
              <View style={[styles.underline, chosen && styles.underlineOn]} />
            </Pressable>
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: SPACING.xs,
  },
  caption: {
    fontSize: FONT.small,
    color: COLORS.muted,
    marginRight: SPACING.xs,
  },
  dot: {
    fontSize: FONT.small,
    color: COLORS.disabled,
  },
  rule: {
    width: 1,
    height: 28,
    marginHorizontal: SPACING.sm,
    backgroundColor: COLORS.border,
  },
  choice: {
    minHeight: 40,
    minWidth: 32,
    paddingHorizontal: SPACING.xs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: {
    includeFontPadding: false,
  },
  chosen: {
    color: COLORS.text,
    fontWeight: '700',
  },
  other: {
    color: COLORS.text,
  },
  disabled: {
    color: COLORS.disabled,
  },
  underline: {
    alignSelf: 'stretch',
    height: 2,
    marginTop: 3,
    backgroundColor: 'transparent',
  },
  underlineOn: {
    backgroundColor: COLORS.accent,
  },
});
