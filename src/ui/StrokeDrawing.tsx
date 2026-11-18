/**
 * Handwriting drawn from its stored points (domain/strokeDrawing.ts): each segment is a thin
 * view rotated about its centre. No drawing library needed.
 */
import React, {useMemo, useState} from 'react';
import {type LayoutChangeEvent, StyleSheet, View} from 'react-native';
import {strokeSegments} from '../domain/strokeDrawing';
import {COLORS} from './theme';

const LINE_WIDTH = 2;

interface Props {
  /** Each stroke's points as a flat x,y list, in page pixels. */
  strokes: number[][];
  style?: object;
}

export default function StrokeDrawing({strokes, style}: Props): React.JSX.Element {
  const [box, setBox] = useState<{width: number; height: number} | null>(null);
  const segments = useMemo(() => (box ? strokeSegments(strokes, box) : []), [box, strokes]);
  const onLayout = (event: LayoutChangeEvent) => {
    const {width, height} = event.nativeEvent.layout;
    if (!box || box.width !== width || box.height !== height) {
      setBox({width, height});
    }
  };
  return (
    <View style={[styles.box, style]} onLayout={onLayout}>
      {segments.map((segment, index) => (
        <View
          key={index}
          style={[
            styles.segment,
            {
              left: segment.left,
              top: segment.top - LINE_WIDTH / 2,
              width: segment.length,
              transform: [{rotate: `${segment.angle}rad`}],
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    overflow: 'hidden',
  },
  segment: {
    position: 'absolute',
    height: LINE_WIDTH,
    backgroundColor: COLORS.text,
  },
});
