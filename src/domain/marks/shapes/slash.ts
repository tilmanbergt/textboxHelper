import type {Rect} from '../../textboxModel';
import {boundsOf, pathLength, type Point} from '../markStroke';
import {MAX_MARKER_HEIGHT_RATIO} from './strike';

/**
 * The slash through one letter, read from its points (technical-design-mark-dialogue.md §7): a
 * short, fairly straight stroke at least 30° steep. A strike is flatter than ~29°
 * (`MAX_MARKER_HEIGHT_RATIO`), so the two never overlap. The little hooks a pen leaves at the ends
 * are cut off before the test. Which letter it crosses is pass 2's.
 */

/** The slash's angle to the horizontal, at least. */
export const SLASH_MIN_ANGLE_DEG = 30;
const SLASH_MIN_STRAIGHTNESS = 0.85;
/** The slash's length from end to end (hooks cut off), pixels. */
export const SLASH_MIN_LENGTH = 10;
export const SLASH_MAX_LENGTH = 130;
/** How much of the path length is cut off at each end as a possible hook. */
const HOOK_SHARE = 0.1;

/**
 * `rect`: the whole stroke; `top`, `bottom`: the ends of its straight part, the upper one first;
 * `length`: the straight part's length, taken back to the whole stroke's (the hooks cut off are a
 * fifth of it). A flat slash is long but not tall: its size is judged by its length.
 */
export type SlashShape = {rect: Rect; top: Point; bottom: Point; angleDeg: number; length: number};

/** The point `distance` along the path from its start. */
function pointAlong(points: Point[], distance: number): {point: Point; index: number} {
  let walked = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const step = Math.hypot(b.x - a.x, b.y - a.y);
    if (walked + step >= distance && step > 0) {
      const t = (distance - walked) / step;
      return {point: {x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t}, index};
    }
    walked += step;
  }
  return {point: points[points.length - 1], index: points.length - 1};
}

/** The stroke without the first and last tenth of its length. */
function trimmed(points: Point[]): Point[] {
  const length = pathLength(points);
  if (length === 0) {
    return points;
  }
  const start = pointAlong(points, length * HOOK_SHARE);
  const end = pointAlong(points, length * (1 - HOOK_SHARE));
  return [start.point, ...points.slice(start.index, end.index), end.point];
}

/** A slash's shape from its points, or null when it is none. */
export function analyzeSlash(points: Point[]): SlashShape | null {
  if (points.length < 2) {
    return null;
  }
  const part = trimmed(points);
  const first = part[0];
  const last = part[part.length - 1];
  const direct = Math.hypot(last.x - first.x, last.y - first.y);
  if (direct < SLASH_MIN_LENGTH || direct > SLASH_MAX_LENGTH || pathLength(part) > direct / SLASH_MIN_STRAIGHTNESS) {
    return null;
  }
  const angleDeg = (Math.atan2(Math.abs(last.y - first.y), Math.abs(last.x - first.x)) * 180) / Math.PI;
  if (angleDeg < SLASH_MIN_ANGLE_DEG) {
    return null;
  }
  const rect = boundsOf(points) as Rect;
  const [top, bottom] = first.y <= last.y ? [first, last] : [last, first];
  return {rect, top: {...top}, bottom: {...bottom}, angleDeg, length: direct / (1 - 2 * HOOK_SHARE)};
}

/**
 * Whether a stroke's rect may hold a slash, before its points are read (the look-back reads the
 * points only of such strokes): not strike-like, 10–130 px tall, at most 130 px wide.
 */
export function isSlashCandidateRect(rect: Rect): boolean {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  return height > width * MAX_MARKER_HEIGHT_RATIO && height >= SLASH_MIN_LENGTH && height <= SLASH_MAX_LENGTH && width <= SLASH_MAX_LENGTH;
}
