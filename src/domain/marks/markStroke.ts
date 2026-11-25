import type {Rect} from '../textboxModel';

/**
 * The input of pass 1 (technical-design-mark-dialogue.md §2.1): one stroke of the page as the
 * plugin read it. The same type serves the tag's look-back (rects, points only where read), Select
 * mark and the review (points of every stroke).
 */

export type Point = {x: number; y: number};

export type MarkStroke = {
  /** The element's uuid for this read. */
  id: string;
  /** Writing order on the page. */
  numInPage: number;
  /** The stroke's rect (the host's recognize rect, or the bounds of its points). */
  rect: Rect;
  /** Page pixels in drawing order; null where not read (the look-back reads only small strokes). */
  points: Point[] | null;
  /** A straight line drawn with the geometry tool. */
  straightLine: boolean;
};

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

export function unionRect(a: Rect, b: Rect): Rect {
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

export function pathLength(points: Point[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return length;
}
