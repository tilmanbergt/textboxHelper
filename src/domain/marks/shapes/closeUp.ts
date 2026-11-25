import type {Point} from '../markStroke';

/**
 * The close-up arc's shape (technical-design-fine-marks.md §6, §7), from its points alone: a flat
 * arc ‿ or ⁀. Where it lands - one word gap, a line's end or start - is pass 2's.
 */

export type ArcShape = {
  /** The chord: the stroke's first and last point, left to right. */
  from: Point;
  to: Point;
  /** ‿ when the stroke sags below its chord (it opens up), ⁀ when above. */
  opening: 'up' | 'down';
  sag: number;
};

export const ARC_MIN_CHORD = 16;
export const ARC_MAX_CHORD = 220;
/** The chord's angle to the horizontal, at most. */
const ARC_MAX_TILT_DEG = 25;

function turning(points: Point[]): number[] {
  const turns: number[] = [];
  for (let index = 1; index < points.length - 1; index += 1) {
    const a = Math.atan2(points[index].y - points[index - 1].y, points[index].x - points[index - 1].x);
    const b = Math.atan2(points[index + 1].y - points[index].y, points[index + 1].x - points[index].x);
    let delta = Math.abs(b - a);
    if (delta > Math.PI) {
      delta = 2 * Math.PI - delta;
    }
    turns.push(delta);
  }
  return turns;
}

/**
 * Whether the stroke is an arc: a flat chord, the points sagging to one side of it by a clear but
 * not deep amount, the deepest point near the middle, and the bend spread along the stroke rather
 * than in one corner (a V or ∧ caret has its bend in its tip).
 */
export function analyzeArc(input: Point[]): ArcShape | null {
  if (input.length < 4) {
    return null;
  }
  const points = input[0].x <= input[input.length - 1].x ? input : [...input].reverse();
  const from = points[0];
  const to = points[points.length - 1];
  const chord = Math.hypot(to.x - from.x, to.y - from.y);
  if (chord < ARC_MIN_CHORD || chord > ARC_MAX_CHORD) {
    return null;
  }
  const tilt = (Math.atan2(Math.abs(to.y - from.y), Math.abs(to.x - from.x)) * 180) / Math.PI;
  if (tilt > ARC_MAX_TILT_DEG) {
    return null;
  }
  // Signed distance of each point from the chord: positive below it (page y grows down).
  const ux = (to.x - from.x) / chord;
  const uy = (to.y - from.y) / chord;
  const signed = points.map(point => (point.x - from.x) * -uy + (point.y - from.y) * ux);
  const below = signed.filter(value => value > 1).length;
  const above = signed.filter(value => value < -1).length;
  const side = below >= above ? 1 : -1;
  const onSide = signed.filter(value => value * side >= -1).length;
  if (onSide < points.length * 0.9) {
    return null;
  }
  let deepest = 0;
  signed.forEach((value, index) => {
    if (value * side > signed[deepest] * side) {
      deepest = index;
    }
  });
  const sag = signed[deepest] * side;
  if (sag < Math.max(4, chord * 0.12) || sag > chord * 0.6) {
    return null;
  }
  const along = ((points[deepest].x - from.x) * ux + (points[deepest].y - from.y) * uy) / chord;
  if (along < 0.2 || along > 0.8) {
    return null;
  }
  const turns = turning(points);
  const total = turns.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return null;
  }
  const window = Math.max(1, Math.round(turns.length * 0.15));
  for (let index = 0; index + window <= turns.length; index += 1) {
    const part = turns.slice(index, index + window).reduce((sum, value) => sum + value, 0);
    if (part > total * 0.5 && total > Math.PI / 3) {
      return null;
    }
  }
  return {from: {...from}, to: {...to}, opening: side > 0 ? 'up' : 'down', sag};
}
