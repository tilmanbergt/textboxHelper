/**
 * Settings → Export: the classification rules of Export DOCX — whether textboxes in title areas
 * are headings, and per class the size range and whether bold, italic and a border are required
 * (Any / Yes / No). Every valid change is saved; a class whose min size is above its max size is
 * named and the last valid rules stay in use.
 */
import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {
  DEFAULT_EXPORT_CLASSIFICATION_CONFIG,
  type ExportClassificationConfig,
  type RoleRuleConfig,
  type StyleRequirement,
} from '../../../domain/exportConfig';
import {exportRulesProblem} from '../../../domain/exportRulesCheck';
import {getSettings, updateSettings} from '../../../storage/settingsFile';
import Checkbox from '../../../ui/Checkbox';
import NumberField from '../../../ui/NumberField';
import PillButton from '../../../ui/PillButton';
import Segmented from '../../../ui/Segmented';
import {COLORS, FONT, SPACING} from '../../../ui/theme';
import {Hint, Row, Section} from './SettingsParts';

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

export default function ExportSettings(): React.JSX.Element {
  const [rules, setRules] = useState<ExportClassificationConfig>(getSettings().export.rules);
  const problem = exportRulesProblem(rules);
  const change = (next: ExportClassificationConfig) => {
    setRules(next);
    if (!exportRulesProblem(next)) {
      updateSettings(current => ({...current, export: {...current.export, rules: next}}));
    }
  };
  const setRule = (key: ClassKey, next: Partial<RoleRuleConfig>) => change({...rules, [key]: {...rules[key], ...next}});

  return (
    <Section title="Classification rules of Export DOCX">
      {problem ? <Text style={styles.error}>{problem} The last valid rules are still used.</Text> : null}
      <Checkbox
        label="Textboxes in Supernote title areas are headings"
        checked={rules.treatTitleTextBoxesAsHeadings}
        onChange={value => change({...rules, treatTitleTextBoxesAsHeadings: value})}
      />
      <Hint>Every other textbox gets the first class whose rules it matches. Any matches with and without the style.</Hint>
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
      <Row>
        <PillButton size="small" label="Reset to defaults" onPress={() => change(DEFAULT_EXPORT_CLASSIFICATION_CONFIG)} />
      </Row>
    </Section>
  );
}

const styles = StyleSheet.create({
  error: {
    fontSize: FONT.medium,
    fontWeight: '700',
    color: COLORS.text,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingVertical: SPACING.xs,
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
});
