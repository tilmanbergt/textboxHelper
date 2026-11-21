/**
 * Settings → Layout → Clean up layout (technical-design-settings-layout-files.md §2): lays the
 * whole note or one linked file out again with the current layout and styles. It is planned in the
 * Outline like its other changes and applied there with Apply; a file whose divider shares its page
 * with the file before can only be cleaned up as part of the whole note.
 */
import React, {useEffect, useMemo, useState} from 'react';
import {StyleSheet, Text} from 'react-native';
import {fileStartsPage} from '../../../domain/cleanupLayout';
import {GLYPH} from '../../../ui/glyphs';
import PillButton from '../../../ui/PillButton';
import TextChoices from '../../../ui/TextChoices';
import TextLink from '../../../ui/TextLink';
import {COLORS, FONT} from '../../../ui/theme';
import type {Outline} from '../outline/useOutline';
import {Hint, Row, Section} from './SettingsParts';

interface Props {
  outline: Outline;
  /** Called once the clean up is planned: the card shows it in the Outline. */
  onPlanned: () => void;
}

export default function CleanupSection({outline, onPlanned}: Props): React.JSX.Element {
  const {blocks, load, loading} = outline;
  useEffect(() => {
    if (!blocks) {
      load();
    }
  }, [blocks, load]);
  const files = useMemo(
    () => (blocks ?? []).filter(block => block.kind === 'file' && block.fileSource && fileStartsPage(blocks ?? [], block.fileSource)),
    [blocks],
  );
  const [scope, setScope] = useState<'note' | 'file'>('note');
  const [fileIndex, setFileIndex] = useState(0);
  const file = files[Math.min(fileIndex, files.length - 1)];
  const sharing = (blocks ?? []).filter(block => block.kind === 'file').length - files.length;

  return (
    <Section title="Clean up layout">
      <Hint>
        Lays the text out again with these margins and sizes: every textbox full width, in the size of its level,
        long paragraphs cut to fit. Handwriting stays where it is. It is planned in the Outline; Apply there does it.
      </Hint>
      {files.length > 0 ? (
        <TextChoices
          size="small"
          choices={[
            {key: 'note', label: 'Whole note'},
            {key: 'file', label: 'One file'},
          ]}
          value={scope}
          onChange={setScope}
        />
      ) : null}
      {scope === 'file' && file ? (
        <Row>
          <TextLink label="‹" accessibilityLabel="Previous file" disabled={fileIndex === 0} onPress={() => setFileIndex(fileIndex - 1)} />
          <Text style={styles.file} numberOfLines={1}>
            {GLYPH.file} {file.firstLine}
          </Text>
          <TextLink
            label={GLYPH.next}
            accessibilityLabel="Next file"
            disabled={fileIndex >= files.length - 1}
            onPress={() => setFileIndex(fileIndex + 1)}
          />
        </Row>
      ) : null}
      {scope === 'file' && sharing > 0 ? (
        <Hint>Files that share their first page with the file before are cleaned up with the whole note.</Hint>
      ) : null}
      <Row>
        <PillButton
          size="small"
          label={loading || !blocks ? 'Reading the outline…' : 'Plan clean up'}
          disabled={loading || !blocks || (scope === 'file' && !file)}
          onPress={() => {
            outline.cleanUp(
              scope === 'file' && file?.fileSource ? {kind: 'file', sourceId: file.fileSource} : {kind: 'note'},
            );
            onPlanned();
          }}
        />
      </Row>
    </Section>
  );
}

const styles = StyleSheet.create({
  file: {
    flexShrink: 1,
    fontSize: FONT.medium,
    color: COLORS.text,
  },
});
