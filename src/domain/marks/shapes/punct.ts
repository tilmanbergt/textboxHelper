import type {Rect} from '../../textboxModel';
import {pathLength, type Point} from '../markStroke';
import type {CaretShape} from './caret';

/**
 * The punctuation circle (technical-design-fine-marks.md §9): a ∧ or V with a small circle between
 * its legs. An empty circle is where the caret's number goes; a filled one holds a punctuation mark
 * that is put in at the caret's tip, with no tagged text. The plugin reads the circle's contents
 * itself, measured against the circle, so it doesn't matter whether it sits above or below the
 * line. Pure: stroke points and rects in page pixels.
 */

export type PlainStroke = {uuid: string; rect: Rect; points: Point[]};

export type Circle = {centre: Point; radius: number; rect: Rect};


function centreOf(rect: Rect): Point {
  return {x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2};
}

/** A closed, roughly round stroke: its ends meet (within a quarter of its size), aspect 0.6–1.6. */
export function analyzeCircle(points: Point[], rect: Rect): Circle | null {
  if (points.length < 6) {
    return null;
  }
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  const size = Math.max(width, height);
  if (size < 12 || width < height * 0.6 || height < width * 0.6) {
    return null;
  }
  const first = points[0];
  const last = points[points.length - 1];
  const closed = Math.hypot(last.x - first.x, last.y - first.y) <= Math.max(8, size * 0.25);
  // A circle's path goes about π times its size around; a stroke much shorter is an arc or a hook.
  if (!closed || pathLength(points) < size * 2.4) {
    return null;
  }
  return {centre: centreOf(rect), radius: size / 2, rect: {...rect}};
}

function sideOf(p: Point, a: Point, b: Point): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

/**
 * Whether a point lies in a caret's opening: the triangle between its tip and its two leg ends,
 * the legs taken 20 % longer than drawn (a circle may stick out a little at the open side).
 */
export function inCaretOpening(caret: CaretShape, point: Point): boolean {
  const {tip} = caret;
  const [a, b] = caret.ends.map(end => ({x: tip.x + (end.x - tip.x) * 1.2, y: tip.y + (end.y - tip.y) * 1.2}));
  const d1 = sideOf(point, tip, a);
  const d2 = sideOf(point, a, b);
  const d3 = sideOf(point, b, tip);
  const negative = d1 < 0 || d2 < 0 || d3 < 0;
  const positive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(negative && positive);
}

/** How long a caret's legs are (the longer one), for the circle's size limit. */
function legLength(caret: CaretShape): number {
  return Math.max(...caret.ends.map(end => Math.hypot(end.x - caret.tip.x, end.y - caret.tip.y)));
}

export type CaretCircle = {circle: PlainStroke; shape: Circle; contents: PlainStroke[]};

/**
 * The circle between a caret's legs, with the strokes inside it: the closed round stroke whose
 * centre is in the caret's opening (nearest the tip first), at most 1.2 legs across, and the
 * strokes whose middle lies in it and that are smaller than it (at most three). Null when there
 * is none.
 */
export function findCaretCircle(caret: CaretShape, strokes: PlainStroke[]): CaretCircle | null {
  if (caret.direction !== 'up' && caret.direction !== 'down') {
    return null;
  }
  const maxSize = legLength(caret) * 1.2;
  const circles = strokes
    .map(stroke => ({stroke, shape: analyzeCircle(stroke.points, stroke.rect)}))
    .filter(
      (item): item is {stroke: PlainStroke; shape: Circle} =>
        !!item.shape && item.shape.radius * 2 <= maxSize && inCaretOpening(caret, item.shape.centre),
    )
    .sort(
      (a, b) =>
        Math.hypot(a.shape.centre.x - caret.tip.x, a.shape.centre.y - caret.tip.y) -
        Math.hypot(b.shape.centre.x - caret.tip.x, b.shape.centre.y - caret.tip.y),
    );
  const found = circles[0];
  if (!found) {
    return null;
  }
  const {shape} = found;
  const contents = strokes
    .filter(stroke => stroke !== found.stroke)
    .filter(stroke => {
      const middle = centreOf(stroke.rect);
      const size = Math.max(stroke.rect.right - stroke.rect.left, stroke.rect.bottom - stroke.rect.top);
      return (
        Math.hypot(middle.x - shape.centre.x, middle.y - shape.centre.y) <= shape.radius &&
        size < shape.radius * 2
      );
    })
    .slice(0, 3);
  return {circle: found.stroke, shape, contents};
}

/** The punctuation a circle can hold: the plugin reads all but `?`, which is a quick pick. */
export const PUNCTUATION_CHARS = [',', ';', '.', ':', "'", '-', '?'] as const;
export type PunctuationChar = (typeof PUNCTUATION_CHARS)[number];

/** The plugin's own reading of a circle; `tie` when only the place can tell `,` from `'`. */
export type CircleReading = {char: PunctuationChar | null; tie: boolean};

type Part = {size: number; width: number; height: number; dy: number; dx: number; tiny: boolean};

/**
 * Reads the strokes in a circle (technical-design-fine-marks.md §9.2), every measure relative to
 * the circle: a tiny stroke is a dot; a short steep stroke a comma in the lower half or an
 * apostrophe in the upper half; a flat one a hyphen; two dots one above the other a colon; a dot
 * above a comma a semicolon. Anything else is not read (null): the row waits for the user's pick.
 */
export function readCircle(circle: Circle, contents: PlainStroke[]): CircleReading {
  const r = Math.max(1, circle.radius);
  const parts: Part[] = contents.map(stroke => {
    const width = stroke.rect.right - stroke.rect.left;
    const height = stroke.rect.bottom - stroke.rect.top;
    const size = Math.max(width, height);
    const middle = centreOf(stroke.rect);
    return {
      size,
      width,
      height,
      dy: (middle.y - circle.centre.y) / r,
      dx: (middle.x - circle.centre.x) / r,
      tiny: size <= Math.max(6, 0.3 * r),
    };
  });
  const none: CircleReading = {char: null, tie: false};
  if (parts.length === 1) {
    const [part] = parts;
    if (part.tiny) {
      return {char: '.', tie: false};
    }
    if (part.width >= 0.3 * r && part.height <= 0.35 * part.width && part.width <= 1.4 * r) {
      return {char: '-', tie: false};
    }
    if (part.height >= part.width && part.size <= 0.9 * r) {
      if (part.dy > 0.15) {
        return {char: ',', tie: false};
      }
      if (part.dy < -0.15) {
        return {char: "'", tie: false};
      }
      return {char: ',', tie: true};
    }
    return none;
  }
  if (parts.length === 2) {
    const [upper, lower] = [...parts].sort((a, b) => a.dy - b.dy);
    const stacked = lower.dy - upper.dy >= 0.2 && Math.abs(lower.dx - upper.dx) <= 0.5;
    if (!stacked || !upper.tiny) {
      return none;
    }
    if (lower.tiny) {
      return {char: ':', tie: false};
    }
    if (lower.height >= lower.width && lower.size <= 0.9 * r) {
      return {char: ';', tie: false};
    }
  }
  return none;
}
