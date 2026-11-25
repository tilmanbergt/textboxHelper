import type {ManuscriptEntry, NoteEntry} from './manuscriptPages';
import type {ReviewOperationKind} from './markerTypes';
import {penEditNumberText} from './penEditTags';

/**
 * The Review's lists (technical-design-mark-dialogue.md §13.5, technical-design-comments-images.md
 * §5.2): New text, the changes that bring tagged text in (insertions and replacements), each with
 * the number written on the page; Marks, every other change, each with a plain symbol for its
 * kind, so that a circled number in the card always means the number on the page; Notes, the
 * comments and images, which are no changes, each with its sign (bubble or frame), never a circle.
 */

export type ReviewLists = {
  /** Changes with tagged text: by page, then by their number on the page ("?" last). */
  text: ManuscriptEntry[];
  /** The other changes, in reading order. */
  marks: ManuscriptEntry[];
};

export function splitReviewLists(entries: ManuscriptEntry[]): ReviewLists {
  const text = entries
    .filter(entry => !!entry.operation.penEditId)
    .map((entry, index) => ({entry, index}))
    .sort(
      (a, b) =>
        a.entry.page - b.entry.page ||
        (a.entry.operation.penEditNumber ?? Number.MAX_SAFE_INTEGER) - (b.entry.operation.penEditNumber ?? Number.MAX_SAFE_INTEGER) ||
        a.index - b.index,
    )
    .map(item => item.entry);
  return {text, marks: entries.filter(entry => !entry.operation.penEditId)};
}

const KIND_SYMBOLS: Record<ReviewOperationKind, string> = {
  delete: '−',
  replace: '/',
  insert: '+',
  split: '¶',
  space: '∧',
  swap: '⇄',
  closeUp: '⌒',
  join: '⌒',
  punct: ',',
};

/** What stands before a row: the number on the page in a circle, or the kind's symbol. */
export function rowMarker(entry: ManuscriptEntry): {circled: boolean; text: string} {
  return entry.operation.penEditId
    ? {circled: true, text: penEditNumberText(entry.operation.penEditNumber ?? null)}
    : {circled: false, text: KIND_SYMBOLS[entry.operation.kind]};
}

/** Notes: by page, then by their paragraph on the page (none last), comments before images there. */
export function notesList(notes: NoteEntry[]): NoteEntry[] {
  return notes
    .map((entry, index) => ({entry, index}))
    .sort(
      (a, b) =>
        a.entry.page - b.entry.page ||
        (a.entry.row.at?.number ?? Number.MAX_SAFE_INTEGER) - (b.entry.row.at?.number ?? Number.MAX_SAFE_INTEGER) ||
        a.index - b.index,
    )
    .map(item => item.entry);
}

/** A note's row is grey once its comment is checked off; it stays in the list. */
export function noteIsDone(entry: NoteEntry): boolean {
  return entry.row.kind === 'comment' && entry.row.note.done === true;
}
