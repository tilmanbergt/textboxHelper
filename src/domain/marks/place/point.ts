import {locateSideways, locateStep} from './paragraph';
import type {CaretDirection} from '../shapes/caret';
import type {Point} from '../markStroke';
import type {CaretTextbox} from '../textboxView';
import {charPositionInWord} from '../../textOffsets';

/**
 * Where a caret's tip points in the text (technical-design-pen-edits.md §8, As built): a line of a
 * textbox in its column, or the space between two paragraphs. Pure: measured lines and words in
 * page pixels.
 */

/**
 * - `inWord`: inside a word; the text goes in as written.
 * - `betweenWords`: at a word's edge; a space is added where needed.
 * - `blankLine`: on an empty line between paragraphs of one textbox; a paragraph of its own.
 */
export type CaretInsertMode =
  | 'inWord'
  | 'betweenWords'
  | 'blankLine'
  | 'paragraph';

export type CaretTarget =
  | {
      kind: 'text';
      uuid: string;
      numInPage: number;
      offset: number;
      mode: CaretInsertMode;
      /** Why the place was a close call, worth a look in the review. */
      uncertain?: string;
    }
  | {kind: 'gap'; above: string | null; below: string | null}
  /** A paragraph split at `offset` (a < or >, or a step mark). */
  | {kind: 'split'; uuid: string; numInPage: number; offset: number}
  /** Near text, but not saying clearly where: the reason goes to Ignored. */
  | {kind: 'unclear'; reason: string};

/**
 * How close (in characters) to a word's edge the tip snaps to that edge. (A device test once
 * looked like it needed more: the words were measured about 15 px left of where NOTE draws them,
 * see `textLeftX`.)
 */
export const WORD_EDGE_SNAP_CHARS = 0.6;
/** A snap from further inside the word than this is shown as "Check place". */
export const UNCERTAIN_SNAP_CHARS = 0.3;
/** Horizontal slack around a textbox for a caret drawn just left or right of the text. */
const COLUMN_SLACK_PX = 24;
/** The same for a < or > in the margin. */
const SIDEWAYS_SLACK_PX = 100;

/** Slack around a line's band and a textbox's rect, in pixels. */
const LINE_SLACK_PX = 4;

/**
 * How well a line fits the tip, lower is better; null for a line the tip isn't near. A tip
 * inside a line belongs to that line (carets are drawn on the text: a V's tip near the baseline,
 * a ∧'s near the top of the letters). A tip in the textbox but between two lines goes to the
 * nearer one; when both are as near, a V points to the line below, a ∧ to the line above.
 */
function lineScore(
  tip: Point,
  direction: CaretDirection,
  line: {top: number; bottom: number},
  insideTextbox: boolean,
): number | null {
  const lineHeight = Math.max(1, line.bottom - line.top);
  if (
    tip.y >= line.top - LINE_SLACK_PX &&
    tip.y <= line.bottom + LINE_SLACK_PX
  ) {
    return Math.abs(tip.y - (line.top + line.bottom) / 2) / lineHeight;
  }
  const below = line.top > tip.y;
  const gap = below ? line.top - tip.y : tip.y - line.bottom;
  if (direction === 'left' || direction === 'right') {
    // A sideways caret points along its line: it may sit a little above or below it.
    return gap <= lineHeight * 0.6 ? 1 + gap / lineHeight : null;
  }
  if (!insideTextbox) {
    return null;
  }
  const pointedAt = (direction === 'down') === below;
  return 1 + gap / lineHeight + (pointedAt ? 0 : 0.01);
}

