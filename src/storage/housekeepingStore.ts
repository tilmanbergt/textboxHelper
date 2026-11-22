import RNFS from 'react-native-fs';
import {PluginManager} from 'sn-plugin-lib';
import {buildBackupDir} from '../domain/backupPaths';
import {
  backupsToRemove,
  NOTHING_REMOVED,
  type HousekeepingResult,
  type StoredFile,
} from '../domain/housekeeping';

/**
 * File I/O for housekeeping (technical-design-housekeeping.md): folder listings, removing paths,
 * the plugin folder's size, and keeping the backup folder within its limits.
 */

export async function pluginFolder(): Promise<string> {
  const dir = await PluginManager.getPluginDirPath();
  if (!dir) {
    throw new Error('Could not find the plugin folder.');
  }
  return dir.replace(/\/+$/, '');
}

/** The folder's entries; an empty list when it doesn't exist. */
export async function listFolder(path: string): Promise<StoredFile[]> {
  if (!(await RNFS.exists(path))) {
    return [];
  }
  const items = await RNFS.readDir(path);
  return items.map(item => ({
    name: item.name,
    isDirectory: item.isDirectory(),
    mtimeMs: item.mtime ? new Date(item.mtime).getTime() : NaN,
    size: Number(item.size) || 0,
  }));
}

/** Files and bytes under a path (a file counts as one). */
export async function folderStats(path: string): Promise<{files: number; bytes: number}> {
  if (!(await RNFS.exists(path))) {
    return {files: 0, bytes: 0};
  }
  const stat = await RNFS.stat(path);
  if (!stat.isDirectory()) {
    return {files: 1, bytes: Number(stat.size) || 0};
  }
  let files = 0;
  let bytes = 0;
  for (const item of await RNFS.readDir(path)) {
    const inner = item.isDirectory() ? await folderStats(item.path) : {files: 1, bytes: Number(item.size) || 0};
    files += inner.files;
    bytes += inner.bytes;
  }
  return {files, bytes};
}

/** Removes the named entries of a folder; returns how many files and bytes went. */
export async function removeFromFolder(folder: string, names: string[]): Promise<{files: number; bytes: number}> {
  let files = 0;
  let bytes = 0;
  for (const name of names) {
    const path = `${folder}/${name}`;
    try {
      const stats = await folderStats(path);
      await RNFS.unlink(path);
      files += stats.files;
      bytes += stats.bytes;
    } catch (error) {
      console.warn('[Housekeeping] not removed', JSON.stringify({path, error: String(error)}));
    }
  }
  return {files, bytes};
}

/** Keeps the backup folder at its limits (the newest few, none too old). */
export async function pruneBackups(nowMs: number = Date.now()): Promise<HousekeepingResult> {
  const folder = buildBackupDir(await pluginFolder());
  const names = backupsToRemove(await listFolder(folder), nowMs);
  if (names.length === 0) {
    return NOTHING_REMOVED;
  }
  const removed = await removeFromFolder(folder, names);
  return {...NOTHING_REMOVED, ...removed, backups: names.length};
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    return await RNFS.exists(path);
  } catch {
    return false;
  }
}

export async function readTextFile(path: string): Promise<string> {
  return RNFS.readFile(path, 'utf8');
}
