/**
 * The sign of a comment or an image in a list row (technical-design-comments-images.md §3.2): a
 * speech bubble with "C" (a rounded box with a small tail), or a plain double frame - as on the
 * page. Both are square-cornered enough never to read as the circle, which means only a tagged
 * text's number.
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {COLORS, FONT, RADII} from './theme';

interface Props {
  kind: 'comment' | 'image';
  /** Grey, for a comment checked off. */
  faint?: boolean;
}

export default function NoteSign({kind, faint = false}: Props): React.JSX.Element {
  const color = faint ? COLORS.muted : COLORS.text;
  if (kind === 'image') {
    return (
      <View style={[styles.frame, {borderColor: color}]} accessibilityLabel="Image">
        <View style={[styles.inner, {borderColor: color}]} />
      </View>
    );
  }
  return (
    <View style={styles.bubbleBox} accessibilityLabel="Comment">
      <View style={[styles.bubble, {borderColor: color}]}>
        <Text style={[styles.letter, {color}]}>C</Text>
      </View>
      <View style={[styles.tail, {borderTopColor: color}]} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: 32,
    height: 32,
    borderWidth: 2,
    padding: 4,
  },
  inner: {
    flex: 1,
    borderWidth: 2,
  },
  bubbleBox: {
    width: 32,
    height: 32,
  },
  bubble: {
    width: 32,
    height: 25,
    borderWidth: 2,
    borderRadius: RADII.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: {
    fontSize: FONT.small,
    fontWeight: '700',
    lineHeight: 20,
  },
  tail: {
    width: 0,
    height: 0,
    marginLeft: 4,
    borderLeftWidth: 0,
    borderRightWidth: 8,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});
