import {
  analyzeStepMark,
  locateSideways,
  locateStep,
  splitChangeText,
} from './paragraphMarks';
import type {Rect} from './textboxModel';
import {charPositionInWord} from './textOffsets';

/**
 * The insertion caret (technical-design-pen-edits.md §8, As built): a V or ∧ drawn on a line, or
 * a < or > drawn beside the text, in one stroke or as two strokes meeting at the tip. The tip marks the place in the
 * text; a caret in the space between two paragraphs makes a new paragraph there. Pure: shape tests
 * work on stroke points, placement on measured line and word boxes in page pixels.
 */

export type Point = {x: number; y: number};
/** Where the tip points: a V down, a ∧ up, a < left, a > right; 'step' for the step mark (_|‾). */
export type CaretDirection = 'down' | 'up' | 'left' | 'right' | 'step';
export type CaretShape = {
  tip: Point;
  direction: CaretDirection;
  rect: Rect;
  ends: [Point, Point];
};

export const CARET_MIN_SIZE = 14;
/** V and ∧ sit on the text: at most this big. */
export const CARET_MAX_SIZE = 130;
/** < and > sit in the margin and are drawn bigger. */
export const SIDEWAYS_CARET_MAX_SIZE = 250;
/** A leg may be at most this much longer than the straight line from its end to the tip. */
const LEG_STRAIGHTNESS = 1.4;

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pathLength(points: Point[], from: number, to: number): number {
  let length = 0;
  for (let index = from + 1; index <= to; index += 1) {
    length += distance(points[index - 1], points[index]);
  }
  return length;
}

export function boundsOf(points: Point[]): Rect | null {
  if (points.length === 0) {
    return null;
  }
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const point of points) {
    left = Math.min(left, point.x);
    right = Math.max(right, point.x);
    top = Math.min(top, point.y);
    bottom = Math.max(bottom, point.y);
  }
  return {left, top, right, bottom};
}

/** Whether a rect has a caret's size and proportions; a cheap test before reading points. */
export function isCaretSizedRect(rect: Rect): boolean {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  const size = Math.max(width, height);
  return (
    size >= CARET_MIN_SIZE &&
    size <= SIDEWAYS_CARET_MAX_SIZE &&
    height >= width * 0.25 &&
    width >= height * 0.25
  );
}

/**
 * A single stroke shaped like a V or a ∧: two fairly straight legs meeting in a tip in the middle
 * of the stroke, the ends apart on both sides of the tip. Loops, hooks and letters fail.
 */
export function analyzeCaret(points: Point[]): CaretShape | null {
  const step = analyzeStepMark(points);
  if (step) {
    return step;
  }
  const rect = boundsOf(points);
  if (!rect || points.length < 3 || !isCaretSizedRect(rect)) {
    return null;
  }
  for (const direction of ['down', 'up', 'left', 'right'] as const) {
    const shape = caretInDirection(points, rect, direction);
    if (shape) {
      return shape;
    }
  }
  return null;
}

function caretInDirection(
  points: Point[],
  rect: Rect,
  direction: CaretDirection,
): CaretShape | null {
  const vertical = direction === 'down' || direction === 'up';
  if (
    vertical &&
    Math.max(rect.right - rect.left, rect.bottom - rect.top) > CARET_MAX_SIZE
  ) {
    return null;
  }
  // `along`: the axis the tip points along; `across`: the axis the legs spread over.
  const along = (point: Point) => (vertical ? point.y : point.x);
  const across = (point: Point) => (vertical ? point.x : point.y);
  const sign = direction === 'down' || direction === 'right' ? 1 : -1;
  const depth = vertical ? rect.bottom - rect.top : rect.right - rect.left;
  const spread = vertical ? rect.right - rect.left : rect.bottom - rect.top;

  let tipIndex = 0;
  points.forEach((point, index) => {
    if (sign * along(point) > sign * along(points[tipIndex])) {
      tipIndex = index;
    }
  });
  const tip = points[tipIndex];
  const first = points[0];
  const last = points[points.length - 1];
  const inMiddle =
    tipIndex >= points.length * 0.15 && tipIndex <= points.length * 0.85;
  const endsAway =
    sign * (along(tip) - along(first)) >= depth * 0.5 &&
    sign * (along(tip) - along(last)) >= depth * 0.5;
  const bothSides =
    (across(first) - across(tip)) * (across(last) - across(tip)) < 0 &&
    Math.min(
      Math.abs(across(first) - across(tip)),
      Math.abs(across(last) - across(tip)),
    ) >=
      spread * 0.15;
  const straight =
    pathLength(points, 0, tipIndex) <=
      distance(first, tip) * LEG_STRAIGHTNESS + 6 &&
    pathLength(points, tipIndex, points.length - 1) <=
      distance(tip, last) * LEG_STRAIGHTNESS + 6;
  if (inMiddle && endsAway && bothSides && straight) {
    return {tip: {...tip}, direction, rect, ends: [{...first}, {...last}]};
  }
  return null;
}

