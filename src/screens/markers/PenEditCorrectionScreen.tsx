/**
 * Correcting a pen edit's text (technical-design-pen-edits.md §3.8): a plain text field, filled
 * with the recognized text, under the picture of the handwriting. Writing into it uses the
 * Supernote's own handwriting pad; the pad covers the lower part of the screen, so picture, field
 * and buttons stay in the upper part. Without a picture, the handwriting is drawn from its stored
 * strokes.
 */
import React, {useEffect, useState} from 'react';
import {Image, StyleSheet, Text, TextInput, View} from 'react-native';
import {loadPenEditStrokePoints} from '../../actions/penEditReview';
import type {PenEditView} from '../../domain/markerTypes';
import StrokeDrawing from '../../ui/StrokeDrawing';
import ScreenFrame from '../../ui/ScreenFrame';
import {COLORS, FONT, SPACING} from '../../ui/theme';

interface Props {
  view: PenEditView;
  initialText: string;
  onSave: (text: string) => void;
  onBack: () => void;
}

export default function PenEditCorrectionScreen({view, initialText, onSave, onBack}: Props): React.JSX.Element {
  const [text, setText] = useState(initialText);
  const what = view.kind === 'replacement' ? 'replacement' : 'insertion';
  const [strokes, setStrokes] = useState<number[][] | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    if (view.pictureUri) {
      return;
    }
    loadPenEditStrokePoints(view.id)
      .then(points => alive && setStrokes(points))
      .catch(error => {
        console.warn('[PenEditCorrection] strokes not read', String(error));
        if (alive) {
          setStrokes(null);
        }
      });
    return () => {
      alive = false;
    };
  }, [view.id, view.pictureUri]);
  return (
    <ScreenFrame
      title={`Correct ${what} ${view.number}`}
      back={{label: 'Review', onPress: onBack}}
      primary={{label: 'Save', onPress: () => onSave(text), disabled: text.trim().length === 0}}>
      <View style={styles.body}>
        {view.pictureUri ? (
          <Image source={{uri: view.pictureUri}} style={styles.picture} resizeMode="contain" />
        ) : strokes && strokes.length > 0 ? (
          // No picture was kept: the handwriting drawn from its stored strokes instead.
          <StrokeDrawing strokes={strokes} style={styles.picture} />
        ) : (
          <Text style={styles.noPicture}>
            {strokes === undefined ? 'Reading the handwriting…' : 'No picture of the handwriting was kept.'}
          </Text>
        )}
        <TextInput
          style={styles.field}
          value={text}
          onChangeText={setText}
          multiline
          autoFocus
          textAlignVertical="top"
          accessibilityLabel={`Text of ${what} ${view.number}`}
        />
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.base,
    gap: SPACING.md,
  },
  picture: {
    height: 240,
    width: '100%',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  noPicture: {
    fontSize: FONT.small,
    color: COLORS.muted,
  },
  field: {
    height: 220,
    borderWidth: 2,
    borderColor: COLORS.accent,
    borderRadius: 6,
    padding: SPACING.md,
    fontSize: FONT.large,
    color: COLORS.text,
  },
});
