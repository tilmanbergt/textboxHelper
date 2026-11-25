import {pointInRect} from '../../geometry';
import {coveredSpan} from '../../edgeShift';
import {findCandidateLineIndexes, findLineBandWordCandidates} from '../../hitTesting';
import type {Rect} from '../../textboxModel';
import type {MarkStroke} from '../markStroke';
import type {TextboxView} from '../textboxView';
import {exactSpan} from './exact';

/**
 * Where a strike acts (technical-design-mark-dialogue.md §2.5, the delete analysis of
 * technical-design-pen-edits.md): it must land in exactly one textbox, on one of its lines, and
 * cover at least half of a word there. Words are the measured ones in page pixels; a word's band
 * is its line's (the native measure gives each word its line's top and bottom).
 */

/** A word under a strike: its place on the page and how much of it the strike covers. */
export type StrikeWord = {
  start: number;
  end: number;
  lineIndex: number;
  text: string;
  left: number;
  right: number;
  absoluteLeft: number;
  absoluteRight: number;
  edges?: number[];
  overlapRatio: number;
};

export type StrikePlace =
  | {ok: true; view: TextboxView; lineIndex: number; line: {top: number; bottom: number}; words: StrikeWord[]}
  | {ok: false; reason: string; removable: boolean; locked?: TextboxView; trace?: Record<string, unknown>};

/** A strike takes at most this many words. */
export const MAX_DELETE_WORDS_PER_MARKER = 100;

