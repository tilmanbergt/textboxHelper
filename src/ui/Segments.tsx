/**
 * Styled text segments as nested Text (domain/textPages.ts `TextSegment`): removed text struck
 * through, new text in bold, text not there yet in grey. Used inside a parent Text, so the
 * segments flow as one paragraph. Grey is a secondary mark only: placeholders also say what they
 * are in words (DEVELOPMENT-POLICY §4).
 */
import React from 'react';
import {StyleSheet, Text, type TextStyle} from 'react-native';
import type {TextSegment, TextSegmentStyle} from '../domain/textPages';
import {COLORS} from './theme';

export function renderSegments(segments: TextSegment[]): React.ReactNode[] {
  return segments.map((segment, index) =>
    segment.style ? (
      <Text key={index} style={SEGMENT_STYLES[segment.style]}>
        {segment.text}
      </Text>
    ) : (
      segment.text
    ),
  );
}

const SEGMENT_STYLES = StyleSheet.create<Record<TextSegmentStyle, TextStyle>>({
  removed: {
    textDecorationLine: 'line-through',
  },
  inserted: {
    fontWeight: '700',
  },
  heading: {
    fontWeight: '700',
  },
  muted: {
    color: COLORS.muted,
  },
  focus: {
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  focusPlain: {
    textDecorationLine: 'underline',
  },
});
