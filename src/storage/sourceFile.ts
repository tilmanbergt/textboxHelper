import RNFS from 'react-native-fs';
import {FileUtils} from 'sn-plugin-lib';

/**
 * Reading and writing a linked text file where it lives (technical-design-source-link.md §5).
 *
 * The host lets plugins copy files into EXPORT through `FileUtils.copyFile`; whether a plugin may
 * write into other user folders is a device question (host facts §1), so a write tries the host's
 * copy first and writing directly second, and only counts as done when the file reads back with
 * the new text. "Check write access" runs the same write on a probe file.
 */

export type WriteMethod = 'host copy' | 'direct';

async function readsBack(path: string, text: string): Promise<boolean> {
  try {
    return (await RNFS.readFile(path, 'utf8')) === text;
  } catch {
    return false;
  }
}

/** The file's text, or null when it doesn't exist. */
export async function readTextFileIfExists(path: string): Promise<string | null> {
  return (await RNFS.exists(path)) ? RNFS.readFile(path, 'utf8') : null;
}

/** Writes `text` to `path` and checks it reads back; throws when no way worked. */
export async function writeTextFile(path: string, text: string): Promise<WriteMethod> {
  const temporary = `${RNFS.DocumentDirectoryPath}/source-write-${Date.now()}.txt`;
  await RNFS.writeFile(temporary, text, 'utf8');
  try {
    try {
      if ((await FileUtils.copyFile(temporary, path)) && (await readsBack(path, text))) {
        return 'host copy';
      }
    } catch (error) {
      console.warn('[SourceFile] host copy failed', String(error));
    }
    try {
      await RNFS.writeFile(path, text, 'utf8');
      if (await readsBack(path, text)) {
        return 'direct';
      }
    } catch (error) {
      console.warn('[SourceFile] direct write failed', String(error));
    }
    throw new Error("Can't write to this folder.");
  } finally {
    RNFS.unlink(temporary).catch(() => undefined);
  }
}

async function deleteFile(path: string): Promise<boolean> {
  try {
    if (await FileUtils.deleteFile(path)) {
      return !(await RNFS.exists(path));
    }
  } catch (error) {
    console.warn('[SourceFile] host delete failed', String(error));
  }
  try {
    await RNFS.unlink(path);
    return !(await RNFS.exists(path));
  } catch {
    return false;
  }
}

export type WriteAccess = {
  folder: string;
  written: WriteMethod | null;
  deleted: boolean;
  error: string | null;
};

/** Writes, reads back and deletes a small probe file in `folder` (Check write access). */
export async function checkWriteAccess(folder: string): Promise<WriteAccess> {
  const probe = `${folder}/.textbox-tools-probe.txt`;
  try {
    const written = await writeTextFile(probe, `Textbox Tools write check ${new Date().toISOString()}\n`);
    return {folder, written, deleted: await deleteFile(probe), error: null};
  } catch (error) {
    return {folder, written: null, deleted: false, error: error instanceof Error ? error.message : String(error)};
  }
}

/** Saves `text` into EXPORT under `fileName` (when the file's own folder can't be written). */
export async function writeTextToExport(fileName: string, text: string): Promise<string> {
  const exportDir = await FileUtils.getExportPath();
  await FileUtils.makeDir(exportDir);
  const path = `${exportDir}/${fileName}`;
  await writeTextFile(path, text);
  return path;
}
