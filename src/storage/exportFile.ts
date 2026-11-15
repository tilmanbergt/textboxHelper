import RNFS from 'react-native-fs';
import {FileUtils} from 'sn-plugin-lib';

/**
 * Writes a JSON file into EXPORT through a temporary file in the app's document folder (the host
 * only lets plugins copy into EXPORT). Used by "Save Diagnostics" in the edit-marker review.
 */
export async function writeJsonExportFile(fileName: string, payload: unknown): Promise<string> {
  const exportDir = await FileUtils.getExportPath();
  await FileUtils.makeDir(exportDir);

  const tempPath = `${RNFS.DocumentDirectoryPath}/${fileName}`;
  const exportPath = `${exportDir}/${fileName}`;

  await RNFS.writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf8');
  const copied = await FileUtils.copyFile(tempPath, exportPath);
  if (!copied) {
    throw new Error('Could not copy the JSON export into EXPORT.');
  }

  return exportPath;
}
