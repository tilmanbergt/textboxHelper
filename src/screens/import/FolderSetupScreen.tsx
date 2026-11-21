/**
 * Binding a whole folder (technical-design-linked-files.md §2.1): the folder's text files, all
 * chosen at first (a file left out isn't offered again later unless taken back), and whether the
 * folder is ordered — then the note's order of the files is kept in the folder's index.txt, which
 * the plugin writes. A folder that has an index.txt is ordered by it. Ten files a page, no
 * scrolling.
 */
import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {ImportFolder} from '../../actions/folderLink';
import {startOrder} from '../../domain/noteLinks';
import {plural} from '../../domain/plural';
import Checkbox from '../../ui/Checkbox';
import PillButton from '../../ui/PillButton';
import ScreenFrame, {type FrameStatus} from '../../ui/ScreenFrame';
import Segmented from '../../ui/Segmented';
import {COLORS, FONT, SPACING} from '../../ui/theme';
import type {FolderSetup} from './useTextImport';

interface Props {
  folder: ImportFolder;
  setup: FolderSetup;
  onChange: (next: FolderSetup) => void;
  status: FrameStatus | null;
  onBack: () => void;
  onClose: () => void;
}

const ROWS = 10;

function kilobytes(size: number): string {
  return size < 1024 ? `${size} B` : `${Math.round(size / 1024)} KB`;
}

export default function FolderSetupScreen({folder, setup, onChange, status, onBack, onClose}: Props): React.JSX.Element {
  const [page, setPage] = useState(0);
  const files = startOrder(folder.files, setup.ordered ? folder.index : null, setup.orderBy);
  const pages = Math.max(1, Math.ceil(files.length / ROWS));
  const shown = files.slice(page * ROWS, page * ROWS + ROWS);
  const skipped = new Set(setup.skipped);
  const chosen = files.length - files.filter(file => skipped.has(file.name)).length;
  const name = folder.path.split('/').filter(Boolean).slice(-1)[0] ?? folder.path;
  const toggle = (file: string, on: boolean) =>
    onChange({...setup, skipped: on ? setup.skipped.filter(item => item !== file) : [...setup.skipped, file]});

  return (
    <ScreenFrame
      title={`Folder ${name}`}
      context={`${chosen} of ${plural(files.length, 'file')}`}
      back={{label: 'Import', onPress: onBack}}
      onClose={onClose}
      status={status ?? {text: 'The note is bound to this folder: its new files can be added later.'}}
      primary={{label: 'Done', onPress: onBack}}
      screenKey={`import-folder-${page}`}>
      <View style={styles.body}>
        <View style={styles.section}>
          <Text style={styles.title}>Order</Text>
          {folder.index ? (
            <Text style={styles.hint}>
              Ordered by its index.txt. The plugin rewrites index.txt from now on with the note's order (lines
              without a [[link]] are dropped).
            </Text>
          ) : (
            <>
              <Segmented
                options={[
                  {key: 'unordered', label: 'Unordered (a collection)'},
                  {key: 'ordered', label: 'Ordered (chapters, steps)'},
                ]}
                value={setup.ordered ? 'ordered' : 'unordered'}
                onChange={value => onChange({...setup, ordered: value === 'ordered'})}
              />
              <Text style={styles.hint}>
                {setup.ordered
                  ? 'The plugin creates index.txt with the order of the files on the note; move files in the Outline to change it.'
                  : 'Files by name; their order on the note is not written anywhere.'}
              </Text>
              {setup.ordered && (
                <Segmented
                  options={[
                    {key: 'name', label: 'Start by name'},
                    {key: 'date', label: 'Start by date'},
                  ]}
                  value={setup.orderBy}
                  onChange={orderBy => onChange({...setup, orderBy})}
                />
              )}
            </>
          )}
        </View>
        <View style={styles.section}>
          <Text style={styles.title}>Files</Text>
          {files.length === 0 && <Text style={styles.hint}>The folder has no .txt files.</Text>}
          {shown.map(file => (
            <View key={file.name} style={styles.row}>
              <View style={styles.check}>
                <Checkbox
                  label={file.name.replace(/\.txt$/i, '')}
                  checked={!skipped.has(file.name)}
                  onChange={on => toggle(file.name, on)}
                />
              </View>
              <Text style={styles.hint}>{kilobytes(file.size)}</Text>
            </View>
          ))}
          {pages > 1 && (
            <View style={styles.row}>
              <PillButton size="small" label="‹" accessibilityLabel="Previous files" disabled={page === 0} onPress={() => setPage(page - 1)} />
              <Text style={styles.hint}>
                {page + 1} / {pages}
              </Text>
              <PillButton size="small" label="›" accessibilityLabel="Next files" disabled={page >= pages - 1} onPress={() => setPage(page + 1)} />
            </View>
          )}
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
    alignItems: 'center',
    gap: SPACING.base,
  },
  check: {
    flex: 1,
  },
});
