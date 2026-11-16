/**
 * The screen's help ("?" in ui/ScreenFrame.tsx): an opaque layer over the screen body with the
 * help text paged like any long text, and Close. The text format is described in
 * domain/helpTexts.ts.
 */
import React, {useMemo} from 'react';
import {StyleSheet, View} from 'react-native';
import {helpTextToSegments} from '../domain/helpTexts';
import PagedText from './PagedText';
import PillButton from './PillButton';
import {COLORS, SPACING} from './theme';

interface Props {
  title: string;
  text: string;
  onClose: () => void;
}

export default function HelpOverlay({title, text, onClose}: Props): React.JSX.Element {
  const segments = useMemo(() => helpTextToSegments(text), [text]);
  return (
    <View style={styles.layer}>
      <PagedText
        header={title}
        headerAccessory={<PillButton label="Close help" size="small" onPress={onClose} />}
        segments={segments}
        resetKey={title}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.background,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.base,
  },
});
