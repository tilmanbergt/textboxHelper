import {rectCenter, rectHeight, rectWidth} from '../../geometry';
import type {Rect} from '../../textboxModel';

/**
 * The strike family, read from stroke rects alone (technical-design-mark-dialogue.md §2.3): a
 * strike (long and flat, or a straight line), the two short verticals at its ends that mark exact
 * bounds (technical-design-fine-marks.md §3, technical-design-mark-dialogue.md §13.4), and the
 * small loop after it that makes it a replace mark (technical-design-pen-edits.md As built). The
 * verticals alone delete exactly what is between them; with a loop the tagged text replaces it.
 * Verticals inside a strike, away from its ends, are no pair. Rects only, so the look-back
 * (recognize rects) and the review (stroke bounds) read the same.
 */

/** A strike is at least this wide (pixels). */
export const MIN_MARKER_WIDTH = 30;
/** A strike is at most this tall for its width: flatter than ~29°, so it never reads as a slash. */
export const MAX_MARKER_HEIGHT_RATIO = 0.55;

/** A vertical across a strike is at least this tall. */
export const REPLACE_MODIFIER_MIN_HEIGHT = 18;
/** A vertical stands this near a strike's end (pixels): 0.15 strike widths, at least 20, at most 40. */
const END_SLACK_MIN = 20;
const END_SLACK_MAX = 40;
/** A short strike, between two verticals only (one letter): at least this wide (pixels). */
export const SHORT_STRIKE_MIN_WIDTH = 10;

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
 * A flat stroke too short for a strike alone (one or two letters): a strike only with a vertical
 * at each end (`endVerticals`).
 */
export function isShortStrikeRect(rect: Rect): boolean {
  const width = rectWidth(rect);
  return width >= SHORT_STRIKE_MIN_WIDTH && width < MIN_MARKER_WIDTH && rectHeight(rect) <= Math.max(8, width * MAX_MARKER_HEIGHT_RATIO);
}

/** How near a strike's end a vertical stands to mark it. */
function endSlack(strike: Rect): number {
  return Math.min(END_SLACK_MAX, Math.max(END_SLACK_MIN, rectWidth(strike) * 0.15));
}

/**
 * A vertical across a strike (by its rect): tall and narrow (steeper than ~70°), crossing the
 * strike's middle height, its middle within the strike's length (with the end slack). Whether it
 * marks an end is `endVerticals`'; whether it stands on the strike's line of text is pass 2's.
 */
export function isReplaceVertical(strike: Rect, vertical: Rect): boolean {
  const height = rectHeight(vertical);
  if (height < REPLACE_MODIFIER_MIN_HEIGHT || rectWidth(vertical) > Math.max(8, height * 0.4)) {
    return false;
  }
  const strikeCenter = rectCenter(strike);
  const center = rectCenter(vertical);
  const slack = endSlack(strike);
  return (
    center.x >= strike.left - slack &&
    center.x <= strike.right + slack &&
    vertical.top <= strikeCenter.y &&
    vertical.bottom >= strikeCenter.y
  );
}

/**
 * The verticals that mark a strike's two ends, left to right (technical-design-mark-dialogue.md
 * §13.4): one near each end, the pair nearest to both ends; [] when there is none. Verticals
 * inside the strike, away from its ends, mark nothing.
 */
export function endVerticals<T>(strike: Rect, verticals: T[], rectOf: (item: T) => Rect): T[] {
  const slack = endSlack(strike);
  const x = (item: T) => rectCenter(rectOf(item)).x;
  let best: T[] = [];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const left of verticals) {
    for (const right of verticals) {
      const toStart = Math.abs(x(left) - strike.left);
      const toEnd = Math.abs(x(right) - strike.right);
      if (left !== right && x(right) - x(left) >= 4 && toStart <= slack && toEnd <= slack && toStart + toEnd < bestDistance) {
        bestDistance = toStart + toEnd;
        best = [left, right];
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