/** A word with a letter or digit: a strike over punctuation alone takes nothing. */
export function isMeaningfulWord(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

export const STRIKE_REASONS = {
  notOneTextbox: 'The marker does not land clearly inside exactly one main-layer textbox.',
  noLayout: 'Detailed text layout data was unavailable for the target textbox.',
  lines: 'The marker crosses multiple rendered lines or does not align with a single line.',
  noLine: 'The marker aligned to a rendered line that could not be resolved for preview.',
  noWord: 'No word was covered enough to classify a delete operation.',
} as const;

function overlaps(a: Rect, b: Rect): boolean {
  return Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
}

function center(rect: Rect): {x: number; y: number} {
  return {x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2};
}

/**
 * The textbox a stroke lands in: its middle inside exactly one textbox, its rect overlapping only
 * that one. Null with the number of textboxes its middle is in otherwise.
 */
export function landingView(rect: Rect, views: TextboxView[]): {view: TextboxView} | {centered: number} {
  const centered = views.filter(view => pointInRect(center(rect), view.rect));
  const overlapping = views.filter(view => overlaps(rect, view.rect));
  return centered.length === 1 && overlapping.length === 1 ? {view: centered[0]} : {centered: centered.length};
}

/**
 * Where a strike lands, or why not. `shapeRefusal`: pass 1's reason when the stroke is no strike,
 * reported only once the stroke is known to land on a readable textbox (as the review always did).
 * `want` is told which textbox's layout is needed (pass 2 measures lazily, `PageResult.wanted`).
 */
export function placeStrike(
  stroke: MarkStroke,
  views: TextboxView[],
  shapeRefusal: string | null,
  want: (view: TextboxView) => void = () => undefined,
  verticals: Rect[] | null = null,
): StrikePlace {
  const landing = landingView(stroke.rect, views);
  if (!('view' in landing)) {
    // Strokes away from every textbox may be ordinary handwriting: never offered for removal.
    return {ok: false, reason: STRIKE_REASONS.notOneTextbox, removable: landing.centered > 0};
  }
  const view = landing.view;
  want(view);
  if (!view.layout) {
    return {ok: false, reason: STRIKE_REASONS.noLayout, removable: true};
  }
  if (!view.fontReadable) {
    return {ok: false, reason: view.lockedReason ?? STRIKE_REASONS.noLayout, removable: true, locked: view};
  }
  if (shapeRefusal) {
    return {ok: false, reason: shapeRefusal, removable: true};
  }
  const layout = view.layout;
  const y = center(stroke.rect).y;
  // With a vertical at each end, the words between them, however little of each (§13.4).
  const bounds =
    verticals && verticals.length === 2
      ? {left: center(verticals[0]).x, right: center(verticals[1]).x, exact: true}
      : {left: stroke.rect.left, right: stroke.rect.right, exact: false};
  const lineOf = new Map(layout.lines.map(line => [line.index, line]));
  const words = layout.words.map(word => {
    const width = word.right - word.left;
    const overlap = Math.max(0, Math.min(word.right, bounds.right) - Math.max(word.left, bounds.left));
    // A word's box is its line's band (the native measure gives each word its line's top and bottom).
    const line = lineOf.get(word.lineIndex);
    return {
      start: word.start,
      end: word.end,
      lineIndex: word.lineIndex,
      text: layout.text.slice(word.start, word.end),
      left: word.left,
      right: word.right,
      absoluteLeft: word.left,
      absoluteRight: word.right,
      absoluteTop: line ? line.top : 0,
      absoluteBottom: line ? line.bottom : 0,
      projectedY: y,
      ...(word.edges ? {edges: word.edges} : {}),
      overlapRatio: width > 0 ? overlap / width : 0,
    };
  });
  // The words whose line band (without its top and bottom fifth) holds the strike's middle.
  const inBand = findLineBandWordCandidates(words.filter(word => lineOf.has(word.lineIndex)));
  const lineIndexes = findCandidateLineIndexes(inBand);
  const trace = {lineIndexes, inBand: inBand.map(word => ({start: word.start, end: word.end, overlap: word.overlapRatio}))};
  if (lineIndexes.length !== 1) {
    return {ok: false, reason: STRIKE_REASONS.lines, removable: true, trace};
  }
  const line = lineOf.get(lineIndexes[0]);
  if (!line) {
    return {ok: false, reason: STRIKE_REASONS.noLine, removable: true, trace};
  }
  const covered = inBand.filter(word => (bounds.exact ? word.overlapRatio > 0 : word.overlapRatio >= 0.5 && isMeaningfulWord(word.text)));
  if (covered.length === 0) {
    return {ok: false, reason: STRIKE_REASONS.noWord, removable: true, trace};
  }
  const unique = new Map(covered.map(word => [`${word.start}-${word.end}`, word]));
  const ordered = [...unique.values()].sort((a, b) => a.start - b.start);
  if (ordered.length > MAX_DELETE_WORDS_PER_MARKER) {
    return {ok: false, reason: `The marker would delete too many words at once (${ordered.length}).`, removable: true, trace};
  }
  return {ok: true, view, lineIndex: line.index, line: {top: line.top, bottom: line.bottom}, words: ordered};
}

/** A vertical of a replace mark that also stands on the strike's line: half its height on it. */
export function onLine(line: {top: number; bottom: number}, vertical: Rect): boolean {
  const overlap = Math.max(0, Math.min(line.bottom, vertical.bottom) - Math.max(line.top, vertical.top));
  return overlap >= (vertical.bottom - vertical.top) * 0.5;
}

/**
 * The exact range between two verticals (technical-design-fine-marks.md §3.1): each vertical's
 * middle x turned into a character offset among the struck words. Null when they mark nothing.
 */
export function exactRange(words: StrikeWord[], verticals: Rect[]): {start: number; end: number} | null {
  const [left, right] = verticals.map(rect => (rect.left + rect.right) / 2);
  return exactSpan(words, left, right);
}

/**
 * The part a strike takes: exactly between its verticals, or the words it covers without
 * punctuation at the ends it didn't reach (technical-design-pen-edits-2.md §6).
 */
export function strikeSpan(words: StrikeWord[], rect: Rect, verticals: Rect[] | null): {start: number; end: number; exact: boolean} {
  const exact = verticals && verticals.length === 2 ? exactRange(words, verticals) : null;
  if (exact) {
    return {...exact, exact: true};
  }
  const span = coveredSpan(words, rect.left, rect.right) ?? {start: words[0].start, end: words[words.length - 1].end};
  return {...span, exact: false};
}

/** Textboxes in reading order: top to bottom, then left to right (1 px slack). */
export function byReadingOrder(a: {rect: Rect}, b: {rect: Rect}): number {
  if (Math.abs(a.rect.top - b.rect.top) > 1) {
    return a.rect.top - b.rect.top;
  }
  if (Math.abs(a.rect.left - b.rect.left) > 1) {
    return a.rect.left - b.rect.left;
  }
  return a.rect.bottom - b.rect.bottom;
}
