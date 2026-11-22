import RNFS from 'react-native-fs';

/**
 * Writing the plugin's own JSON files so a crash in the middle never leaves half a file: write a
 * temporary file next to it, then replace the old one. Creates the folder when it is missing.
 */
export async function writeTextAtomic(path: string, text: string): Promise<void> {
  const folder = path.slice(0, path.lastIndexOf('/'));
  if (folder && !(await RNFS.exists(folder))) {
    await RNFS.mkdir(folder);
  }
  const temporary = `${path}.tmp`;
  await RNFS.writeFile(temporary, text, 'utf8');
  if (await RNFS.exists(path)) {
    await RNFS.unlink(path);
  }
  await RNFS.moveFile(temporary, path);
}
