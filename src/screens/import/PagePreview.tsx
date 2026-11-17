/**
 * One planned import page drawn to scale (technical-design-calmer-screens.md §3.7): a box with the
 * note page's aspect ratio, each planned textbox at its rectangle, its text at its font size, all
 * scaled to the room the column has.
 *
 * The text is laid out the way the import measured it (supernote/textboxMetrics.ts): Android's
 * natural line height (no fixed lineHeight, font padding on, like the native StaticLayout with
 * spacing 1.0) at the measured width, the textbox width minus the calibration's width adjustment.
 * So the drawn text needs the same height as the planned rectangle. It may run a few pixels past
 * the rectangle (rounding, a font that differs from the textbox's); it is not clipped there, only
 * at the page edge, so no line is cut off.
 */
import React, {useState} from 'react';
import {StyleSheet, Text, View, type LayoutChangeEvent} from 'react-native';
import type {PlannedTextboxPage} from '../../domain/importPlan';
import {
  DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION,
  getRequestedWidth,
} from '../../domain/textboxLayout';
import {COLORS} from '../../ui/theme';

const MIN_FONT = 6;

interface Props {
  page: PlannedTextboxPage;
  pageSize: {width: number; height: number};
}

export default function PagePreview({page, pageSize}: Props): React.JSX.Element {
  const [room, setRoom] = useState<{width: number; height: number} | null>(null);
  const onLayout = (event: LayoutChangeEvent) => {
    const {width: w, height: h} = event.nativeEvent.layout;
    if (w > 0 && h > 0) {
      setRoom(prev => (prev && prev.width === w && prev.height === h ? prev : {width: w, height: h}));
    }
  };
  const ratio = pageSize.height > 0 ? pageSize.width / pageSize.height : 0.75;
  const width = room ? Math.min(room.width, room.height * ratio) : 0;
  const scale = pageSize.width > 0 ? width / pageSize.width : 0;

  return (
    <View style={styles.area} onLayout={onLayout}>
      {scale > 0 && (
        <View
          accessibilityLabel="Preview of an imported page"
          style={[styles.page, {width, height: width / ratio}]}>
          {page.chunks.map((chunk, index) => (
            <View
              key={index}
              style={[
                styles.chunk,
                {
                  left: chunk.rect.left * scale,
                  top: chunk.rect.top * scale,
                  width: (chunk.rect.right - chunk.rect.left) * scale,
                  height: (chunk.rect.bottom - chunk.rect.top) * scale,
                },
              ]}>
              <Text
                style={[
                  styles.text,
                  chunk.bold && styles.bold,
                  {
                    width:
                      getRequestedWidth(chunk.rect.right - chunk.rect.left, DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION) *
                      scale,
                    fontSize: Math.max(MIN_FONT, chunk.fontSize * scale),
                  },
                ]}>
                {chunk.text}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  area: {
    flex: 1,
    alignItems: 'center',
  },
  page: {
    borderWidth: 2,
    borderColor: COLORS.accent,
    backgroundColor: COLORS.background,
    overflow: 'hidden',
  },
  chunk: {
    position: 'absolute',
    overflow: 'visible',
  },
  text: {
    color: COLORS.text,
  },
  bold: {
    fontWeight: '700',
  },
});
