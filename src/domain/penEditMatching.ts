import type {Rect} from './textboxModel';

/**
 * Finding a pen edit's strokes and mark again on the page (technical-design-pen-edits.md As built):
 * element uuids change with every read, so the tag writes `userData` onto the strokes and, as a
 * fallback, keeps their rects. A snippet moved with the lasso is followed through its badge's
 * shift; the mark is looked for where it was.
 */

/** How far a rect may differ (each side, page pixels) and still be the same stroke. */
export const RECT_MATCH_TOLERANCE = 8;

export function rectsMatch(a: Rect, b: Rect, tolerance = RECT_MATCH_TOLERANCE): boolean {
  return (
    Math.abs(a.left - b.left) <= tolerance &&
    Math.abs(a.top - b.top) <= tolerance &&
    Math.abs(a.right - b.right) <= tolerance &&
    Math.abs(a.bottom - b.bottom) <= tolerance
  );
}

export function shiftRect(rect: Rect, dx: number, dy: number): Rect {
  return {left: rect.left + dx, top: rect.top + dy, right: rect.right + dx, bottom: rect.bottom + dy};
}

/** How far `now` lies from `then` (0, 0 when either is unknown). */
export function rectShift(then: Rect | null, now: Rect | null): {dx: number; dy: number} {
  return then && now ? {dx: now.left - then.left, dy: now.top - then.top} : {dx: 0, dy: 0};
}

function distance(a: Rect, b: Rect): number {
  return Math.abs(a.left - b.left) + Math.abs(a.top - b.top) + Math.abs(a.right - b.right) + Math.abs(a.bottom - b.bottom);
}

/**
 * The page items matching the stored rects (shifted), each item used once, the closest first.
 * Items are anything with a key and a rect, so the caller keeps its own elements.
 */
export function matchByRects<T extends {rect: Rect | null}>(
  stored: Rect[],
  items: T[],
  shift: {dx: number; dy: number} = {dx: 0, dy: 0},
  tolerance = RECT_MATCH_TOLERANCE,
): T[] {
  const used = new Set<T>();
  const matched: T[] = [];
  for (const rect of stored) {
    const target = shiftRect(rect, shift.dx, shift.dy);
    let best: T | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const item of items) {
      if (used.has(item) || !item.rect || !rectsMatch(item.rect, target, tolerance)) {
        continue;
      }
      const d = distance(item.rect, target);
      if (d < bestDistance) {
        best = item;
        bestDistance = d;
      }
    }
    if (best) {
      used.add(best);
      matched.push(best);
    }
  }
  return matched;
}

/** True when `rect` matches one of the taken strike rects (a strike pairs with one snippet). */
export function isTakenStrike(rect: Rect, taken: Rect[]): boolean {
  return taken.some(other => rectsMatch(rect, other));
}
