/**
 * The row of actions at the bottom of a panel (technical-design-outline-sections.md §3.1, §7.2): a
 * thin line above, borderless word buttons 48 dp high, thin separators between groups, a spacer
 * that pushes what follows to the right. Rare actions (Delete) sit behind a trailing ⋯: tapping it
 * shows them in the same row, with Cancel, instead of the usual ones — no menu floats over the
 * screen, and reaching a rare action takes a second tap on purpose. An action that can't be used
 * now is greyed, not hidden, so the row doesn't move.
 */
import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {GLYPH} from './glyphs';
import {COLORS, FONT, SPACING} from './theme';

export type BarAction = {
  key: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
};

export type BarItem = BarAction | 'separator' | 'spacer';

interface Props {
  items: BarItem[];
  /** Behind ⋯; none: no ⋯. */
  more?: BarAction[];
  /** A text in the row's free space (why the actions are off, what a mode does). */
  note?: string;
  /** Closes the ⋯ row when this changes (another block chosen). */
  resetKey?: string | number;
}

export default function ActionBar({items, more = [], note, resetKey}: Props): React.JSX.Element {
  const [showMore, setShowMore] = useState(false);
  useEffect(() => setShowMore(false), [resetKey]);
  const row: BarItem[] = showMore
    ? [
        ...more.map(action => ({
          ...action,
          onPress: () => {
            setShowMore(false);
            action.onPress();
          },
        })),
        'spacer',
        {key: 'cancel', label: 'Cancel', onPress: () => setShowMore(false)},
      ]
    : items;
  return (
    <View style={styles.bar}>
      {row.map((item, index) =>
        item === 'separator' ? (
          <View key={`sep-${index}`} style={styles.separator} />
        ) : item === 'spacer' ? (
          <View key={`spacer-${index}`} style={styles.spacer}>
            {note && !showMore ? (
              <Text style={styles.note} numberOfLines={2}>
                {note}
              </Text>
            ) : null}
          </View>
        ) : (
          <Button key={item.key} action={item} />
        ),
      )}
      {!showMore && more.length > 0 ? (
        <Button
          action={{
            key: 'more',
            label: GLYPH.more,
            accessibilityLabel: `More: ${more.map(action => action.label).join(', ')}`,
            onPress: () => setShowMore(true),
          }}
        />
      ) : null}
    </View>
  );
}

function Button({action}: {action: BarAction}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{disabled: !!action.disabled}}
      accessibilityLabel={action.accessibilityLabel ?? action.label}
      disabled={action.disabled}
      onPress={action.onPress}
      style={styles.button}>
      <Text style={[styles.label, action.disabled && styles.disabled]}>{action.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    minHeight: 52,
  },
  button: {
    minHeight: 48,
    paddingHorizontal: SPACING.md,
    justifyContent: 'center',
  },
  label: {
    fontSize: FONT.medium,
    color: COLORS.text,
    includeFontPadding: false,
  },
  disabled: {
    color: COLORS.disabled,
  },
  separator: {
    width: 1,
    height: 28,
    backgroundColor: COLORS.border,
  },
  spacer: {
    flex: 1,
    paddingHorizontal: SPACING.sm,
  },
  note: {
    fontSize: FONT.small,
    color: COLORS.muted,
    textAlign: 'right',
  },
});
