/**
 * Settings → Layout (technical-design-settings-layout-files.md §3): the page layout every import,
 * Outline change and Clean up uses — margins, which headings start a new page — and the styles of
 * paragraphs and headings. Every change is kept at once; existing pages keep their layout until a
 * change touches them or Clean up layout runs.
 */
import React, {useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {HEADING_LEVELS} from '../../../domain/headingText';
import {
  headingsAreBold,
  withDefaultStyles,
  withHeadingFontSize,
  withHeadingsBold,
  withParagraphFontSize,
  type TextboxImportSettings,
} from '../../../domain/importSettings';
import {DEFAULT_PAGE_LAYOUT, type PageLayout, type PageMargins} from '../../../domain/pageLayout';
import {getSettings, updateSettings} from '../../../storage/settingsFile';
import Checkbox from '../../../ui/Checkbox';
import NumberField from '../../../ui/NumberField';
import PillButton from '../../../ui/PillButton';
import {SPACING} from '../../../ui/theme';
import {Hint, Row, Section} from './SettingsParts';

const MAX_MARGIN = 1000;
const MIN_FONT = 8;
const MAX_FONT = 200;

interface Props {
  /** Clean up layout, when the card offers it (technical-design-settings-layout-files.md §2). */
  cleanup?: React.ReactNode;
}

export default function LayoutSettings({cleanup}: Props): React.JSX.Element {
  const [layout, setLayout] = useState<PageLayout>(getSettings().layout);
  const [styles, setStyles] = useState<TextboxImportSettings>(getSettings().import);
  const changeLayout = (next: PageLayout) => {
    updateSettings(current => ({...current, layout: next}));
    setLayout(next);
  };
  const changeStyles = (next: TextboxImportSettings) => {
    updateSettings(current => ({...current, import: {...current.import, fontSize: next.fontSize, structure: next.structure}}));
    setStyles(next);
  };
  const margin = (key: keyof PageMargins, label: string) => (
    <NumberField
      label={label}
      value={layout.margins[key]}
      min={0}
      max={MAX_MARGIN}
      width={96}
      onChange={n => changeLayout({...layout, margins: {...layout.margins, [key]: n}})}
    />
  );
  const size = (key: 'heading1' | 'heading2' | 'heading3', label: string) => (
    <NumberField
      label={label}
      value={styles.structure[key].fontSize}
      min={MIN_FONT}
      max={MAX_FONT}
      width={96}
      onChange={n => changeStyles(withHeadingFontSize(styles, key, n))}
    />
  );

  return (
    <View style={layoutStyles.columns}>
      <View style={layoutStyles.column}>
        <Section title="Page">
          <Hint>Margins in page pixels. The defaults leave room for handwriting on the right and at the bottom.</Hint>
          <Row>
            {margin('left', 'Left')}
            {margin('top', 'Top')}
            {margin('right', 'Right')}
            {margin('bottom', 'Bottom')}
          </Row>
          <Row>
            <Hint>New page before</Hint>
            {HEADING_LEVELS.map(level => (
              <Checkbox
                key={level}
                label={'#'.repeat(level)}
                checked={layout.breakBefore.includes(level)}
                onChange={on =>
                  changeLayout({
                    ...layout,
                    breakBefore: HEADING_LEVELS.filter(item => (item === level ? on : layout.breakBefore.includes(item))),
                  })
                }
              />
            ))}
          </Row>
          <Hint>Every linked file starts on a new page.</Hint>
        </Section>
        {cleanup}
      </View>
      <View style={layoutStyles.column}>
        <Section title="Text">
          <Row>
            <NumberField
              label="Paragraph"
              value={styles.fontSize}
              min={MIN_FONT}
              max={MAX_FONT}
              width={96}
              onChange={n => changeStyles(withParagraphFontSize(styles, n))}
            />
            {size('heading1', '# size')}
            {size('heading2', '## size')}
            {size('heading3', '### size')}
          </Row>
          <Checkbox
            label="Bold headings"
            checked={headingsAreBold(styles)}
            onChange={bold => changeStyles(withHeadingsBold(styles, bold))}
          />
          <Hint>Used by the next import, by level changes in the Outline and by Clean up layout.</Hint>
        </Section>
        <Row>
          <PillButton
            size="small"
            label="Reset to defaults"
            onPress={() => {
              changeLayout(DEFAULT_PAGE_LAYOUT);
              changeStyles(withDefaultStyles(styles));
            }}
          />
        </Row>
      </View>
    </View>
  );
}

const layoutStyles = StyleSheet.create({
  columns: {
    flex: 1,
    flexDirection: 'row',
    gap: SPACING.xl,
  },
  column: {
    flex: 1,
    gap: SPACING.xl,
  },
});
