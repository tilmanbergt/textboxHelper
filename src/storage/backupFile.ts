import {Clipboard} from 'react-native';
import RNFS from 'react-native-fs';
import {PluginManager} from 'sn-plugin-lib';
import {buildBackupDir, buildBackupPath} from '../domain/backupPaths';
import {buildClipboardSummary, type BackupPayload} from '../domain/backupPayload';

/**
 * Writes the backup JSON into the plugin's backup folder before a change, and puts its summary on
 * the clipboard.
 */

export async function writeBackupFile(payload: BackupPayload): Promise<{
  backupPath: string;
  clipboardSummary: string;
}> {
  const pluginDir = await PluginManager.getPluginDirPath();
  if (!pluginDir) {
    throw new Error('Could not find the plugin folder for the backup. Nothing was changed.');
  }
  const backupDir = buildBackupDir(pluginDir);
  await RNFS.mkdir(backupDir);

  const backupPath = buildBackupPath(pluginDir, payload.action, payload.createdAt);
  await RNFS.writeFile(backupPath, JSON.stringify(payload, null, 2), 'utf8');

  const clipboardSummary = buildClipboardSummary(payload);
  Clipboard.setString(clipboardSummary);

  return {backupPath, clipboardSummary};
}
