import type {Rect} from '../../textboxModel';
import {boundsOf, type Point} from '../markStroke';

/**
 * The caret family, read from stroke points alone (technical-design-mark-dialogue.md §2.3): a V
 * or ∧ drawn on a line, a < or > beside the text, in one stroke or as two strokes meeting at the
 * tip (technical-design-pen-edits.md §8), and the step mark _|‾ with its second upright
 * (technical-design-paragraph-marks.md). The tip marks the place; where that is in the text is
 * pass 2's.
 */

export type {Point};
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

export const STEP_MIN_HEIGHT = 24;
export const STEP_MAX_HEIGHT = 160;
export const STEP_MIN_WIDTH = 40;
export const STEP_MAX_WIDTH = 700;

/** Whether a rect has a step mark's size; a cheap test before reading points. */
export function isStepSizedRect(rect: Rect): boolean {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  return (
    height >= STEP_MIN_HEIGHT &&
    height <= STEP_MAX_HEIGHT &&
    width >= STEP_MIN_WIDTH &&
    width <= STEP_MAX_WIDTH
  );
}

/**
 * The step mark, drawn in one stroke: a run to the right under a line, straight up, a run to the
 * right above it (_|‾), or the same falling (‾|_). Its tip is the upright's x at the mark's middle
 * height: the place to split. Null for any other shape. On its own in the review a step needs a
 * second upright next to its own to be a paragraph break (`isSecondUpright`); a bare step is a
 * swap's middle piece (technical-design-swap-space-marks.md §5.5).
 */
export function analyzeStepMark(points: Point[]): CaretShape | null {
  return risingStep(points) ?? fallingStep(points);
}

function fallingStep(points: Point[]): CaretShape | null {
  const flip = (point: Point): Point => ({x: point.x, y: -point.y});
  const shape = risingStep(points.map(flip));
  if (!shape) {
    return null;
  }
  return {
    tip: flip(shape.tip),
    direction: 'step',
    rect: {
      left: shape.rect.left,
      right: shape.rect.right,
      top: -shape.rect.bottom,
      bottom: -shape.rect.top,
    },
    ends: [flip(shape.ends[0]), flip(shape.ends[1])],
  };
}

function risingStep(points: Point[]): CaretShape | null {
  if (points.length < 4) {
    return null;
  }
  const rect = boundsOf(points) as Rect;
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  if (
    height < STEP_MIN_HEIGHT ||
    height > STEP_MAX_HEIGHT ||
    width < STEP_MIN_WIDTH ||
    width > STEP_MAX_WIDTH
  ) {
    return null;
  }
  const first = points[0];
  const last = points[points.length - 1];
  const lowBand = rect.bottom - height * 0.3;
  const highBand = rect.top + height * 0.3;
  if (
    first.y < lowBand ||
    first.x > rect.left + width * 0.35 ||
    last.y > highBand ||
    last.x < rect.right - width * 0.35
  ) {
    return null;
  }
  // The upright runs from the last point still low to the first point already high.
  let lowEnd = -1;
  points.forEach((point, index) => {
    if (point.y >= lowBand) {
      lowEnd = index;
    }
  });
  const highStart = points.findIndex(point => point.y <= highBand);
  if (lowEnd < 0 || highStart < 0 || lowEnd >= highStart) {
    return null;
  }
  const lowerRun = points.slice(0, lowEnd + 1);
  const upperRun = points.slice(highStart);
  const upright = points.slice(lowEnd, highStart + 1);
  const level = (run: Point[], from: number, to: number) =>
    run.every(point => point.y >= from && point.y <= to);
  if (
    !level(lowerRun, rect.bottom - height * 0.35, rect.bottom) ||
    !level(upperRun, rect.top, rect.top + height * 0.35) ||
    lowerRun[lowerRun.length - 1].x - lowerRun[0].x < 15 ||
    upperRun[upperRun.length - 1].x - upperRun[0].x < 15
  ) {
    return null;
  }
  const uprightXs = upright.map(point => point.x);
  if (
    Math.max(...uprightXs) - Math.min(...uprightXs) >
    Math.max(height * 0.25, 20)
  ) {
    return null;
  }
  const x = uprightXs.reduce((sum, value) => sum + value, 0) / uprightXs.length;
  return {
    tip: {x, y: (rect.top + rect.bottom) / 2},
    direction: 'step',
    rect,
    ends: [{...first}, {...last}],
  };
}

/** How far (pixels) a step's second upright may stand from its own, on either side. */
export const SECOND_UPRIGHT_MIN_GAP = 3;
export const SECOND_UPRIGHT_MAX_GAP = 32;

/**
 * Whether a stroke (by its bounds) is the second upright of a step mark that makes it a
 * paragraph break (_||‾): short and nearly vertical, beside the step's upright on either side,
 * crossing the step's middle height and covering at least half of the step's height.
 */
export function isSecondUpright(step: CaretShape, rect: Rect): boolean {
  if (step.direction !== 'step') {
    return false;
  }
  const height = rect.bottom - rect.top;
  const width = rect.right - rect.left;
  const stepHeight = step.rect.bottom - step.rect.top;
  const gap = Math.abs((rect.left + rect.right) / 2 - step.tip.x);
  const overlap =
    Math.min(rect.bottom, step.rect.bottom) - Math.max(rect.top, step.rect.top);
  return (
    height >= stepHeight * 0.5 &&
    width <= Math.max(14, height * 0.35) &&
    gap >= SECOND_UPRIGHT_MIN_GAP &&
    gap <= SECOND_UPRIGHT_MAX_GAP &&
    rect.top <= step.tip.y &&
    rect.bottom >= step.tip.y &&
    overlap >= Math.min(height, stepHeight) * 0.5
  );
}
