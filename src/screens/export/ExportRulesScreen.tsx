/**
 * The classification rules of the export (canvas "Export · Classification rules"): whether
 * textboxes in title areas are headings, and per class the size range and whether bold, italic
 * and a border are required (Any / Yes / No). Every valid change is saved and rescans; a class
 * whose min size is above its max size is named and the last valid rules stay in use.
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {
  DEFAULT_EXPORT_CLASSIFICATION_CONFIG,
  type ExportClassificationConfig,
  type RoleRuleConfig,
  type StyleRequirement,
} from '../../domain/exportConfig';
import Checkbox from '../../ui/Checkbox';
import NumberField from '../../ui/NumberField';
import PillButton from '../../ui/PillButton';
import ScreenFrame from '../../ui/ScreenFrame';
import Segmented from '../../ui/Segmented';
import {COLORS, FONT, SPACING} from '../../ui/theme';

type ClassKey = 'heading' | 'paragraph' | 'comment' | 'meta';
type StyleKey = 'bold' | 'italic' | 'border';

const CLASSES: Array<{key: ClassKey; label: string}> = [
  {key: 'heading', label: 'Heading'},
  {key: 'paragraph', label: 'Paragraph'},
  {key: 'comment', label: 'Comment'},
  {key: 'meta', label: 'Meta'},
];

const STYLES: Array<{key: StyleKey; label: string}> = [
  {key: 'bold', label: 'Bold'},
  {key: 'italic', label: 'Italic'},
  {key: 'border', label: 'Border'},
];

const REQUIREMENT_OPTIONS: Array<{key: StyleRequirement; label: string}> = [
  {key: 'any', label: 'Any'},
  {key: 'yes', label: 'Yes'},
  {key: 'no', label: 'No'},
];

interface Props {
  rules: ExportClassificationConfig;
  problem: string | null;
  onChange: (rules: ExportClassificationConfig) => void;
  onBack: () => void;
  onClose: () => void;
}

export default function ExportRulesScreen({rules, problem, onChange, onBack, onClose}: Props): React.JSX.Element {
  const setRule = (key: ClassKey, next: Partial<RoleRuleConfig>) =>
    onChange({...rules, [key]: {...rules[key], ...next}});

  return (
    <ScreenFrame
      title="Classification rules"
      back={{label: 'Export', onPress: onBack}}
      onClose={onClose}
      status={
        problem
          ? {kind: 'error', text: `${problem} The last valid rules are still used.`}
          : {text: 'Saved for every export. The list updates when you go back.'}
      }
      primary={{label: 'Done', onPress: onBack}}
      screenKey="export-rules">
      <View style={styles.body}>
        <Checkbox
          label="Textboxes in Supernote title areas are headings"
          checked={rules.treatTitleTextBoxesAsHeadings}
          onChange={value => onChange({...rules, treatTitleTextBoxesAsHeadings: value})}
        />
        <Text style={styles.hint}>
          Every other textbox gets the first class whose rules it matches. Any matches with and without the style.
        </Text>
        {CLASSES.map(({key, label}) => (
          <View key={key} style={styles.row}>
            <Text style={styles.className}>{label}</Text>
            <NumberField
              label="Min size"
              value={rules[key].minFontSize}
              min={0}
              max={1000}
              width={84}
              onChange={n => setRule(key, {minFontSize: n})}
            />
            <NumberField
              label="Max size"
              value={rules[key].maxFontSize}
              min={0}
              max={1000}
              width={84}
              onChange={n => setRule(key, {maxFontSize: n})}
            />
            {STYLES.map(style => (
              <View key={style.key} style={styles.style}>
                <Text style={styles.styleLabel}>{style.label}</Text>
                <Segmented<StyleRequirement>
                  size="small"
                  accessibilityLabel={`${label} ${style.label}`}
                  options={REQUIREMENT_OPTIONS}
                  value={rules[key][style.key]}
                  onChange={value => setRule(key, {[style.key]: value})}
                />
              </View>
            ))}
          </View>
        ))}
        <View style={styles.buttons}>
          <PillButton size="small" label="Reset to defaults" onPress={() => onChange(DEFAULT_EXPORT_CLASSIFICATION_CONFIG)} />
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
    gap: SPACING.sm,
  },
  hint: {
    fontSize: FONT.small,
    color: COLORS.muted,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingVertical: SPACING.sm,
  },
  className: {
    width: 96,
    fontSize: FONT.medium,
    fontWeight: '700',
    color: COLORS.text,
    paddingTop: 26,
  },
  style: {
    width: 168,
    gap: 2,
  },
  styleLabel: {
    fontSize: FONT.small,
    color: COLORS.muted,
  },
  buttons: {
    flexDirection: 'row',
    marginTop: SPACING.sm,
  },
});
