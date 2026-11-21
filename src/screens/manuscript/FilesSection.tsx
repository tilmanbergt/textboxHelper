/**
 * Details → Files (technical-design-linked-files.md §3.3): the note's linked files, a few rows at a
 * time (no scrolling), each with its state; the chosen file's own part below (where it is, when
 * it was imported and written, its block counts and warnings, Save as copy, Save to EXPORT, Check
 * write access, Unlink); Restore titles for the note; and in folder mode the folder (ordered or
 * not, its new files and files left out, the index).
 */
import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {LinkedFile} from '../../actions/linkedFiles';
import {FILE_STATE_GLYPH, FILE_STATE_LABEL} from '../../domain/fileState';
import {plural} from '../../domain/plural';
import {sourceFileName, sourceFolder} from '../../domain/sourceRecord';
import PillButton from '../../ui/PillButton';
import Segmented from '../../ui/Segmented';
import {COLORS, FONT, SPACING} from '../../ui/theme';
import type {LinkedFiles} from './useLinkedFiles';

const ROWS = 4;

export default function FilesSection({source}: {source: LinkedFiles}): React.JSX.Element | null {
  const files = source.note?.files ?? [];
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  if (files.length === 0 && !source.note?.folder) {
    return null;
  }
  const chosen = files.find(file => file.record.sourceId === chosenId) ?? files[0];
  const pages = Math.ceil(files.length / ROWS);
  const shown = files.slice(page * ROWS, page * ROWS + ROWS);
  const orphans = source.note?.orphans ?? 0;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{files.length === 1 ? 'Linked file' : `Linked files · ${files.length}`}</Text>
      {files.length > 1 && (
        <View>
          {shown.map(file => (
            <Pressable
              key={file.record.sourceId}
              accessibilityRole="button"
              onPress={() => setChosenId(file.record.sourceId)}
              style={[styles.row, file === chosen && styles.rowChosen]}>
              <Text style={styles.glyph}>{FILE_STATE_GLYPH[file.state]}</Text>
              <Text style={styles.rowName} numberOfLines={1}>
                {sourceFileName(file.record)}
              </Text>
              <Text style={styles.hint}>{FILE_STATE_LABEL[file.state]}</Text>
            </Pressable>
          ))}
          {pages > 1 && (
            <View style={styles.buttons}>
              <PillButton size="small" label="‹" accessibilityLabel="Previous files" disabled={page === 0} onPress={() => setPage(page - 1)} />
              <Text style={styles.hint}>
                {page + 1} / {pages}
              </Text>
              <PillButton size="small" label="›" accessibilityLabel="Next files" disabled={page >= pages - 1} onPress={() => setPage(page + 1)} />
            </View>
          )}
        </View>
      )}
      {orphans > 0 && (
        <Text style={styles.hint}>⚠ {plural(orphans, 'textbox', 'textboxes')} before the first file title belong to no linked file.</Text>
      )}
      {source.note?.folder && <FolderPart source={source} />}
      {chosen && <FileDetails source={source} file={chosen} />}
      <View style={styles.buttons}>
        <PillButton size="small" label="Restore titles" disabled={source.busy} onPress={source.restoreTitles} />
      </View>
    </View>
  );
}

function names(list: string[]): string {
  const shown = list.slice(0, 3).map(name => name.replace(/\.txt$/i, '')).join(', ');
  return list.length > 3 ? `${shown} +${list.length - 3}` : shown;
}

const INDEX_LINE: Record<string, string> = {
  inSync: 'index.txt follows the note.',
  stale: 'index.txt is written at the next Update.',
  changedOutside: 'index.txt was changed in Obsidian; it is only overwritten on request.',
};

/** The bound folder: ordered or not, its index, new files and files left out. */
function FolderPart({source}: {source: LinkedFiles}): React.JSX.Element | null {
  const state = source.note?.folder;
  if (!state) {
    return null;
  }
  const {folder} = state;
  return (
    <View style={styles.file}>
      <View style={styles.buttons}>
        <Text style={styles.line}>Folder {state.name}</Text>
        <Segmented
          options={[
            {key: 'ordered', label: 'Ordered'},
            {key: 'unordered', label: 'Unordered'},
          ]}
          value={folder.ordered ? 'ordered' : 'unordered'}
          onChange={value => value !== (folder.ordered ? 'ordered' : 'unordered') && source.setOrdered(value === 'ordered')}
        />
      </View>
      {state.problem && <Text style={styles.hint}>⚠ {state.problem}</Text>}
      {state.index && (
        <View style={styles.buttons}>
          <Text style={styles.hint}>{INDEX_LINE[state.index]}</Text>
          {state.index === 'changedOutside' && (
            <PillButton size="small" label="Rewrite index.txt" disabled={source.busy} onPress={source.rewriteIndex} />
          )}
        </View>
      )}
      {state.newFiles.length > 0 && (
        <View style={styles.buttons}>
          <Text style={styles.hint} numberOfLines={1}>
            New: {names(state.newFiles)}
          </Text>
          <PillButton size="small" label={`Add ${state.newFiles.length}`} disabled={source.busy || source.added} onPress={() => source.addFiles(state.newFiles)} />
          <PillButton size="small" label="Leave out" disabled={source.busy} onPress={() => source.leaveOut(state.newFiles, true)} />
        </View>
      )}
      {state.leftOut.length > 0 && (
        <View style={styles.buttons}>
          <Text style={styles.hint} numberOfLines={1}>
            Left out: {names(state.leftOut)}
          </Text>
          <PillButton size="small" label="Take back" disabled={source.busy} onPress={() => source.leaveOut(state.leftOut, false)} />
        </View>
      )}
    </View>
  );
}

