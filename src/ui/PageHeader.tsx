/**
 * The one-line header above a paged box (PagedSection, PagedText): header left, then the hidden
 * count ("+N") and ‹ › right - only when there is more to see, never as disabled arrows. The
 * line's height is fixed by its padding and line height, never by whether arrows show, so a box
 * that needs a second page doesn't shrink its own viewport (Kept GTD's PagedSection).
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {COLORS, FONT, SPACING} from './theme';

interface Props {
  header: React.ReactNode;
  accessory?: React.ReactNode;
  hiddenLabel: string;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}

const HEADER_LINE_HEIGHT = 24;

export default function PageHeader({
  header,
  accessory,
  hiddenLabel,
  canPrev,
  canNext,
  onPrev,
  onNext,
}: Props): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.header} numberOfLines={1}>
        {header}
      </Text>
      {accessory}
      {(canPrev || canNext) && (
        <View style={styles.arrows}>
          <Text style={styles.hidden}>{hiddenLabel}</Text>
          {canPrev && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous page"
              onPress={onPrev}
              hitSlop={12}
              style={styles.arrowButton}>
              <Text style={styles.arrow}>‹</Text>
            </Pressable>
          )}
          {canNext && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next page"
              onPress={onNext}
              hitSlop={12}
              style={styles.arrowButton}>
              <Text style={styles.arrow}>›</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.xs,
    marginBottom: SPACING.xs,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  header: {
    flex: 1,
    fontSize: FONT.small,
    lineHeight: HEADER_LINE_HEIGHT,
    fontWeight: '700',
    color: COLORS.text,
  },
  arrows: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  hidden: {
    fontSize: FONT.small,
    lineHeight: HEADER_LINE_HEIGHT,
    color: COLORS.muted,
    marginRight: SPACING.xs,
  },
  arrowButton: {
    paddingHorizontal: SPACING.md,
  },
  arrow: {
    fontSize: FONT.large,
    lineHeight: HEADER_LINE_HEIGHT,
    fontWeight: '700',
    color: COLORS.text,
  },
});
