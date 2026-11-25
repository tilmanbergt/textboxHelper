/**
 * The cheat sheet's PNG as a file (technical-design-release-readiness.md §6.2): in the plugin's
 * own folder for the host's insertImage, or copied to EXPORT when inserting is not possible.
 */
import RNFS from 'react-native-fs';
import {FileUtils, PluginManager} from 'sn-plugin-lib';

export const CHEAT_SHEET_FILE = 'manuscript-cheatsheet.png';

/** Writes the PNG (base64) into the plugin folder and returns its path. */
export async function writeCheatSheetFile(base64: string): Promise<string> {
  const dir = await PluginManager.getPluginDirPath();
  const path = `${dir}/${CHEAT_SHEET_FILE}`;
  await RNFS.writeFile(path, base64, 'base64');
  return path;
}

/** Copies the PNG to EXPORT and returns its path there. */
export async function exportCheatSheetFile(base64: string): Promise<string> {
  const exportDir = await FileUtils.getExportPath();
  await FileUtils.makeDir(exportDir);
  const tempPath = `${RNFS.DocumentDirectoryPath}/${CHEAT_SHEET_FILE}`;
  const exportPath = `${exportDir}/${CHEAT_SHEET_FILE}`;
  await RNFS.writeFile(tempPath, base64, 'base64');
  const copied = await FileUtils.copyFile(tempPath, exportPath).finally(() => RNFS.unlink(tempPath).catch(() => undefined));
  if (!copied) {
    throw new Error('Could not copy the cheat sheet into EXPORT.');
  }
  return exportPath;
}
