import {rectCenter} from './geometry';
import type {Rect} from './textboxModel';
import {
  MAX_MARKER_HEIGHT_RATIO,
  MIN_MARKER_WIDTH,
  REPLACE_MODIFIER_MIN_HEIGHT,
  REPLACE_MODIFIER_PAIR_MAX_GAP,
  buildStrokeStats,
  isReplaceLoopRect,
  isVerticalLikeStroke,
} from './markerStrokes';
import type {PenEditMark} from './penEditModel';
import {isTakenStrike} from './penEditMatching';
import type {StrokeStats} from './markerTypes';

/**
 * Pairing a tagged replacement with its replace mark at tag time (technical-design-pen-edits.md
 * §3.5). Rule: the replacement is written right after its mark, so only the few elements just
 * before the snippet are looked at — no textbox measurement, no recognition, no page scan. Whether
 * the strike really covers words is checked later, in the review.
 */

/** How many elements before the snippet are looked at, not counting Textbox Tools' own. */
export const LOOK_BACK_WINDOW = 8;
/**
 * The most element numbers read: the host renumbers after inserts, so our own icons and numbers
 * can sit between a mark and its snippet and are skipped without counting.
 */
export const LOOK_BACK_MAX_READS = 14;

/** One element of the look-back window, already reduced to its stroke statistics. */
export type WindowStroke = {
  uuid: string;
  numInPage: number;
  /** A straight line drawn with the geometry tool. */
  isStraightLine: boolean;
  stats: StrokeStats;
};

/** The element numbers that may be read, newest first: L−1 down to L−maxReads, never below 1. */
export function lookBackNumbers(lowestSnippetNum: number, maxReads = LOOK_BACK_MAX_READS): number[] {
  const numbers: number[] = [];
  for (let num = lowestSnippetNum - 1; num >= 1 && num >= lowestSnippetNum - maxReads; num -= 1) {
    numbers.push(num);
  }
  return numbers;
}

/**
 * Stroke statistics from an element's bounding rect alone (the host's recognize rect): a line
 * through its long side. Enough for the pairing's shape tests, without reading the stroke points.
 */
export function strokeStatsFromRect(rect: Rect): StrokeStats | null {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  const cx = (rect.left + rect.right) / 2;
  const cy = (rect.top + rect.bottom) / 2;
  const stats =
    width >= height
      ? buildStrokeStats([{x: rect.left, y: cy}, {x: rect.right, y: cy}])
      : buildStrokeStats([{x: cx, y: rect.top}, {x: cx, y: rect.bottom}]);
  return stats ? {...stats, rect: {...rect}, width, height} : null;
}

function isStrikeLike(stroke: WindowStroke): boolean {
  if (stroke.isStraightLine) {
    return stroke.stats.width >= MIN_MARKER_WIDTH;
  }
  return stroke.stats.width >= MIN_MARKER_WIDTH && stroke.stats.height <= stroke.stats.width * MAX_MARKER_HEIGHT_RATIO;
}

function crossesStrike(strike: WindowStroke, candidate: WindowStroke): boolean {
  const stats = candidate.stats;
  if (
    stats.height < REPLACE_MODIFIER_MIN_HEIGHT ||
    stats.height <= stats.width ||
    !isVerticalLikeStroke(stats)
  ) {
    return false;
  }
  const strikeCenter = rectCenter(strike.stats.rect);
  const center = rectCenter(stats.rect);
  const margin = Math.max(16, strike.stats.width * 0.15);
  return (
    center.x >= strike.stats.rect.left - margin &&
    center.x <= strike.stats.rect.right + margin &&
    stats.rect.top <= strikeCenter.y &&
    stats.rect.bottom >= strikeCenter.y
  );
}

/** The closest pair of crossing strokes within the allowed gap, left to right; null if none. */
function bestModifierPair(crossing: WindowStroke[]): WindowStroke[] | null {
  let best: WindowStroke[] | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (let i = 0; i < crossing.length - 1; i += 1) {
    for (let j = i + 1; j < crossing.length; j += 1) {
      const gap = Math.abs(rectCenter(crossing[i].stats.rect).x - rectCenter(crossing[j].stats.rect).x);
      if (gap <= REPLACE_MODIFIER_PAIR_MAX_GAP && gap < bestGap) {
        bestGap = gap;
        best = [crossing[i], crossing[j]].sort(
          (a, b) => rectCenter(a.stats.rect).x - rectCenter(b.stats.rect).x,
        );
      }
    }
  }
  return best;
}

/** A replace mark found in the window: the strike and its two vertical lines, or its loop. */
export type WindowMark = {strike: WindowStroke; modifiers: WindowStroke[]; loop: WindowStroke | null};

/**
 * The newest replace mark in the window: a strike (long flat stroke or straight line) crossed by
 * two short vertical strokes, or followed by a small loop at its end. Strikes matching a `taken`
 * rect are already paired with another snippet.
 */
export function findReplaceMarkInWindow(window: WindowStroke[], taken: Rect[]): WindowMark | null {
  const newestFirst = [...window].sort((a, b) => b.numInPage - a.numInPage);
  for (const strike of newestFirst) {
    if (isTakenStrike(strike.stats.rect, taken) || !isStrikeLike(strike)) {
      continue;
    }
    const others = newestFirst.filter(other => other.uuid !== strike.uuid && !other.isStraightLine);
    const loop = others.find(
      other => other.numInPage > strike.numInPage && isReplaceLoopRect(strike.stats.rect, other.stats.rect),
    );
    if (loop) {
      return {strike, modifiers: [loop], loop};
    }
    const pair = bestModifierPair(others.filter(other => crossesStrike(strike, other)));
    if (pair) {
      return {strike, modifiers: pair, loop: null};
    }
  }
  return null;
}

/** The mark as stored: where its strike and verticals were. */
export function storedMark(mark: WindowMark): PenEditMark {
  return {
    kind: 'replace',
    strikeRect: {...mark.strike.stats.rect},
    modifierRects: mark.modifiers.map(modifier => ({...modifier.stats.rect})),
  };
}
