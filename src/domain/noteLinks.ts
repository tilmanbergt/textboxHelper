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

export type NoteLinks = {
  version: 1;
  notePath: string;
  mode: LinkMode;
  /** Source ids of the files linked to the note, in the order they were added. */
  sources: string[];
};

/** The key a note's record is stored under: a fingerprint of its path. */
export function noteKey(notePath: string): string {
  return fingerprint(notePath);
}

export function newNoteLinks(notePath: string, mode: LinkMode): NoteLinks {
  return {version: 1, notePath, mode, sources: []};
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
    return {
      version: 1,
      notePath: raw.notePath,
      mode: raw.mode === 'folder' ? 'folder' : 'files',
      sources: raw.sources.filter((id): id is string => typeof id === 'string'),
    };
  } catch {
    return null;
  }
}
