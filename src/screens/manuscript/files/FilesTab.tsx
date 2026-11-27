/**
 * The Manuscript card's Files tab (technical-design-settings-layout-files.md §4): what goes into
 * this note and out of it. Left, the note's linked files (their states, Update, Save as copy,
 * Unlink, the folder). Right, Import a text file or a whole folder (on a note with linked files:
 * Add a file), Import from URL, and Export DOCX; each opens as a sub-screen of the card.
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {plural} from '../../../domain/plural';
import {GLYPH} from '../../../ui/glyphs';
import TextLink from '../../../ui/TextLink';
import {COLORS, FONT, SPACING} from '../../../ui/theme';
import type {LinkedFiles} from '../useLinkedFiles';
import FilesSection from './FilesSection';

interface Props {
  source: LinkedFiles;
  disabled: boolean;
  onImport: (wholeFolder: boolean) => void;
  /** Import from URL (technical-design-import-from-url.md §1). */
  onImportUrl: () => void;
  onExport: () => void;
}

export default function FilesTab({source, disabled, onImport, onImportUrl, onExport}: Props): React.JSX.Element {
  const note = source.note;
  const linked = (note?.files.length ?? 0) > 0;
  const folder = note?.folder ?? null;
  return (
    <View style={styles.columns}>
      <View style={styles.left}>
        {linked || folder ? (
          <FilesSection source={source} />
        ) : (
          <Text style={styles.hint}>
            No linked files. Import a text file with “Link to file” to write your changes back to it later, or bind a
            whole folder.
          </Text>
        )}
      </View>
      <View style={styles.right}>
        <Text style={styles.title}>Into this note</Text>
        {folder ? (
          <Text style={styles.hint}>
            Bound to the folder {folder.name}: its new files are added from the list on the left
            {folder.newFiles.length > 0 ? ` (${plural(folder.newFiles.length, 'new file')})` : ''}.
          </Text>
        ) : linked ? (
          <>
            <TextLink label={`Add a file ${GLYPH.next}`} disabled={disabled} onPress={() => onImport(false)} />
            <Text style={styles.hint}>Linked, on a new page after the last one, with its name as a title.</Text>
            <TextLink label={`Import from URL ${GLYPH.next}`} disabled={disabled} onPress={onImportUrl} />
            <Text style={styles.hint}>A text or Markdown file from your network, e.g. VoiceDraft; added like a file.</Text>
          </>
        ) : (
          <>
            <TextLink label={`Import a text file ${GLYPH.next}`} disabled={disabled} onPress={() => onImport(false)} />
            <TextLink label={`Import a whole folder ${GLYPH.next}`} disabled={disabled} onPress={() => onImport(true)} />
            <Text style={styles.hint}>.txt or Obsidian notes from any folder; the layout is set in Settings → Layout.</Text>
            <TextLink label={`Import from URL ${GLYPH.next}`} disabled={disabled} onPress={onImportUrl} />
            <Text style={styles.hint}>A text or Markdown file from your network, e.g. VoiceDraft.</Text>
          </>
        )}
        <Text style={[styles.title, styles.next]}>Out of this note</Text>
        <TextLink label={`Export DOCX ${GLYPH.next}`} disabled={disabled} onPress={onExport} />
        <Text style={styles.hint}>A Word file in the EXPORT folder; the note doesn’t change.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  columns: {
    flex: 1,
    flexDirection: 'row',
  },
  left: {
    flex: 3,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.base,
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
  },
  right: {
    flex: 2,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.base,
    gap: SPACING.xs,
  },
  title: {
    fontSize: FONT.small,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: COLORS.muted,
  },
  next: {
    marginTop: SPACING.xl,
  },
  hint: {
    fontSize: FONT.small,
    color: COLORS.muted,
    lineHeight: 21,
  },
});
