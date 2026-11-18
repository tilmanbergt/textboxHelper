import {rectCenter} from './geometry';
import {
  MAX_MARKER_HEIGHT_RATIO,
  MIN_MARKER_WIDTH,
  REPLACE_MODIFIER_MIN_HEIGHT,
  REPLACE_MODIFIER_PAIR_MAX_GAP,
  isVerticalLikeStroke,
} from './markerStrokes';
import type {PenEditMark} from './penEditModel';
import type {StrokeStats} from './markerTypes';

/**
 * Pairing a tagged replacement with its replace mark at tag time (technical-design-pen-edits.md
 * §3.5). Rule: the replacement is written right after its mark, so only the few elements just
 * before the snippet are looked at — no textbox measurement, no recognition, no page scan. Whether
 * the strike really covers words is checked later, in the review.
 */

/** How many element numbers before the snippet are read. */
export const LOOK_BACK_WINDOW = 8;

/** One element of the look-back window, already reduced to its stroke statistics. */
export type WindowStroke = {
  uuid: string;
  numInPage: number;
  /** A straight line drawn with the geometry tool. */
  isStraightLine: boolean;
  stats: StrokeStats;
};

/** The element numbers to read: L−1 down to L−window, never below 1. */
export function lookBackNumbers(lowestSnippetNum: number, window = LOOK_BACK_WINDOW): number[] {
  const numbers: number[] = [];
  for (let num = lowestSnippetNum - 1; num >= 1 && num >= lowestSnippetNum - window; num -= 1) {
    numbers.push(num);
  }
  return numbers;
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

/**
 * The newest replace mark in the window: a strike (long flat stroke or straight line) crossed by
 * two short vertical strokes. Strikes in `taken` are already paired with another snippet.
 */
export function findReplaceMarkInWindow(window: WindowStroke[], taken: ReadonlySet<string>): PenEditMark | null {
  const newestFirst = [...window].sort((a, b) => b.numInPage - a.numInPage);
  for (const strike of newestFirst) {
    if (taken.has(strike.uuid) || !isStrikeLike(strike)) {
      continue;
    }
    const crossing = newestFirst.filter(other => other.uuid !== strike.uuid && !other.isStraightLine && crossesStrike(strike, other));
    const pair = bestModifierPair(crossing);
    if (pair) {
      return {kind: 'replace', strikeUuid: strike.uuid, modifierUuids: pair.map(stroke => stroke.uuid)};
    }
  }
  return null;
}