/** How close (pixels) the two legs of a two-stroke caret must start or end to make one tip. */
export const TWO_STROKE_JOIN_PX = 24;

/**
 * A caret drawn as two strokes, one per leg: joined where their ends meet (the tip), then tested
 * like a one-stroke caret. Null when no ends meet or the joined shape is no caret.
 */
export function analyzeTwoStrokeCaret(
  first: Point[],
  second: Point[],
): CaretShape | null {
  if (first.length < 2 || second.length < 2) {
    return null;
  }
  const ends = (points: Point[]) => [points[0], points[points.length - 1]];
  let best: {gap: number; a: Point[]; b: Point[]} | null = null;
  for (const [aIndex, aEnd] of ends(first).entries()) {
    for (const [bIndex, bEnd] of ends(second).entries()) {
      const gap = distance(aEnd, bEnd);
      if (gap <= TWO_STROKE_JOIN_PX && (!best || gap < best.gap)) {
        // Leg a runs towards the tip, leg b away from it.
        const a = aIndex === 1 ? first : [...first].reverse();
        const b = bIndex === 0 ? second : [...second].reverse();
        best = {gap, a, b};
      }
    }
  }
  return best ? analyzeCaret([...best.a, ...best.b]) : null;
}

/**
 * Where the caret's number goes: on its open side, between the ends of its two legs (above a V,
 * below a ∧), so the user can draw the caret big enough for the number. Returns the number's centre.
 */
