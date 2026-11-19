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
import {isTakenStrike, rectsMatch} from './penEditMatching';
import {analyzeCaret, analyzeTwoStrokeCaret, type CaretShape, type Point} from './penEditCaret';
import {isSecondUpright} from './paragraphMarks';
import type {StrokeStats} from './markerTypes';

/**
 * Pairing a tagged replacement with its replace mark at tag time (technical-design-pen-edits.md
 * §3.5). Rule: the replacement is written right after its mark, so only the few elements just
 * before the snippet are looked at — no textbox measurement, no recognition, no page scan. Whether
 * the strike really covers words is checked later, in the review.
 */

/**
 * How many strokes before the snippet are looked at. A mark counts only when it is the last thing
 * written before the text (`pickNewestMark`), and the largest mark has three strokes (a strike and
 * two crossing lines), so three are enough; fewer reads make the tag quicker.
 */
export const LOOK_BACK_WINDOW = 3;
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

/** The newest element number among a mark's strokes. */
function newestNum(strokes: WindowStroke[]): number {
  return Math.max(...strokes.map(stroke => stroke.numInPage));
}

/**
 * The places of every stroke that already belongs to tagged text: its handwriting and its mark
 * (strike, loop or crossing lines, caret). They are never the mark of new text. Their tag on the
 * page usually says so too; the places cover strokes the host didn't let us tag.
 */
export function ownedRects(entries: Array<{strokeRects: Rect[]; mark: PenEditMark | null}>): Rect[] {
  return entries.flatMap(entry => [
    ...entry.strokeRects,
    ...(entry.mark?.kind === 'replace'
      ? [entry.mark.strikeRect, ...entry.mark.modifierRects]
      : entry.mark?.kind === 'caret'
        ? [entry.mark.caretRect]
        : []),
  ]);
}

/** The window without the strokes that already belong to tagged text. */
export function withoutOwned(window: WindowStroke[], owned: Rect[]): WindowStroke[] {
  return window.filter(stroke => !owned.some(rect => rectsMatch(rect, stroke.stats.rect)));
}

/**
 * Which of the marks found in the look-back the snippet belongs to (technical-design-pen-
 * edits-2.md §3): only a mark written last, right before the snippet, counts — its strokes must
 * include the newest stroke of the window. Anything older is earlier writing, and the snippet
 * gets "no mark found". When both qualify, a caret that reuses a stroke of the replace mark (a
 * loop or line read as a caret) is part of that replace mark; otherwise the newer one wins.
 */
export function pickNewestMark(
  window: WindowStroke[],
  replace: WindowMark | null,
  caretStrokes: WindowStroke[] | null,
): 'replace' | 'caret' | null {
  if (window.length === 0) {
    return null;
  }
  const newest = newestNum(window);
  const replaceStrokes = replace ? [replace.strike, ...replace.modifiers] : [];
  const replaceIsLast = replaceStrokes.length > 0 && newestNum(replaceStrokes) === newest;
  const caretIsLast = !!caretStrokes && caretStrokes.length > 0 && newestNum(caretStrokes) === newest;
  if (replaceIsLast && caretIsLast) {
    const replaceUuids = new Set(replaceStrokes.map(stroke => stroke.uuid));
    return (caretStrokes as WindowStroke[]).some(stroke => replaceUuids.has(stroke.uuid)) ? 'replace' : 'caret';
  }
  return replaceIsLast ? 'replace' : caretIsLast ? 'caret' : null;
}

/** A lassoed stroke with its points, for a mark the user selected. */
export type DeclaredStroke = WindowStroke & {points: Point[]};

export type DeclaredMark =
  | {kind: 'replace'; mark: WindowMark}
  | {kind: 'caret'; strokes: WindowStroke[]; rect: Rect; shape: CaretShape};

function unionOf(a: Rect, b: Rect): Rect {
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

/**
 * The mark in a lasso the user selected as a snippet's mark (Select mark). The user said it is a
 * mark, so the rules are looser than in the look-back: a caret (V ∧ < > or step, one stroke or two
 * meeting at the tip) first, as its shape is the more specific; else a replace mark, where the
 * strike alone is enough and a loop or crossing short lines are taken along when present. Strokes
 * that belong to neither stay out of the mark. Null when no stroke reads as a mark.
 */
export function readDeclaredMark(strokes: DeclaredStroke[]): DeclaredMark | null {
  const ordered = [...strokes].sort((a, b) => a.numInPage - b.numInPage);
  for (const stroke of ordered) {
    const shape = stroke.isStraightLine ? null : analyzeCaret(stroke.points);
    if (shape) {
      // A step's second upright (_||‾) is part of the mark.
      const upright =
        shape.direction === 'step'
          ? ordered.find(other => other !== stroke && !other.isStraightLine && isSecondUpright(shape, other.stats.rect))
          : undefined;
      return upright
        ? {kind: 'caret', strokes: [stroke, upright], rect: unionOf(stroke.stats.rect, upright.stats.rect), shape}
        : {kind: 'caret', strokes: [stroke], rect: {...stroke.stats.rect}, shape};
    }
  }
  for (let i = 0; i + 1 < ordered.length; i += 1) {
    const [first, second] = [ordered[i], ordered[i + 1]];
    const shape = analyzeTwoStrokeCaret(first.points, second.points);
    if (shape) {
      return {kind: 'caret', strokes: [first, second], rect: unionOf(first.stats.rect, second.stats.rect), shape};
    }
  }
  const strike = [...ordered]
    .filter(isStrikeLike)
    .sort((a, b) => b.stats.width - a.stats.width)[0];
  if (!strike) {
    return null;
  }
  const others = ordered.filter(other => other.uuid !== strike.uuid && !other.isStraightLine);
  const loop = others.find(other => isReplaceLoopRect(strike.stats.rect, other.stats.rect)) ?? null;
  if (loop) {
    return {kind: 'replace', mark: {strike, modifiers: [loop], loop}};
  }
  const crossing = others.filter(other => crossesStrike(strike, other)).slice(0, 2);
  return {kind: 'replace', mark: {strike, modifiers: crossing, loop: null}};
}
