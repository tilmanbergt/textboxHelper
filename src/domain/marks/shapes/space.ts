import type {Rect} from '../../textboxModel';
import {pathLength, type Point} from '../markStroke';
import type {CaretShape} from './caret';

/**
 * The insert-space mark (technical-design-swap-space-marks.md §4): a ∧ or V on the line with a
 * small cross (+, × or #) near its tip. On its own a caret means nothing; the cross makes it
 * "a space here". Pure: works on stroke bounds and points.
 */

export type ShortStroke = {
  uuid: string;
  numInPage: number;
  rect: Rect;
  points: Point[];
};

/** A cross stroke's longest side, in pixels. */
export const CROSS_MIN_SIZE = 8;
export const CROSS_MAX_SIZE = 80;
/** How far (pixels, at least) the cross's middle may be from the caret's tip. */
export const CROSS_REACH_PX = 40;

function sizeOf(rect: Rect): number {
  return Math.max(rect.right - rect.left, rect.bottom - rect.top);
}


/** A short, fairly straight stroke: a possible leg of a cross. */
export function isCrossLeg(stroke: ShortStroke): boolean {
  const size = sizeOf(stroke.rect);
  if (size < CROSS_MIN_SIZE || size > CROSS_MAX_SIZE || stroke.points.length < 2) {
    return false;
  }
  const first = stroke.points[0];
  const last = stroke.points[stroke.points.length - 1];
  const direct = Math.hypot(last.x - first.x, last.y - first.y);
  return direct >= size * 0.7 && pathLength(stroke.points) <= direct * 1.25 + 4;
}

type Segment = {a: Point; b: Point};

function segmentOf(stroke: ShortStroke): Segment {
  return {a: stroke.points[0], b: stroke.points[stroke.points.length - 1]};
}

/** Where two legs cross (with a little slack at their ends), and at what angle in degrees. */
export function crossingOf(
  first: ShortStroke,
  second: ShortStroke,
  slackPx = 4,
): {point: Point; angle: number} | null {
  const s = segmentOf(first);
  const t = segmentOf(second);
  const dx1 = s.b.x - s.a.x;
  const dy1 = s.b.y - s.a.y;
  const dx2 = t.b.x - t.a.x;
  const dy2 = t.b.y - t.a.y;
  const denominator = dx1 * dy2 - dy1 * dx2;
  const length1 = Math.hypot(dx1, dy1);
  const length2 = Math.hypot(dx2, dy2);
  if (Math.abs(denominator) < 1e-6 || length1 === 0 || length2 === 0) {
    return null;
  }
  const u = ((t.a.x - s.a.x) * dy2 - (t.a.y - s.a.y) * dx2) / denominator;
  const v = ((t.a.x - s.a.x) * dy1 - (t.a.y - s.a.y) * dx1) / denominator;
  const slack1 = slackPx / length1;
  const slack2 = slackPx / length2;
  if (u < -slack1 || u > 1 + slack1 || v < -slack2 || v > 1 + slack2) {
    return null;
  }
  const cosine = Math.abs(dx1 * dx2 + dy1 * dy2) / (length1 * length2);
  const angle = (Math.acos(Math.min(1, cosine)) * 180) / Math.PI;
  return {point: {x: s.a.x + u * dx1, y: s.a.y + u * dy1}, angle};
}

/**
 * The cross that turns a ∧ or V into an insert-space mark: two legs crossing at 45° or more,
 * whose crossing is near the caret's tip; with a third or fourth leg crossing one of them (a #)
 * taken along. Null when there is none.
 */
export function findCrossAtCaret(
  caret: CaretShape,
  strokes: ShortStroke[],
): ShortStroke[] | null {
  if (caret.direction !== 'up' && caret.direction !== 'down') {
    return null;
  }
  const caretSize = sizeOf(caret.rect);
  const reach = Math.max(CROSS_REACH_PX, caretSize * 1.5);
  const legs = strokes.filter(isCrossLeg);
  let best: {pair: [ShortStroke, ShortStroke]; distance: number} | null = null;
  for (let i = 0; i < legs.length; i += 1) {
    for (let j = i + 1; j < legs.length; j += 1) {
      const crossing = crossingOf(legs[i], legs[j]);
      if (!crossing || crossing.angle < 45) {
        continue;
      }
      const distance = Math.hypot(
        crossing.point.x - caret.tip.x,
        crossing.point.y - caret.tip.y,
      );
      if (distance <= reach && (!best || distance < best.distance)) {
        best = {pair: [legs[i], legs[j]], distance};
      }
    }
  }
  if (!best) {
    return null;
  }
  const chosen = [...best.pair];
  const nearCrossing = (a: ShortStroke, b: ShortStroke): boolean => {
    const crossing = crossingOf(a, b);
    return (
      !!crossing &&
      crossing.angle >= 45 &&
      Math.hypot(crossing.point.x - caret.tip.x, crossing.point.y - caret.tip.y) <= reach
    );
  };
  for (const leg of legs) {
    if (
      chosen.length < 4 &&
      !chosen.includes(leg) &&
      chosen.some(other => nearCrossing(other, leg))
    ) {
      chosen.push(leg);
    }
  }
  return chosen;
}
