import RNFS from 'react-native-fs';
import {PluginManager} from 'sn-plugin-lib';
import {buildSourceOriginalPath, buildSourceRecordPath} from '../domain/backupPaths';
import {parseSourceRecord, serializeSourceRecord, type SourceRecord} from '../domain/sourceRecord';

/**
 * The records of linked text files in `<plugin folder>/sources/` (technical-design-source-link.md
 * §2.3): one JSON file per linked file, written through a temporary file, and the copy of the
 * original text kept before the first write-back.
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
  const path = buildSourceRecordPath(await pluginDir(), record.sourceId);
  await ensureFolder(path);
  const temporary = `${path}.tmp`;
  await RNFS.writeFile(temporary, serializeSourceRecord(record), 'utf8');
  if (await RNFS.exists(path)) {
    await RNFS.unlink(path);
  }
  await RNFS.moveFile(temporary, path);
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
