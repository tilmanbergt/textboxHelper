/**
 * What a list shows when it has nothing to show (technical-design-aside-area.md §5.3): one line
 * saying so and a short text on what the place is for and how to fill it. Shared by the Review
 * (no edit marks on the page) and the Outline's Set aside view.
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {COLORS, FONT, LINE_HEIGHT, SPACING} from './theme';

interface Props {
  title: string;
  text: string;
}

export default function EmptyState({title, text}: Props): React.JSX.Element {
  return (
    <View style={styles.empty}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    gap: SPACING.sm,
    paddingTop: SPACING.base,
  },
  title: {
    fontSize: FONT.medium,
    color: COLORS.text,
  },
  text: {
    fontSize: FONT.small,
    lineHeight: LINE_HEIGHT.small,
    color: COLORS.muted,
  },
});
