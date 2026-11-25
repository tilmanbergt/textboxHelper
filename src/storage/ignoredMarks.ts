import RNFS from 'react-native-fs';
import {PluginManager} from 'sn-plugin-lib';
import {
  ignoredOnPage,
  parseIgnoredMarks,
  withIgnored,
  type IgnoreKey,
} from '../domain/marks/toDecide';
import {writeTextAtomic} from './jsonFile';

/**
 * The unclear marks the user ignored (technical-design-mark-dialogue.md §5.4):
 * `<plugin folder>/ignored-marks.json`, per note and page. Read with the page's pen-edit context,
 * written on Ignore only.
 */

async function filePath(): Promise<string | null> {
  const pluginDir = await PluginManager.getPluginDirPath();
  return pluginDir ? `${pluginDir}/ignored-marks.json` : null;
}

async function readFile() {
  const path = await filePath();
  if (!path || !(await RNFS.exists(path))) {
    return parseIgnoredMarks(null);
  }
  return parseIgnoredMarks(await RNFS.readFile(path, 'utf8'));
}

/** The ignored items of a page; none when the file can't be read. */
export async function readIgnoredMarks(notePath: string, page: number): Promise<IgnoreKey[]> {
  try {
    return ignoredOnPage(await readFile(), notePath, page);
  } catch (error) {
    console.warn('[IgnoredMarks] not read', String(error));
    return [];
  }
}

/** Remembers that the user ignored an unclear item on a page. */
export async function rememberIgnored(notePath: string, page: number, key: IgnoreKey): Promise<void> {
  const path = await filePath();
  if (!path) {
    throw new Error('The plugin folder is not known.');
  }
  const next = withIgnored(await readFile(), notePath, page, key);
  await writeTextAtomic(path, JSON.stringify(next, null, 1));
}
