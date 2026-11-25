import type {PunctuationChar} from './marks/shapes/punct';
import type {CaretInsertMode} from './marks/place/point';

/**
 * Where a punctuation mark from a caret's circle goes, and with which spaces
 * (technical-design-fine-marks.md §9.5). Punctuation spaces by its type, not like a word:
 * - `, ; . : ?` attach to the word before (a tip in the gap after it, or at its end); between two
 *   digits they go in as they are (1,5; 10:30); between letters they are refused.
 * - `'` goes between letters (don't) or at a word's end (Tilmans'); before a word it would be an
 *   opening quote, which is not supported.
 * - `-` goes between letters (e-mail); in a gap it replaces the space and joins the two words.
 * Pure.
 */

export type PunctuationPlace =
  | {kind: 'place'; start: number; end: number; text: string; joins: boolean; at: number}
  | {kind: 'refused'; reason: string};

const TRAILING = new Set<PunctuationChar>([',', ';', '.', ':', '?']);
const DIGIT = /\p{N}/u;
const SPACE = /\s/;

/** The offset right after the word that ends at or before `offset` (skipping spaces left). */
function wordEndBefore(text: string, offset: number): number | null {
  let at = offset;
  while (at > 0 && SPACE.test(text.charAt(at - 1))) {
    at -= 1;
  }
  return at > 0 ? at : null;
}

/** The whitespace run at a word edge `offset`: after it when a word ends there, else before it. */
function spaceRunAt(text: string, offset: number): {start: number; end: number} | null {
  let start = offset;
  let end = offset;
  if (SPACE.test(text.charAt(offset))) {
    while (end < text.length && SPACE.test(text.charAt(end))) {
      end += 1;
    }
  } else if (SPACE.test(text.charAt(offset - 1))) {
    while (start > 0 && SPACE.test(text.charAt(start - 1))) {
      start -= 1;
    }
  } else {
    return null;
  }
  return start > 0 && end < text.length ? {start, end} : null;
}

export function placePunctuation(
  text: string,
  offset: number,
  mode: CaretInsertMode,
  char: PunctuationChar,
): PunctuationPlace {
  const insert = (at: number, joins = false): PunctuationPlace => ({
    kind: 'place',
    start: at,
    end: at,
    text: char,
    joins,
    at,
  });
  const inWord = mode === 'inWord';
  if (TRAILING.has(char)) {
    if (inWord) {
      return DIGIT.test(text.charAt(offset - 1)) && DIGIT.test(text.charAt(offset))
        ? insert(offset)
        : {kind: 'refused', reason: `"${char}" goes after a word: put the caret's tip just after it.`};
    }
    const at = wordEndBefore(text, offset);
    if (at === null) {
      return {kind: 'refused', reason: `There is no word before the caret for "${char}".`};
    }
    const next = text.charAt(at);
    const spaceAfter = next !== '' && !SPACE.test(next) && /[\p{L}\p{N}]/u.test(next) ? ' ' : '';
    return {kind: 'place', start: at, end: at, text: `${char}${spaceAfter}`, joins: false, at};
  }
  if (char === "'") {
    if (inWord) {
      return insert(offset);
    }
    if (offset > 0 && !SPACE.test(text.charAt(offset - 1))) {
      return insert(offset);
    }
    return {
      kind: 'refused',
      reason: "An apostrophe before a word would be an opening quote, which isn't supported yet.",
    };
  }
  // The hyphen.
  if (inWord) {
    return insert(offset);
  }
  const run = spaceRunAt(text, offset);
  if (run) {
    return {kind: 'place', start: run.start, end: run.end, text: '-', joins: true, at: run.start};
  }
  return insert(offset);
}

/** "Yes|I": the characters around the place, for the review's row. */
export function punctuationSnippet(text: string, start: number, end: number, around = 6): string {
  const head = text.slice(Math.max(0, start - around), start).replace(/\s+/g, ' ');
  const tail = text.slice(end, end + around).replace(/\s+/g, ' ');
  return `${head}|${tail}`;
}

/**
 * When the plugin's reading couldn't tell `,` from `'`, the place decides: between letters it is
 * an apostrophe, elsewhere a comma. (A word ending in "s" is no hint: "Yes, I" is far more common
 * than a plural possessive.) The row is marked for a check either way.
 */
export function breakCommaTie(mode: CaretInsertMode): PunctuationChar {
  return mode === 'inWord' ? "'" : ',';
}
