/**
 * Layout of the import (canvas "Import · Layout"): paragraph font size and the page margins, the
 * values that rarely change. Saved like every import setting; the preview updates on going back.
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {
  withDefaultLayout,
  withParagraphFontSize,
  type TextboxImportSettings,
} from '../../domain/importSettings';
import NumberField from '../../ui/NumberField';
import PillButton from '../../ui/PillButton';
import ScreenFrame, {type FrameStatus} from '../../ui/ScreenFrame';
import {COLORS, FONT, SPACING} from '../../ui/theme';

interface Props {
  settings: TextboxImportSettings;
  onChange: (next: TextboxImportSettings) => void;
  status: FrameStatus | null;
  onBack: () => void;
  onClose: () => void;
}

const MAX_MARGIN = 1000;

export default function ImportLayoutScreen({settings, onChange, status, onBack, onClose}: Props): React.JSX.Element {
  const margin = (key: 'marginLeft' | 'marginTop' | 'marginRight' | 'marginBottom', label: string) => (
    <NumberField
      label={label}
      value={settings[key]}
      min={0}
      max={MAX_MARGIN}
      width={110}
      onChange={n => onChange({...settings, [key]: n})}
    />
  );
  return (
    <ScreenFrame
      title="Layout"
      back={{label: 'Import', onPress: onBack}}
      onClose={onClose}
      status={status ?? {text: 'Used for the next import. The preview updates when you go back.'}}
      primary={{label: 'Done', onPress: onBack}}
      screenKey="import-layout">
      <View style={styles.body}>
        <View style={styles.section}>
          <Text style={styles.title}>Paragraph font size</Text>
          <NumberField
            label="Size"
            value={settings.fontSize}
            min={8}
            max={200}
            width={110}
            onChange={n => onChange(withParagraphFontSize(settings, n))}
          />
        </View>
        <View style={styles.section}>
          <Text style={styles.title}>Margins on the page</Text>
          <Text style={styles.hint}>Distance from the page edge, in page pixels.</Text>
          <View style={styles.row}>
            {margin('marginLeft', 'Left')}
            {margin('marginTop', 'Top')}
            {margin('marginRight', 'Right')}
            {margin('marginBottom', 'Bottom')}
          </View>
        </View>
        <View style={styles.row}>
          <PillButton size="small" label="Reset to defaults" onPress={() => onChange(withDefaultLayout(settings))} />
        </View>
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.base,
    gap: SPACING.xl,
  },
  section: {
    gap: SPACING.sm,
  },
  title: {
    fontSize: FONT.medium,
    fontWeight: '700',
    color: COLORS.text,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingBottom: SPACING.xs,
    maxWidth: 640,
  },
  hint: {
    fontSize: FONT.small,
    color: COLORS.muted,
  },
  row: {
    flexDirection: 'row',
    gap: SPACING.base,
  },
});
