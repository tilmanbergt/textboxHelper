import RNFS from 'react-native-fs';

/** Reads the text file chosen for import. */
export async function readUtf8TextFile(path: string): Promise<string> {
  const exists = await RNFS.exists(path);

  if (!exists) {
    throw new Error(`File not found: ${path}`);
  }

  return RNFS.readFile(path, 'utf8');
}
