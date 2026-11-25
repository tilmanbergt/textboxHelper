import type {CaretTextbox} from './penEditCaret';
import type {ArcShape} from './marks/shapes/closeUp';

/**
 * The close-up arc (technical-design-fine-marks.md §6, §7): a flat arc ‿ or ⁀ drawn under or over
 * one word gap removes the space there. It opens toward the line it belongs to. At a line end the
 * arc is drawn twice, as if the words were on one line: an end piece after the last word of a line
 * and a start piece before the first word of the next. Pure: stroke points, and textboxes measured
 * in page pixels.
 */

/** How many characters into the words beside the gap an arc's ends may reach. */
export const ARC_REACH_CHARS = 5;

/** What an arc means on a textbox's line. */
export type ArcPlace =
  | {kind: 'gap'; uuid: string; lineIndex: number; start: number; end: number}
  | {kind: 'end'; uuid: string; lineIndex: number; offset: number}
  | {kind: 'start'; uuid: string; lineIndex: number; offset: number}
  | {kind: 'refused'; uuid: string; reason: string};

type Line = CaretTextbox['lines'][number];

/**
 * The line an arc belongs to: the one it opens toward, its chord in that line's lower half (‿) or
 * upper half (⁀) or just beyond it. A chord through the line's middle is a strike, not an arc.
 */
function lineOf(arc: ArcShape, box: CaretTextbox): Line | null {
  const chordY = (arc.from.y + arc.to.y) / 2;
  const matches = box.lines.filter(line => {
    const height = Math.max(1, line.bottom - line.top);
    const centre = (line.top + line.bottom) / 2;
    return arc.opening === 'up'
      ? chordY >= centre + 0.15 * height && chordY <= centre + 0.9 * height
      : chordY <= centre - 0.15 * height && chordY >= centre - 0.9 * height;
  });
  return matches.length === 1 ? matches[0] : null;
}

function averageCharWidth(words: CaretTextbox['words']): number {
  const chars = words.reduce((sum, word) => sum + Math.max(1, word.end - word.start), 0);
  const width = words.reduce((sum, word) => sum + (word.right - word.left), 0);
  return chars > 0 ? Math.max(4, width / chars) : 12;
}

/**
 * Where an arc lands on a measured textbox: one gap between two words (close it), past the last
 * word of a line (an end piece), before the first (a start piece), or refused with why. Null when
 * it doesn't point at a line of this textbox at all.
 */
export function placeArc(arc: ArcShape, box: CaretTextbox): ArcPlace | null {
  const line = lineOf(arc, box);
  if (!line) {
    return null;
  }
  const words = box.words.filter(word => word.lineIndex === line.index).sort((a, b) => a.left - b.left);
  if (words.length === 0) {
    return null;
  }
  const c = averageCharWidth(words);
  const x0 = arc.from.x;
  const x1 = arc.to.x;
  const gaps: Array<{left: (typeof words)[number]; right: (typeof words)[number]}> = [];
  for (let index = 0; index + 1 < words.length; index += 1) {
    const middle = (words[index].right + words[index + 1].left) / 2;
    if (middle >= x0 && middle <= x1) {
      gaps.push({left: words[index], right: words[index + 1]});
    }
  }
  if (gaps.length > 1) {
    return {kind: 'refused', uuid: box.uuid, reason: 'A close-up arc closes one gap: draw one arc per gap.'};
  }
  if (gaps.length === 1) {
    const {left, right} = gaps[0];
    if (x0 < left.right - ARC_REACH_CHARS * c || x1 > right.left + ARC_REACH_CHARS * c) {
      return {
        kind: 'refused',
        uuid: box.uuid,
        reason: 'Draw the close-up arc just under the gap, a few letters on each side.',
      };
    }
    return {kind: 'gap', uuid: box.uuid, lineIndex: line.index, start: left.end, end: right.start};
  }
  const last = words[words.length - 1];
  const first = words[0];
  if (x1 > last.right + 0.5 * c && x0 >= last.right - ARC_REACH_CHARS * c && x0 <= last.right) {
    return {kind: 'end', uuid: box.uuid, lineIndex: line.index, offset: last.end};
  }
  if (x0 < first.left - 0.5 * c && x1 <= first.left + ARC_REACH_CHARS * c && x1 >= first.left) {
    return {kind: 'start', uuid: box.uuid, lineIndex: line.index, offset: first.start};
  }
  return {kind: 'refused', uuid: box.uuid, reason: 'There is no space under the close-up arc.'};
}

/** The whitespace between two offsets' words: from the end of one word to the start of the next. */
export function gapBetween(text: string, end: number, start: number): {start: number; end: number} | null {
  if (start <= end) {
    return null;
  }
  return /^\s+$/.test(text.slice(end, start)) ? {start: end, end: start} : null;
}

/** Punctuation that a close-up may also take away when the user asks (the row's toggle). */
const CLOSE_UP_PUNCTUATION = /[-‐‑–—.,;:!?…]/;

/**
 * The punctuation right at a gap that the "Also remove" toggle would take: the run ending the left
 * word and the run starting the right word. Empty when there is none.
 */
export function punctuationAtGap(text: string, start: number, end: number): {from: number; to: number; text: string} {
  let from = start;
  while (from > 0 && CLOSE_UP_PUNCTUATION.test(text.charAt(from - 1))) {
    from -= 1;
  }
  let to = end;
  while (to < text.length && CLOSE_UP_PUNCTUATION.test(text.charAt(to))) {
    to += 1;
  }
  // A word made only of punctuation is not "at" the gap: it would vanish entirely.
  const leftWordEmpty = from === 0 || /\s/.test(text.charAt(from - 1));
  const rightWordEmpty = to === text.length || /\s/.test(text.charAt(to));
  if (leftWordEmpty) {
    from = start;
  }
  if (rightWordEmpty) {
    to = end;
  }
  return {from, to, text: `${text.slice(from, start)}${text.slice(end, to)}`};
}

/** "note|book": the characters around a close-up, for the review's row. */
export function closeUpSnippet(text: string, start: number, end: number, around = 6): string {
  const head = text.slice(Math.max(0, start - around), start).replace(/\s+/g, ' ');
  const tail = text.slice(end, end + around).replace(/\s+/g, ' ');
  return `${head}|${tail}`;
}
