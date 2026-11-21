/**
 * The state of one linked file of a note (technical-design-linked-files.md §1.4): whether the note
 * or the file changed since the plugin last wrote (or imported) it. The Manuscript card shows it
 * and the write follows it, so both agree: only "changed here" and "new" files are written; a file
 * changed outside is never overwritten. Pure.
 */
import {fingerprint} from './fingerprint';
import type {SourceRecord} from './sourceRecord';

export type FileState =
  | 'inSync'
  | 'changedHere'
  | 'changedOutside'
  | 'changedBoth'
  | 'notFound'
  | 'notOnNote'
  | 'new';

export function fileState(params: {
  /** The note's text differs from what was last written (or imported). */
  differs: boolean;
  /** The file's text now; null when there is no file. */
  current: string | null;
  record: Pick<SourceRecord, 'fileFingerprint' | 'original' | 'lastWrittenText'>;
  /** Some textbox or the divider of the file is on the note. */
  onNote: boolean;
}): FileState {
  const {differs, current, record, onNote} = params;
  if (current === null) {
    // A file started on the note and never written has no text yet (technical-design-linked-files.md §5).
    return record.original === '' && record.lastWrittenText === null ? 'new' : 'notFound';
  }
  if (!onNote) {
    return 'notOnNote';
  }
  const outside = fingerprint(current) !== record.fileFingerprint;
  if (outside) {
    return differs ? 'changedBoth' : 'changedOutside';
  }
  return differs ? 'changedHere' : 'inSync';
}

/** Whether the file is written on Update / after an Apply. */
export function isWritable(state: FileState): boolean {
  return state === 'changedHere' || state === 'new';
}

export const FILE_STATE_LABEL: Record<FileState, string> = {
  inSync: 'In sync',
  changedHere: 'Changed here',
  changedOutside: 'Changed in Obsidian',
  changedBoth: 'Changed here and in Obsidian',
  notFound: 'File not found',
  notOnNote: 'Not on the note',
  new: 'New file',
};

/** One glyph per state for compact rows: ✓ nothing to do, ↑ to write, ! needs a decision. */
export const FILE_STATE_GLYPH: Record<FileState, string> = {
  inSync: '✓',
  changedHere: '↑',
  changedOutside: '!',
  changedBoth: '!',
  notFound: '!',
  notOnNote: '–',
  new: '↑',
};