/** "2026-11-20 17:04" in the device's time. */
function shortTime(iso: string | null): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function FileDetails({source, file}: {source: LinkedFiles; file: LinkedFile}): React.JSX.Element {
  const [confirmUnlink, setConfirmUnlink] = useState<string | null>(null);
  const {record, diff, regeneration} = file;
  const folder = sourceFolder(record.filePath).replace(/^\/storage\/emulated\/0\//, '');
  const counts = regeneration.counts;
  const state = diff.differs
    ? `${FILE_STATE_LABEL[file.state]}: ${plural(diff.changedBlocks, 'changed block')}.`
    : `${FILE_STATE_LABEL[file.state]}.`;
  const blocks = [
    `${counts.unchanged} unchanged`,
    counts.edited ? `${counts.edited} edited` : null,
    counts.added ? `${counts.added} new` : null,
    counts.movedIn ? `${counts.movedIn} from other files` : null,
    counts.missing ? `${counts.missing} missing` : null,
    counts.protectedKept ? `${counts.protectedKept} kept as is` : null,
    counts.protectedRemoved ? `${counts.protectedRemoved} removed` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const name = sourceFileName(record);
  const own = source.warnings.filter(warning => source.note?.files.length === 1 || warning.startsWith(`${name}: `));
  const warnings = own.slice(0, 3);
  const access = source.access[record.sourceId];
  return (
    <View style={styles.file}>
      <Text style={styles.line}>
        {name} <Text style={styles.hint}>in {folder || 'storage'}</Text>
      </Text>
      <Text style={styles.hint}>
        Imported {shortTime(record.importedAt)}
        {record.lastWrittenAt ? ` · last written ${shortTime(record.lastWrittenAt)}` : ' · not written yet'}
        {file.hasDivider ? '' : ' · no file title on the note'}
      </Text>
      <Text style={styles.hint}>
        {state} {blocks}.
      </Text>
      {warnings.map(warning => (
        <Text key={warning} style={styles.hint} numberOfLines={1}>
          ⚠ {warning}
        </Text>
      ))}
      {own.length > warnings.length && <Text style={styles.hint}>+{own.length - warnings.length} more warnings</Text>}
      {access && <Text style={styles.hint}>{access}</Text>}
      {confirmUnlink === record.sourceId ? (
        <View style={styles.buttons}>
          <Text style={styles.hint}>Unlink {name}? The note and the file stay as they are.</Text>
          <PillButton
            size="small"
            label="Unlink"
            disabled={source.busy}
            onPress={() => {
              setConfirmUnlink(null);
              source.unlink(file);
            }}
          />
          <PillButton size="small" label="Cancel" onPress={() => setConfirmUnlink(null)} />
        </View>
      ) : (
        <View style={styles.buttons}>
          <PillButton size="small" label="Save as copy" disabled={source.busy} onPress={() => source.saveCopy(record.sourceId, 'copy')} />
          <PillButton size="small" label="Save to EXPORT" disabled={source.busy} onPress={() => source.saveCopy(record.sourceId, 'export')} />
          <PillButton size="small" label="Check write access" disabled={source.busy} onPress={() => source.checkAccess(file)} />
          <PillButton size="small" label="Unlink" disabled={source.busy} onPress={() => setConfirmUnlink(record.sourceId)} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: SPACING.sm,
  },
  sectionTitle: {
    fontSize: FONT.medium,
    fontWeight: '700',
    color: COLORS.text,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingBottom: SPACING.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  rowChosen: {
    borderColor: COLORS.accent,
  },
  glyph: {
    width: 20,
    fontSize: FONT.medium,
    color: COLORS.text,
  },
  rowName: {
    flex: 1,
    fontSize: FONT.medium,
    color: COLORS.text,
  },
  file: {
    gap: SPACING.xs,
  },
  hint: {
    fontSize: FONT.small,
    color: COLORS.muted,
    lineHeight: 21,
  },
  line: {
    fontSize: FONT.medium,
    color: COLORS.text,
  },
  buttons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
});
