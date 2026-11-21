import {fingerprint} from '../domain/fingerprint';
import {
  baseName,
  indexLinks,
  indexText,
  INDEX_FILE,
  newFiles,
  withFolder,
  type FolderFile,
  type LinkedFolder,
  type NoteLinks,
} from '../domain/noteLinks';
import {sourceFolder} from '../domain/sourceRecord';
import {listTextFiles} from '../storage/folderFiles';
import {readTextFileIfExists, writeTextFile} from '../storage/sourceFile';
import {writeNoteLinks} from '../storage/sourceStore';

/**
 * Folder mode (technical-design-linked-files.md §2–§3): reading a folder for its setup, the
 * folder's state on the Manuscript card (new files, files left out, the index), and writing
 * `index.txt` for an ordered folder. The index belongs to the plugin: a plain list of `[[name]]`
 * in the note's order, rewritten whole; a change made to it in Obsidian is noticed (fingerprint)
 * and only overwritten on request.
 */

export type ImportFolder = {
  path: string;
  /** The folder's `.txt` files, the index left out. */
  files: FolderFile[];
  /** The names `index.txt` links to, in order; null when the folder has none. */
  index: string[] | null;
};

/** The folder of a chosen file, read for the folder setup. */
export async function readImportFolder(filePath: string): Promise<ImportFolder> {
  const path = sourceFolder(filePath);
  const listing = await listTextFiles(path);
  const indexFile = listing.find(file => file.name.toLowerCase() === INDEX_FILE);
  const index = indexFile ? indexLinks((await readTextFileIfExists(`${path}/${indexFile.name}`)) ?? '') : null;
  return {
    path,
    files: listing.filter(file => file !== indexFile),
    index,
  };
}

/** in sync · to be written · changed in Obsidian (only rewritten on request) · not ordered. */
export type IndexState = 'inSync' | 'stale' | 'changedOutside' | null;

export type FolderState = {
  folder: LinkedFolder;
  /** The folder's name, for headers and status lines. */
  name: string;
  /** In the folder but neither linked nor left out. */
  newFiles: string[];
  /** Left out on purpose and still in the folder. */
  leftOut: string[];
  index: IndexState;
  /** The index the note's order asks for. */
  wantedIndex: string;
  /** Set when the folder couldn't be listed. */
  problem: string | null;
};

export function folderName(path: string): string {
  return path.split('/').filter(Boolean).slice(-1)[0] ?? path;
}

/**
 * How the bound folder stands: `linkedNames` are the file names of the note's files in note order.
 */
export async function readFolderState(folder: LinkedFolder, linkedNames: string[]): Promise<FolderState> {
  const wantedIndex = indexText(linkedNames);
  let listing: string[] = [];
  let problem: string | null = null;
  try {
    listing = (await listTextFiles(folder.path)).map(file => file.name);
  } catch (error) {
    console.warn('[FolderLink] folder not listed', String(error));
    problem = `Can't read the folder ${folderName(folder.path)}.`;
  }
  let index: IndexState = null;
  if (folder.ordered) {
    const current = await readTextFileIfExists(`${folder.path}/${INDEX_FILE}`).catch(() => null);
    if (current === null) {
      index = 'stale';
    } else if (current === wantedIndex) {
      index = 'inSync';
    } else {
      index = folder.indexFingerprint !== null && fingerprint(current) !== folder.indexFingerprint ? 'changedOutside' : 'stale';
    }
  }
  const linkedLower = new Set(linkedNames.map(name => name.toLowerCase()));
  return {
    folder,
    name: folderName(folder.path),
    newFiles: problem ? [] : newFiles(listing, linkedNames, folder.skipped),
    leftOut: folder.skipped.filter(
      name => listing.some(item => item.toLowerCase() === name.toLowerCase()) && !linkedLower.has(name.toLowerCase()),
    ),
    index,
    wantedIndex,
    problem,
  };
}

/** Writes `index.txt` with `text` and remembers it in the note's record. */
export async function writeIndexFile(links: NoteLinks, text: string): Promise<NoteLinks> {
  if (!links.folder) {
    return links;
  }
  await writeTextFile(`${links.folder.path}/${INDEX_FILE}`, text);
  const next = withFolder(links, {indexText: text, indexFingerprint: fingerprint(text)});
  await writeNoteLinks(next);
  console.log('[FolderLink] index written', JSON.stringify({files: text.split('\n').length - 1}));
  return next;
}

/** The names of linked files for the index: their file names, in note order. */
export function linkedFileNames(filePaths: string[]): string[] {
  return filePaths.map(path => `${baseName(path.split('/').slice(-1)[0] ?? path)}.txt`);
}
