/**
 * Settings → Outline (technical-design-outline-sections.md §8): the level of a textbox under a
 * title without #s, which levels get a NOTE title, Restore titles, Read the outline again. Changes
 * are kept and the outline is read again with them.
 */
import React, {useState} from 'react';
import {HEADING_LEVELS, type HeadingLevel} from '../../../domain/headingText';
import {getSettings, updateSettings} from '../../../storage/settingsFile';
import Checkbox from '../../../ui/Checkbox';
import PillButton from '../../../ui/PillButton';
import TextChoices from '../../../ui/TextChoices';
import type {LinkedFiles} from '../useLinkedFiles';
import type {Outline} from '../outline/useOutline';
import {Hint, Row, Section} from './SettingsParts';

export default function OutlineSettings({outline, source}: {outline: Outline; source: LinkedFiles}): React.JSX.Element {
  const [settings, setSettings] = useState(getSettings().outline);
  const change = (next: typeof settings) => {
    updateSettings(current => ({...current, outline: next}));
    setSettings(next);
  };
  const levels = HEADING_LEVELS.map(level => ({key: level, label: '#'.repeat(level)}));
  return (
    <Section title="Headings">
      <TextChoices
        caption="A textbox under a title you made is a heading of level"
        size="small"
        choices={levels}
        value={settings.defaultHeadingLevel}
        onChange={level => {
          change({...settings, defaultHeadingLevel: level as HeadingLevel});
          outline.clear();
        }}
      />
      <Row>
        <Hint>Titles for</Hint>
        {HEADING_LEVELS.map(level => (
          <Checkbox
            key={level}
            label={'#'.repeat(level)}
            checked={settings.titleLevels.includes(level)}
            onChange={on =>
              change({
                ...settings,
                titleLevels: HEADING_LEVELS.filter(item => (item === level ? on : settings.titleLevels.includes(item))),
              })
            }
          />
        ))}
      </Row>
      <Hint>
        Headings of these levels get a NOTE title, so they show in the note’s table of contents. Restore titles puts
        them right on every page now; Apply does it on the pages it changes.
      </Hint>
      <Row>
        <PillButton size="small" label="Restore titles" disabled={source.busy} onPress={source.restoreTitles} />
        <PillButton
          size="small"
          label="Read the outline again"
          disabled={outline.loading || outline.plan.length > 0}
          onPress={outline.clear}
        />
      </Row>
    </Section>
  );
}
