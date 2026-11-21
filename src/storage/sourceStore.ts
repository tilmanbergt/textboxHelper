import RNFS from 'react-native-fs';
import {PluginManager} from 'sn-plugin-lib';
import {
  buildNoteLinksPath,
  buildSourceOriginalPath,
  buildSourcePreviousPath,
  buildSourceRecordPath,
} from '../domain/backupPaths';
import {noteKey, parseNoteLinks, serializeNoteLinks, type NoteLinks} from '../domain/noteLinks';
import {parseSourceRecord, serializeSourceRecord, type SourceRecord} from '../domain/sourceRecord';
import {writeTextAtomic} from './jsonFile';

/**
 * The records of linked text files in `<plugin folder>/sources/` (technical-design-source-link.md
 * §2.3): one JSON file per linked file and one per linked note (technical-design-linked-files.md
 * §1.3), written through a temporary file; the copy of a file's original text kept before the
 * first write-back, and its text before the latest write.
 */

async function pluginDir(): Promise<string> {
  const dir = await PluginManager.getPluginDirPath();
  if (!dir) {
    throw new Error('Could not find the plugin folder.');
  }
  return dir;
}

async function ensureFolder(path: string): Promise<void> {
  const folder = path.slice(0, path.lastIndexOf('/'));
  if (!(await RNFS.exists(folder))) {
    await RNFS.mkdir(folder);
  }
}

export async function writeSourceRecord(record: SourceRecord): Promise<void> {
  await writeTextAtomic(buildSourceRecordPath(await pluginDir(), record.sourceId), serializeSourceRecord(record));
}

/** The record, or null when there is none or it can't be read. */
export async function readSourceRecord(sourceId: string): Promise<SourceRecord | null> {
  try {
    const path = buildSourceRecordPath(await pluginDir(), sourceId);
    if (!(await RNFS.exists(path))) {
      return null;
    }
    const record = parseSourceRecord(await RNFS.readFile(path, 'utf8'));
    if (!record) {
      console.warn('[SourceLink] record unreadable', sourceId);
    }
    return record;
  } catch (error) {
    console.warn('[SourceLink] record not read', sourceId, String(error));
    return null;
  }
}

export async function deleteSourceRecord(sourceId: string): Promise<void> {
  const path = buildSourceRecordPath(await pluginDir(), sourceId);
  if (await RNFS.exists(path)) {
    await RNFS.unlink(path);
  }
}

/** Keeps the file's original text once, before the plugin writes the file for the first time. */
export async function keepOriginalCopy(record: SourceRecord): Promise<void> {
  const path = buildSourceOriginalPath(await pluginDir(), record.sourceId);
  if (await RNFS.exists(path)) {
    return;
  }
  await ensureFolder(path);
  await RNFS.writeFile(path, record.original, 'utf8');
}

/** Keeps the file's text as it was before this write (replacing the copy of the write before). */
export async function keepPreviousCopy(record: SourceRecord, text: string): Promise<void> {
  const path = buildSourcePreviousPath(await pluginDir(), record.sourceId);
  await ensureFolder(path);
  await RNFS.writeFile(path, text, 'utf8');
}

/** The linked files of a note (technical-design-linked-files.md §1.3), or null when it has none. */
export async function readNoteLinks(notePath: string): Promise<NoteLinks | null> {
  try {
    const path = buildNoteLinksPath(await pluginDir(), noteKey(notePath));
    if (!(await RNFS.exists(path))) {
      return null;
    }
    const links = parseNoteLinks(await RNFS.readFile(path, 'utf8'));
    if (!links) {
      console.warn('[SourceLink] note links unreadable');
    }
    return links;
  } catch (error) {
    console.warn('[SourceLink] note links not read', String(error));
    return null;
  }
}

export async function writeNoteLinks(links: NoteLinks): Promise<void> {
  await writeTextAtomic(buildNoteLinksPath(await pluginDir(), noteKey(links.notePath)), serializeNoteLinks(links));
}
