/**
 * A small map of a page (technical-design-mark-dialogue.md §5.3): its textboxes as grey bars and
 * one item framed in black, scaled into about 110 × 150 dp. Plain views, no page render. A second
 * place may be framed dashed (a comment's paragraph, technical-design-comments-images.md §5.2).
 */
import React from 'react';
import {StyleSheet, View} from 'react-native';
import type {Rect} from '../domain/textboxModel';
import {COLORS} from './theme';

/** The A5 X page in pixels: the map's frame when nothing on the page reaches beyond it. */
const PAGE_WIDTH = 1404;
const PAGE_HEIGHT = 1872;

interface Props {
  rects: Rect[];
  /** The item's place, framed; null draws only the textboxes. */
  frame: Rect | null;
  /** A second place, framed dashed. */
  second?: Rect | null;
  width?: number;
  height?: number;
}

export default function PageMap({rects, frame, second = null, width = 110, height = 150}: Props): React.JSX.Element {
  const all = [...rects, ...(frame ? [frame] : []), ...(second ? [second] : [])];
  const pageWidth = Math.max(PAGE_WIDTH, ...all.map(rect => rect.right));
  const pageHeight = Math.max(PAGE_HEIGHT, ...all.map(rect => rect.bottom));
  const scale = Math.min(width / pageWidth, height / pageHeight);
  const box = (rect: Rect) => ({
    left: rect.left * scale,
    top: rect.top * scale,
    width: Math.max(2, (rect.right - rect.left) * scale),
    height: Math.max(2, (rect.bottom - rect.top) * scale),
  });
  return (
    <View style={[styles.page, {width: pageWidth * scale, height: pageHeight * scale}]} accessibilityLabel="Where it is on the page">
      {rects.map((rect, index) => (
        <View key={index} style={[styles.textbox, box(rect)]} />
      ))}
      {second ? <View style={[styles.second, box(second)]} /> : null}
      {frame ? <View style={[styles.frame, box(frame)]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    borderWidth: 1,
    borderColor: COLORS.muted,
    backgroundColor: COLORS.background,
  },
  textbox: {
    position: 'absolute',
    backgroundColor: COLORS.border,
  },
  frame: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: COLORS.accent,
  },
  second: {
    position: 'absolute',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: COLORS.accent,
  },
});