export function caretNumberCenter(shape: CaretShape): Point {
  const [a, b] = shape.ends;
  if (shape.direction === 'step') {
    // Right of the upper run's end, clear of the text.
    return {x: b.x + 28, y: b.y};
  }
  return {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
}

/** A textbox as the caret placement sees it: its text, lines and words in page pixels. */
export type CaretTextbox = {
  uuid: string;
  numInPage: number;
  rect: Rect;
  text: string;
  lines: Array<{
    index: number;
    start: number;
    end: number;
    top: number;
    bottom: number;
    /** Page y of the line's baseline, when measured. */
    baseline?: number;
  }>;
  /** Height of small letters in pixels, when measured. */
  xHeight?: number;
  words: Array<{
    start: number;
    end: number;
    lineIndex: number;
    left: number;
    right: number;
    /** Page x of each character's edge, when the native measurement gave them. */
    edges?: number[];
  }>;
};

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

const NO_SPACE_BEFORE = /^[.,;:!?)\]}»“”'’]/;
const NO_SPACE_AFTER = /[([{„«“‘'"]$/;

/**
 * The text to put in at `offset`, with the spaces it needs: as written inside a word, between
 * spaces at a word's edge, as its own paragraph on a blank line.
 */
export function caretInsertionText(
  original: string,
  offset: number,
  inserted: string,
  mode: CaretInsertMode,
): string {
  const text = inserted.trim();
  if (!text) {
    return '';
  }
  if (mode === 'inWord') {
    return text;
  }
  if (mode === 'paragraph') {
    return splitChangeText(text);
  }
  if (mode === 'blankLine') {
    return `\n${text}\n`;
  }
  const left = original.slice(0, offset);
  const right = original.slice(offset);
  const before =
    left.length > 0 &&
    !/\s$/.test(left) &&
    !NO_SPACE_AFTER.test(left) &&
    !NO_SPACE_BEFORE.test(text)
      ? ' '
      : '';
  const after =
    right.length > 0 && !/^\s/.test(right) && !NO_SPACE_BEFORE.test(right)
      ? ' '
      : '';
  return `${before}${text}${after}`;
}

/** One textbox (or new paragraph) that may move down, by its key. */
export type ReflowItem = {key: string; rect: Rect};
/**
 * Something that grows at `y` by `delta` in the columns between `left` and `right`. The items in
 * `sourceKeys` are the ones growing (or put in) and don't move because of it.
 */
export type ReflowEvent = {
  y: number;
  left: number;
  right: number;
  delta: number;
  sourceKeys: string[];
};

/**
 * How far each item moves down: the sum of the growth above it in its column (a paragraph that
 * got longer, a new paragraph put in). Items never move up.
 */
export function planReflow(
  items: ReflowItem[],
  events: ReflowEvent[],
): Map<string, number> {
  const shifts = new Map<string, number>();
  for (const item of items) {
    let dy = 0;
    for (const event of events) {
      if (
        !event.sourceKeys.includes(item.key) &&
        event.delta > 0 &&
        event.y <= item.rect.top + 2 &&
        Math.min(event.right, item.rect.right) >
          Math.max(event.left, item.rect.left)
      ) {
        dy += event.delta;
      }
    }
    if (dy > 0) {
      shifts.set(item.key, Math.round(dy));
    }
  }
  return shifts;
}

/** A new paragraph put in between two others, before its top is known. */
export type GapParagraph = {
  key: string;
  group: string;
  left: number;
  width: number;
  height: number;
  above: Rect | null;
  below: Rect | null;
};

/**
 * Places new paragraphs in their gaps: those sharing a gap follow each other in the given order,
 * spaced like the gap was, and push the paragraph below once by what they need together.
 */
export function placeGapParagraphs(paragraphs: GapParagraph[]): {
  rects: Map<string, Rect>;
  events: ReflowEvent[];
} {
  const rects = new Map<string, Rect>();
  const events: ReflowEvent[] = [];
  const groups = new Map<string, GapParagraph[]>();
  paragraphs.forEach(paragraph =>
    groups.set(paragraph.group, [
      ...(groups.get(paragraph.group) ?? []),
      paragraph,
    ]),
  );
  for (const members of groups.values()) {
    const first = members[0];
    // The gap's own spacing, kept between every pair of paragraphs in it.
    const spacing = gapParagraphPlacement(first.above, first.below, 0).spacing;
    let top = first.above
      ? first.above.bottom + spacing
      : (first.below as Rect).top;
    const firstTop = top;
    let lastBottom = top;
    for (const member of members) {
      const rect = {
        left: member.left,
        top: Math.round(top),
        right: member.left + member.width,
        bottom: Math.round(top + member.height),
      };
      rects.set(member.key, rect);
      lastBottom = rect.bottom;
      top = rect.bottom + spacing;
    }
    const push = first.below
      ? Math.max(0, Math.round(lastBottom + spacing - first.below.top))
      : 0;
    if (push > 0) {
      events.push({
        y: Math.round(firstTop),
        left: first.left,
        right: first.left + first.width,
        delta: push,
        sourceKeys: members.map(member => member.key),
      });
    }
  }
  return {rects, events};
}

/** Default space between paragraphs when there is no paragraph below to copy it from. */
export const DEFAULT_PARAGRAPH_GAP_PX = 24;

/**
 * Where a new paragraph between `above` and `below` goes, and how far it pushes the paragraphs
 * below: it keeps the space the two had (within limits) on both its sides.
 */
export function gapParagraphPlacement(
  above: Rect | null,
  below: Rect | null,
  height: number,
): {top: number; spacing: number; pushBelow: number} {
  const rawGap =
    above && below ? below.top - above.bottom : DEFAULT_PARAGRAPH_GAP_PX;
  const spacing = Math.min(60, Math.max(8, rawGap));
  const top = above ? above.bottom + spacing : (below as Rect).top;
  const pushBelow = below ? Math.max(0, top + height + spacing - below.top) : 0;
  return {top: Math.round(top), spacing, pushBelow: Math.round(pushBelow)};
}
