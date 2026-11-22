import RNFS from 'react-native-fs';
import type {FolderFile} from '../domain/noteLinks';

/**
 * The `.txt` files directly in a folder (technical-design-linked-files.md §2.1): no subfolders,
 * names with their size and modification time (milliseconds).
 */
export async function listTextFiles(folder: string): Promise<FolderFile[]> {
  const entries = await RNFS.readDir(folder);
  return entries
    .filter(entry => entry.isFile() && /\.txt$/i.test(entry.name))
    .map(entry => ({
      name: entry.name,
      size: Number(entry.size) || 0,
      mtime: entry.mtime ? new Date(entry.mtime).getTime() : 0,
    }));
}