function offsetOnLine(
  tipX: number,
  line: {start: number; end: number},
  words: CaretTextbox['words'],
  text: string,
): {offset: number; mode: CaretInsertMode; snapped?: number} {
  const onLine = words.sort((a, b) => a.left - b.left);
  if (onLine.length === 0 || text.slice(line.start, line.end).trim() === '') {
    return {offset: line.start, mode: 'blankLine'};
  }
  const first = onLine[0];
  const last = onLine[onLine.length - 1];
  if (tipX <= first.left) {
    return {offset: first.start, mode: 'betweenWords'};
  }
  if (tipX >= last.right) {
    return {offset: last.end, mode: 'betweenWords'};
  }
  for (let index = 0; index < onLine.length; index += 1) {
    const word = onLine[index];
    if (tipX >= word.left && tipX <= word.right) {
      const length = Math.max(1, word.end - word.start);
      const position = charPositionInWord(word, tipX);
      if (position < WORD_EDGE_SNAP_CHARS) {
        return {offset: word.start, mode: 'betweenWords', snapped: position};
      }
      if (length - position < WORD_EDGE_SNAP_CHARS) {
        return {offset: word.end, mode: 'betweenWords', snapped: length - position};
      }
      return {offset: word.start + Math.round(position), mode: 'inWord'};
    }
    const next = onLine[index + 1];
    if (next && tipX > word.right && tipX < next.left) {
      return {offset: word.end, mode: 'betweenWords'};
    }
  }
  return {offset: last.end, mode: 'betweenWords'};
}

/**
 * The place the caret's tip points to: a line of a textbox in its column, or the space between
 * two paragraphs. Null when the tip is near no text at all.
 */
export function locateCaret(
  tip: Point,
  direction: CaretDirection,
  textboxes: CaretTextbox[],
): CaretTarget | null {
  if (direction === 'step') {
    return locateStep(
      tip,
      textboxes.filter(
        textbox =>
          tip.x >= textbox.rect.left - COLUMN_SLACK_PX &&
          tip.x <= textbox.rect.right + COLUMN_SLACK_PX,
      ),
    );
  }
  if (direction === 'left' || direction === 'right') {
    return locateSideways(
      tip,
      textboxes.filter(
        textbox =>
          tip.x >= textbox.rect.left - SIDEWAYS_SLACK_PX &&
          tip.x <= textbox.rect.right + SIDEWAYS_SLACK_PX,
      ),
    );
  }
  const column = textboxes.filter(
    textbox =>
      tip.x >= textbox.rect.left - COLUMN_SLACK_PX &&
      tip.x <= textbox.rect.right + COLUMN_SLACK_PX,
  );
  let best: {
    textbox: CaretTextbox;
    line: CaretTextbox['lines'][number];
    score: number;
  } | null = null;
  for (const textbox of column) {
    const insideTextbox =
      tip.y >= textbox.rect.top - LINE_SLACK_PX &&
      tip.y <= textbox.rect.bottom + LINE_SLACK_PX &&
      tip.x >= textbox.rect.left - COLUMN_SLACK_PX &&
      tip.x <= textbox.rect.right + COLUMN_SLACK_PX;
    for (const line of textbox.lines) {
      const score = lineScore(tip, direction, line, insideTextbox);
      if (score !== null && (!best || score < best.score)) {
        best = {textbox, line, score};
      }
    }
  }
  if (best) {
    const {textbox, line} = best;
    const words = textbox.words.filter(word => word.lineIndex === line.index);
    const {offset, mode, snapped} = offsetOnLine(tip.x, line, words, textbox.text);
    const uncertain =
      best.score >= 1
        ? "The caret's tip was between two lines; it went to the nearer one."
        : snapped !== undefined && snapped > UNCERTAIN_SNAP_CHARS
        ? "The caret's tip was inside a word; it went to the word's edge."
        : undefined;
    return {
      kind: 'text',
      uuid: textbox.uuid,
      numInPage: textbox.numInPage,
      offset,
      mode,
      ...(uncertain ? {uncertain} : {}),
    };
  }
  if (
    column.length === 0 ||
    column.some(
      textbox => tip.y > textbox.rect.top && tip.y < textbox.rect.bottom,
    )
  ) {
    return null;
  }
  const ordered = [...column].sort((a, b) => a.rect.top - b.rect.top);
  const above =
    [...ordered].reverse().find(textbox => textbox.rect.bottom <= tip.y) ??
    null;
  const below = ordered.find(textbox => textbox.rect.top >= tip.y) ?? null;
  if (!above && !below) {
    return null;
  }
  return {kind: 'gap', above: above?.uuid ?? null, below: below?.uuid ?? null};
}
