import {charPositionInWord, type WordWithEdges} from '../../textOffsets';

/**
 * Exact places from the marks drawn letter by letter (technical-design-fine-marks.md §3, §4): a
 * replace mark's two verticals and a slash say exactly where, so their x is turned into a
 * character offset rather than a whole word. Pure: words in page pixels, with character edges
 * when the native measurement gave them.
 */

/** How close (in characters) to a word's edge a vertical snaps to that edge. */
export const EXACT_EDGE_SNAP_CHARS = 0.5;

/**
 * The text offset a vertical at `x` marks on a line: inside a word, the nearest character
 * boundary, or the word's edge when within half a character of it; in a gap, the edge of the word
 * on the inner side (`side` 'start': the word to the right; 'end': the word to the left).
 */
export function offsetAtVertical(
  words: WordWithEdges[],
  x: number,
  side: 'start' | 'end',
): number | null {
  const ordered = [...words].sort((a, b) => a.left - b.left);
  if (ordered.length === 0) {
    return null;
  }
  for (const word of ordered) {
    if (x >= word.left && x <= word.right) {
      const length = Math.max(1, word.end - word.start);
      const position = charPositionInWord(word, x);
      if (position <= EXACT_EDGE_SNAP_CHARS) {
        return word.start;
      }
      if (length - position <= EXACT_EDGE_SNAP_CHARS) {
        return word.end;
      }
      return word.start + Math.round(position);
    }
  }
  if (side === 'start') {
    const next = ordered.find(word => word.left > x);
    return next ? next.start : ordered[ordered.length - 1].end;
  }
  const previous = [...ordered].reverse().find(word => word.right < x);
  return previous ? previous.end : ordered[0].start;
}

/** The exact range between two verticals, or null when they mark nothing. */
export function exactSpan(
  words: WordWithEdges[],
  leftX: number,
  rightX: number,
): {start: number; end: number} | null {
  const start = offsetAtVertical(words, Math.min(leftX, rightX), 'start');
  const end = offsetAtVertical(words, Math.max(leftX, rightX), 'end');
  return start !== null && end !== null && end > start ? {start, end} : null;
}

/** The character a point at `x` falls on, or null when it falls between words. */
export function characterAt(words: WordWithEdges[], x: number): number | null {
  for (const word of words) {
    if (x >= word.left && x <= word.right) {
      const length = Math.max(1, word.end - word.start);
      return word.start + Math.min(length - 1, Math.floor(charPositionInWord(word, x)));
    }
  }
  return null;
}

/**
 * "bigg[er]": the word(s) around a letter-level range with the marked part in brackets, for the
 * review's rows. Shortened to `limit` characters around the range.
 */
export function bracketSnippet(text: string, start: number, end: number, limit = 12): string {
  let from = start;
  while (from > 0 && !/\s/.test(text.charAt(from - 1)) && start - from < limit) {
    from -= 1;
  }
  let to = end;
  while (to < text.length && !/\s/.test(text.charAt(to)) && to - end < limit) {
    to += 1;
  }
  const marked = text.slice(start, end).replace(/\s+/g, ' ');
  return `${text.slice(from, start)}[${marked}]${text.slice(end, to)}`;
}
