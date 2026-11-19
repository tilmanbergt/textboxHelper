import type {CaretInsertMode} from './penEditCaret';

/**
 * Fine-tuning where a change starts and ends, one character at a time
 * (technical-design-pen-edits-2.md §6). Marks are accurate at word level; what is left to fix is a
 * comma, a space or a letter at the edge. A shift is in characters, signed; a zero-length change
 * (an insertion at a caret, a paragraph break) moves as one by `start`.
 */

export type EdgeShift = {start: number; end: number};

export const NO_SHIFT: EdgeShift = {start: 0, end: 0};

export function isNoShift(shift: EdgeShift | null | undefined): boolean {
  return !shift || (shift.start === 0 && shift.end === 0);
}

type Span = {start: number; end: number};

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * The spans of one textbox after their shifts: each moved, kept inside the text and kept from
 * running into its neighbours (a later span starts where an earlier one ends at the soonest).
 * Returned in the order given.
 */
export function shiftSpans(
  textLength: number,
  items: Array<Span & {shift: EdgeShift | null | undefined; zeroLength: boolean}>,
): Span[] {
  const moved = items.map((item, index) => {
    const shift = item.shift ?? NO_SHIFT;
    if (item.zeroLength) {
      const at = clamp(item.start + shift.start, 0, textLength);
      return {index, start: at, end: at, zeroLength: true};
    }
    const start = clamp(item.start + shift.start, 0, textLength);
    const end = clamp(item.end + shift.end, start, textLength);
    return {index, start, end, zeroLength: false};
  });
  const ordered = [...moved].sort((a, b) => a.start - b.start || a.end - b.end);
  let floor = 0;
  for (const span of ordered) {
    if (span.start < floor) {
      span.start = floor;
      span.end = Math.max(span.end, span.start);
    }
    floor = span.end;
  }
  return moved.map(({start, end}) => ({start, end}));
}

/** Letters and digits (Latin with accents, Greek, Cyrillic); no Unicode property classes, which
 * the device's JavaScript engine may not support. */
const WORD_CHAR = /[A-Za-z0-9\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;

/**
 * How an insertion joins the text at a moved place: inside a word when letters or digits are on
 * both sides, else between words (spaces added as needed). A paragraph or blank-line insertion
 * stays what it is.
 */
export function insertModeAt(text: string, offset: number, mode: CaretInsertMode): CaretInsertMode {
  if (mode === 'paragraph' || mode === 'blankLine') {
    return mode;
  }
  const before = text.charAt(offset - 1);
  const after = text.charAt(offset);
  return before && after && WORD_CHAR.test(before) && WORD_CHAR.test(after) ? 'inWord' : 'betweenWords';
}

/** The characters around an edge, for showing it with a bar between them. */
export function edgeContext(text: string, offset: number, width = 10): {before: string; after: string} {
  const at = clamp(offset, 0, text.length);
  const show = (part: string) => part.replace(/\n/g, '¶');
  return {
    before: show(text.slice(Math.max(0, at - width), at)),
    after: show(text.slice(at, at + width)),
  };
}

const TRAILING_PUNCTUATION = /[,.;:!?…]+$/;
const LEADING_PUNCTUATION = /^[(„“"'«]+/;

/** A word as measured on the page: its place in the text and where it is drawn. */
export type MeasuredWord = {start: number; end: number; text: string; absoluteLeft: number; absoluteRight: number};

/**
 * The text a delete or replace mark covers, without punctuation at its ends that the stroke
 * didn't reach: "default," with the line ending over "default" keeps its comma. A punctuation run
 * counts as covered when the mark reaches past its middle (its width estimated as its share of the
 * word's measured width).
 */
export function coveredSpan(words: MeasuredWord[], markLeft: number, markRight: number): Span | null {
  if (words.length === 0) {
    return null;
  }
  const first = words[0];
  const last = words[words.length - 1];
  let start = first.start;
  let end = last.end;
  const trailing = last.text.match(TRAILING_PUNCTUATION)?.[0] ?? '';
  if (trailing && trailing.length < last.text.length) {
    const width = last.absoluteRight - last.absoluteLeft;
    const punctuationWidth = (width * trailing.length) / last.text.length;
    if (markRight < last.absoluteRight - punctuationWidth / 2) {
      end -= trailing.length;
    }
  }
  const leading = first.text.match(LEADING_PUNCTUATION)?.[0] ?? '';
  if (leading && leading.length < first.text.length) {
    const width = first.absoluteRight - first.absoluteLeft;
    const punctuationWidth = (width * leading.length) / first.text.length;
    if (markLeft > first.absoluteLeft + punctuationWidth / 2) {
      start += leading.length;
    }
  }
  return end > start ? {start, end} : {start: first.start, end: last.end};
}
