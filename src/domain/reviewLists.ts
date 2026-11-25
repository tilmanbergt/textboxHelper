import type {ManuscriptEntry} from './manuscriptPages';
import type {ReviewOperationKind} from './markerTypes';
import {penEditNumberText} from './penEditTags';

/**
 * The Review's two lists of changes (technical-design-mark-dialogue.md §13.5): New text, the
 * changes that bring tagged text in (insertions and replacements), each with the number written on
 * the page; Marks, every other change, each with a plain symbol for its kind, so that a circled
 * number in the card always means the number on the page.
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
