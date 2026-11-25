import {rectCenter, rectHeight, rectWidth} from '../../geometry';
import type {Rect} from '../../textboxModel';

/**
 * The strike family, read from stroke rects alone (technical-design-mark-dialogue.md §2.3): a
 * strike (long and flat, or a straight line), the two short verticals across it that mark exact
 * bounds (technical-design-fine-marks.md §3), and the small loop after it that makes it a replace
 * mark (technical-design-pen-edits.md As built). Verticals never make a replace mark
 * (technical-design-mark-dialogue.md §13.1 Q2): with them a strike deletes exactly what is
 * between them. Rects only, so the look-back (recognize rects) and the review (stroke bounds)
 * read the same.
 */

/** A strike is at least this wide (pixels). */
export const MIN_MARKER_WIDTH = 30;
/** A strike is at most this tall for its width: flatter than ~29°, so it never reads as a slash. */
export const MAX_MARKER_HEIGHT_RATIO = 0.55;

/** A vertical across a strike is at least this tall. */
export const REPLACE_MODIFIER_MIN_HEIGHT = 18;
/** The two verticals stand at most this far apart. */
export const REPLACE_MODIFIER_PAIR_MAX_GAP = 56;
/** A vertical's middle is at most this far (or 0.45 strike widths) from the strike's middle. */
export const REPLACE_MODIFIER_MAX_CENTER_DISTANCE = 48;

/** Size range of the small loop drawn after a strike to mark a replace (page pixels). */
export const REPLACE_LOOP_MIN_SIZE = 16;
export const REPLACE_LOOP_MAX_SIZE = 110;

/** Why a stroke (or a straight line) is no strike, or null when its shape is one. */
export function strikeShapeRefusal(rect: Rect): string | null {
  const width = rectWidth(rect);
  if (width < MIN_MARKER_WIDTH) {
    return 'The marker is too short to classify reliably.';
  }
  if (rectHeight(rect) > width * MAX_MARKER_HEIGHT_RATIO) {
    return 'The marker is too tall relative to its width.';
  }
  return null;
}

/** A strike-like stroke: long and flat. */
export function isStrikeLike(rect: Rect): boolean {
  return strikeShapeRefusal(rect) === null;
}

/**
 * A vertical across a strike (by its rect): tall and narrow, crossing the strike's middle height,
 * its middle within the strike's length (15 % slack) and near the strike's middle. Whether it also
 * stands on the strike's line of text is pass 2's.
 */
export function isReplaceVertical(strike: Rect, vertical: Rect): boolean {
  const height = rectHeight(vertical);
  if (height < REPLACE_MODIFIER_MIN_HEIGHT || height <= rectWidth(vertical)) {
    return false;
  }
  const strikeCenter = rectCenter(strike);
  const center = rectCenter(vertical);
  const strikeWidth = rectWidth(strike);
  const margin = Math.max(16, strikeWidth * 0.15);
  return (
    center.x >= strike.left - margin &&
    center.x <= strike.right + margin &&
    Math.abs(center.x - strikeCenter.x) <= Math.max(REPLACE_MODIFIER_MAX_CENTER_DISTANCE, strikeWidth * 0.45) &&
    vertical.top <= strikeCenter.y &&
    vertical.bottom >= strikeCenter.y
  );
}

/** The closest two of the verticals within the allowed gap, left to right; [] when none. */
export function closestVerticalPair<T>(verticals: T[], rectOf: (item: T) => Rect): T[] {
  let best: T[] = [];
  let bestGap = Number.POSITIVE_INFINITY;
  for (let i = 0; i < verticals.length - 1; i += 1) {
    for (let j = i + 1; j < verticals.length; j += 1) {
      const gap = Math.abs(rectCenter(rectOf(verticals[i])).x - rectCenter(rectOf(verticals[j])).x);
      if (gap <= REPLACE_MODIFIER_PAIR_MAX_GAP && gap < bestGap) {
        bestGap = gap;
        best = [verticals[i], verticals[j]].sort((a, b) => rectCenter(rectOf(a)).x - rectCenter(rectOf(b)).x);
      }
    }
  }
  return best;
}

/**
 * The second replace gesture: a small, roughly round loop drawn close to the strike: right after
 * its end at its height, or above the line anywhere along the strike (from its start to just past
 * its end). Also the test for the user's own circle for a number, measured from a point's rect.
 */
export function isReplaceLoopRect(strike: Rect, loop: Rect): boolean {
  const width = rectWidth(loop);
  const height = rectHeight(loop);
  const size = Math.max(width, height);
  if (size < REPLACE_LOOP_MIN_SIZE || size > REPLACE_LOOP_MAX_SIZE || Math.min(width, height) < size * 0.45) {
    return false;
  }
  const center = rectCenter(loop);
  const strikeY = (strike.top + strike.bottom) / 2;
  const afterEnd =
    loop.left >= strike.right - size * 0.6 &&
    loop.left <= strike.right + size + 24 &&
    Math.abs(center.y - strikeY) <= size / 2 + 20;
  const aboveLine =
    center.x >= strike.left - size / 2 &&
    center.x <= strike.right + size + 24 &&
    center.y < strikeY &&
    loop.bottom >= strikeY - size - 60 &&
    loop.bottom <= strikeY + 10;
  return afterEnd || aboveLine;
}

/** The loop for a strike among the candidates: the one closest to the strike's end; null if none. */
export function nearestLoop<T>(strike: Rect, candidates: T[], rectOf: (item: T) => Rect): T | null {
  const end = {x: strike.right, y: rectCenter(strike).y};
  const distance = (rect: Rect) => Math.hypot(rectCenter(rect).x - end.x, rectCenter(rect).y - end.y);
  return (
    candidates
      .filter(item => isReplaceLoopRect(strike, rectOf(item)))
      .sort((a, b) => distance(rectOf(a)) - distance(rectOf(b)))[0] ?? null
  );
}

/** A point's tiny rect: the user's circle for the number is measured from it like a loop from a strike. */
export function anchorRect(x: number, y: number): Rect {
  return {left: x, right: x, top: y, bottom: y};
}
