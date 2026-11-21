import RNFS from 'react-native-fs';
import {PluginManager} from 'sn-plugin-lib';
import {buildBlockStatusPath} from '../domain/backupPaths';
import {writeTextAtomic} from './jsonFile';
import {
  parseBlockStatuses,
  serializeBlockStatuses,
  type BlockStatus,
} from '../domain/outlineModel';

/**
 * The Outline's block statuses in `<plugin folder>/block-status.json` (technical-design-manuscript.md
 * §5.2): block id → open, review or final. Kept in the plugin only; a missing or unreadable file
 * means every block is open. Written through a temporary file (`jsonFile.ts`).
 */

async function statusPath(): Promise<string> {
  const pluginDir = await PluginManager.getPluginDirPath();
  if (!pluginDir) {
    throw new Error('Could not find the plugin folder.');
  }
  return buildBlockStatusPath(pluginDir);
}

export async function readBlockStatuses(): Promise<Record<string, BlockStatus>> {
  try {
    const path = await statusPath();
    return (await RNFS.exists(path)) ? parseBlockStatuses(await RNFS.readFile(path, 'utf8')) : {};
  } catch (error) {
    console.warn('[BlockStatus] statuses not read', String(error));
    return {};
  }
}

export async function writeBlockStatus(id: string, status: BlockStatus): Promise<Record<string, BlockStatus>> {
  const path = await statusPath();
  const statuses = {...(await readBlockStatuses()), [id]: status};
  await writeTextAtomic(path, serializeBlockStatuses(statuses));
  return statuses;
}
