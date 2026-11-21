/**
 * The linked files of a note (technical-design-linked-files.md §1.3), stored as JSON in the plugin
 * folder next to the files' records. The dividers on the pages say which files are where; this
 * record keeps what isn't on the pages: the note's mode and the files ever linked to it. A note
 * with dividers but without this record (a copied note, a lost record) is read as files mode.
 * Pure: building, reading and writing the JSON.
 */
import {fingerprint} from './fingerprint';

/** Files mode: files added one by one from any folder. Folder mode: one folder as a whole. */
export type LinkMode = 'files' | 'folder';

/** Folder mode: the one folder the note is bound to. */
export type LinkedFolder = {
  path: string;
  /** Ordered: the note's order of the files is kept in the folder's `index.txt`. */
  ordered: boolean;
  /** File names left out on purpose (at setup or later): not offered as new files. */
  skipped: string[];
  /** What the plugin last wrote to `index.txt` (or read when it took it over). */
  indexText: string | null;
  /** `index.txt` as last written or read, to notice a change made in Obsidian. */
  indexFingerprint: string | null;
};

export type NoteLinks = {
  version: 1;
  notePath: string;
  mode: LinkMode;
  /** Source ids of the files linked to the note, in the order they were added. */
  sources: string[];
  folder?: LinkedFolder;
};

/** The index file of an ordered folder (`index.md` in Obsidian); it belongs to the plugin. */
export const INDEX_FILE = 'index.txt';

/** The key a note's record is stored under: a fingerprint of its path. */
export function noteKey(notePath: string): string {
  return fingerprint(notePath);
}

export function newNoteLinks(notePath: string, mode: LinkMode, folder?: LinkedFolder): NoteLinks {
  return folder ? {version: 1, notePath, mode, sources: [], folder} : {version: 1, notePath, mode, sources: []};
}

export function newLinkedFolder(path: string, ordered: boolean, skipped: string[]): LinkedFolder {
  return {path, ordered, skipped, indexText: null, indexFingerprint: null};
}

/** The record with `sourceIds` added (each once, in order). */
export function withSources(links: NoteLinks, sourceIds: string[]): NoteLinks {
  return {...links, sources: [...new Set([...links.sources, ...sourceIds])]};
}

export function withoutSource(links: NoteLinks, sourceId: string): NoteLinks {
  return {...links, sources: links.sources.filter(id => id !== sourceId)};
}

export function serializeNoteLinks(links: NoteLinks): string {
  return JSON.stringify(links);
}

/** The record in a file's text, or null when it is not one. */
export function parseNoteLinks(text: string): NoteLinks | null {
  try {
    const raw = JSON.parse(text) as Partial<NoteLinks>;
    if (raw?.version !== 1 || typeof raw.notePath !== 'string' || !Array.isArray(raw.sources)) {
      return null;
    }
    const folder = parseFolder(raw.folder);
    const links: NoteLinks = {
      version: 1,
      notePath: raw.notePath,
      mode: raw.mode === 'folder' && folder ? 'folder' : 'files',
      sources: raw.sources.filter((id): id is string => typeof id === 'string'),
    };
    return links.mode === 'folder' && folder ? {...links, folder} : links;
  } catch {
    return null;
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function parseFolder(value: unknown): LinkedFolder | null {
  const raw = value as Partial<LinkedFolder> | undefined;
  if (!raw || typeof raw.path !== 'string') {
    return null;
  }
  return {
    path: raw.path,
    ordered: raw.ordered === true,
    skipped: strings(raw.skipped),
    indexText: typeof raw.indexText === 'string' ? raw.indexText : null,
    indexFingerprint: typeof raw.indexFingerprint === 'string' ? raw.indexFingerprint : null,
  };
}

/** The file name of a `.txt` without its extension: how the index and the divider name a file. */
export function baseName(fileName: string): string {
  return fileName.replace(/\.txt$/i, '');
}

/** `index.txt` for the files in this order: one `[[name]]` per line, nothing else. */
export function indexText(names: string[]): string {
  return names.map(name => `[[${baseName(name)}]]\n`).join('');
}

/**
 * The file names an index links to, in order, each once: `[[a/b/Name|alias]]` and `[[Name#part]]`
 * name `Name`. Lines without a link (headers, notes) are ignored.
 */
export function indexLinks(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const target = match[1].split('|')[0].split('#')[0].trim();
    const name = target.split('/').slice(-1)[0].replace(/\.md$/i, '').trim();
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

export type FolderFile = {name: string; size: number; mtime: number};

/**
 * The order files start in when a folder is bound: by its index (files missing from it after, by
 * name), by name, or by modified date (oldest first).
 */
export function startOrder(files: FolderFile[], index: string[] | null, by: 'name' | 'date'): FolderFile[] {
  const byName = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}));
  if (index) {
    const position = (file: FolderFile) => {
      const at = index.indexOf(baseName(file.name));
      return at < 0 ? Number.MAX_SAFE_INTEGER : at;
    };
    return [...byName].sort((a, b) => position(a) - position(b));
  }
  return by === 'date' ? [...byName].sort((a, b) => a.mtime - b.mtime) : byName;
}

/** Files in the folder that are neither linked to the note nor left out (and not the index). */
export function newFiles(listing: string[], linked: string[], skipped: string[]): string[] {
  const known = new Set([...linked, ...skipped].map(name => name.toLowerCase()));
  return listing.filter(name => name.toLowerCase() !== INDEX_FILE && !known.has(name.toLowerCase()));
}

/**
 * Why a name can't be a new file's name, or null when it can: not empty, at most 120 characters,
 * none of / \\ : * ? " < > |, not "index".
 */
export function fileNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return 'The name is empty.';
  }
  if (trimmed.length > 120) {
    return 'The name is longer than 120 characters.';
  }
  if (/[\\/:*?"<>|]/.test(trimmed)) {
    return 'A file name can\'t contain / \\ : * ? " < > |.';
  }
  if (baseName(trimmed).toLowerCase() === 'index') {
    return '"index" is the folder\'s index file.';
  }
  return null;
}

export function withFolder(links: NoteLinks, change: Partial<LinkedFolder>): NoteLinks {
  return links.folder ? {...links, folder: {...links.folder, ...change}} : links;
}
