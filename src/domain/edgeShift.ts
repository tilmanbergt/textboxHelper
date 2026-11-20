import type {CaretInsertMode} from './penEditCaret';
import type {SwapZones} from './swapMark';

/**
 * Fine-tuning a change's edges, one character at a time (technical-design-pen-edits-2.md §6,
 * technical-design-manuscript.md §4.4). Marks are accurate at word level; what is left to fix is a
 * comma, a space or a letter at the edge. A change has one edge (the place of an insertion, a
 * paragraph break or a space), two (start and end of a delete or replace) or three (a swap: start of
 * the first part, where the parts meet, end of the second part). A shift holds one signed character
 * count per edge; missing entries count as 0.
 */

export type EdgeShift = number[];

export const NO_SHIFT: EdgeShift = [];

export function isNoShift(shift: EdgeShift | null | undefined): boolean {
  return !shift || shift.every(delta => delta === 0);
}

/** The shift with edge `index` moved by `delta`. */
export function nudgeShift(shift: EdgeShift | null | undefined, index: number, delta: number): EdgeShift {
  const next = [...(shift ?? NO_SHIFT)];
  while (next.length <= index) {
    next.push(0);
  }
  next[index] += delta;
  return next;
}

const deltaOf = (shift: EdgeShift | null | undefined, index: number) => shift?.[index] ?? 0;

type Span = {start: number; end: number};

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * The spans of one textbox after their shifts: each moved, kept inside the text and kept from
 * running into its neighbours (a later span starts where an earlier one ends at the soonest).
 * A zero-length span moves as one by its only edge. Returned in the order given.
 */
export function shiftSpans(
  textLength: number,
  items: Array<Span & {shift: EdgeShift | null | undefined; zeroLength: boolean}>,
): Span[] {
  const moved = items.map((item, index) => {
    if (item.zeroLength) {
      const place = clamp(item.start + deltaOf(item.shift, 0), 0, textLength);
      return {index, start: place, end: place, zeroLength: true};
    }
    const start = clamp(item.start + deltaOf(item.shift, 0), 0, textLength);
    const end = clamp(item.end + deltaOf(item.shift, 1), start, textLength);
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

/**
 * A swap's parts after its three edges moved: the start of the first part, the meeting point
 * (the gap between the parts moves as one) and the end of the second part. Each part keeps at
 * least one character, and everything stays inside the text.
 */
export function shiftSwapZones(zones: SwapZones, shift: EdgeShift | null | undefined, textLength: number): SwapZones {
  const gap = zones.b0 - zones.a1;
  const b1 = clamp(zones.b1 + deltaOf(shift, 2), Math.min(textLength, zones.a0 + gap + 2), textLength);
  const a0 = clamp(zones.a0 + deltaOf(shift, 0), 0, b1 - gap - 2);
  const a1 = clamp(zones.a1 + deltaOf(shift, 1), a0 + 1, b1 - gap - 1);
  return {a0, a1, b0: a1 + gap, b1};
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
