import type {PlaceAt} from './place';
import {placeStrike, strikeSpan, type StrikeWord} from './place/strike';
import {placeSlashReading, type PageMark, type StrokeOwner, type StrokeRef, type Want} from './pass2';
import {rectsWithRole, type Reading} from './reading';
import type {Rect} from '../textboxModel';
import type {TextboxView} from './textboxView';

/**
 * A linked mark in the review (technical-design-mark-dialogue.md §5.1 steps 2, 4, 6): its strokes
 * are kept out of pass 1, its stored reading (`readingOfStoredMark`) is placed with pass 2, and a
 * number on the page always shows: as a change, or as "place open" with why and the nearest
 * sensible place. Here (`confirmed`) takes that place.
 */

export const MARK_GONE = 'Its mark is no longer on the page.';

export type LinkedPlace =
  | {kind: 'placed'; mark: PageMark}
  | {kind: 'open'; reason: string; guess: PlaceAt | null; locked?: TextboxView};

function centre(rect: Rect): {x: number; y: number} {
  return {x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2};
}

/** The textbox a mark is on or nearest to (its middle's distance), measured. */
function nearestView(rect: Rect, views: TextboxView[], want: Want): TextboxView | null {
  const {x, y} = centre(rect);
  const distance = (view: TextboxView) =>
    Math.max(0, view.rect.left - x, x - view.rect.right) + Math.max(0, view.rect.top - y, y - view.rect.bottom);
  const view = [...views].sort((a, b) => distance(a) - distance(b))[0] ?? null;
  if (view) {
    want(view);
  }
  return view && view.layout && view.fontReadable ? view : null;
}

/** The line of a textbox nearest a height. */
function nearestLine(view: TextboxView, y: number) {
  const lines = view.layout?.lines ?? [];
  return [...lines].sort((a, b) => Math.abs((a.top + a.bottom) / 2 - y) - Math.abs((b.top + b.bottom) / 2 - y))[0] ?? null;
}

/**
 * The nearest sensible part for a strike that didn't place (§2.5): on the line nearest its middle,
 * the words it reaches across, or the word nearest it.
 */
export function guessPart(rect: Rect, views: TextboxView[], want: Want = () => undefined): PlaceAt | null {
  const view = nearestView(rect, views, want);
  const line = view ? nearestLine(view, centre(rect).y) : null;
  if (!view || !line) {
    return null;
  }
  const words = (view.layout?.words ?? []).filter(word => word.lineIndex === line.index);
  const reached = words.filter(word => word.right > rect.left && word.left < rect.right);
  const x = centre(rect).x;
  const chosen = reached.length > 0 ? reached : [...words].sort((a, b) => Math.abs((a.left + a.right) / 2 - x) - Math.abs((b.left + b.right) / 2 - x)).slice(0, 1);
  if (chosen.length === 0) {
    return null;
  }
  return {uuid: view.uuid, numInPage: view.numInPage, lineIndex: line.index, start: chosen[0].start, end: chosen[chosen.length - 1].end};
}

/** The nearest letter for a slash that didn't place: on the nearest line, under its middle. */
export function guessLetter(rect: Rect, views: TextboxView[], want: Want = () => undefined): PlaceAt | null {
  const part = guessPart({...rect, left: centre(rect).x - 1, right: centre(rect).x + 1}, views, want);
  if (!part) {
    return null;
  }
  const view = views.find(item => item.uuid === part.uuid);
  const word = view?.layout?.words.find(item => item.start === part.start);
  const x = centre(rect).x;
  const edges = word?.edges;
  let offset = part.start;
  if (word && edges && edges.length > 1) {
    const index = edges.findIndex((edge, at) => at < edges.length - 1 && x >= edge && x < edges[at + 1]);
    offset = word.start + (index >= 0 ? index : x < edges[0] ? 0 : word.end - word.start - 1);
  }
  return {...part, start: offset, end: offset + 1};
}

/** The words of a textbox a part covers, as a strike's words (for a place the user confirmed). */
function wordsIn(view: TextboxView, start: number, end: number): StrikeWord[] {
  return (view.layout?.words ?? [])
    .filter(word => word.end > start && word.start < end)
    .map(word => ({
      start: word.start,
      end: word.end,
      lineIndex: word.lineIndex,
      text: view.text.slice(word.start, word.end),
      left: word.left,
      right: word.right,
      absoluteLeft: word.left,
      absoluteRight: word.right,
      ...(word.edges ? {edges: word.edges} : {}),
      overlapRatio: 1,
    }));
}

/**
 * Places a linked replace mark: a strike (alone, with a loop, or with the verticals of an earlier
 * build) on the words it covers, a slash on its letter. `strokes`: the mark's strokes on the page
 * by id (for their numbers). Not placed: open with pass 2's reason and a guess; with `confirmed`
 * (Here) a guess is taken as the place.
 */
export function placeLinked(
  reading: Reading | null,
  owner: StrokeOwner,
  strokes: Map<string, StrokeRef>,
  views: TextboxView[],
  options: {confirmed?: boolean; want?: Want} = {},
): LinkedPlace {
  const want = options.want ?? (() => undefined);
  if (!reading) {
    return {kind: 'open', reason: MARK_GONE, guess: null};
  }
  const refs = reading.strokes.map(id => strokes.get(id)).filter((ref): ref is StrokeRef => !!ref);
  const consumed = refs.map(ref => ref.numInPage);
  const strikeRect = rectsWithRole(reading, 'mark')[0];
  if (reading.kind === 'slash') {
    const {place} = placeSlashReading(reading, views, want);
    const at = place.ok ? place : options.confirmed ? guessLetter(strikeRect, views, want) : null;
    const view = at ? views.find(item => item.uuid === at.uuid) : undefined;
    if (at && view && (place.ok || options.confirmed)) {
      return {
        kind: 'placed',
        mark: {kind: 'slash', strokes: refs, view, lineIndex: at.lineIndex, offset: at.start, ...(at.uncertain ? {uncertain: at.uncertain} : {}), owner},
      };
    }
    return {kind: 'open', reason: place.ok ? '' : place.reason, guess: guessLetter(strikeRect, views, want)};
  }
  const strike = {id: reading.strokes[0], numInPage: refs[0]?.numInPage ?? 0, rect: strikeRect, points: null, straightLine: false};
  // A linked strike's shape was taken when it was tagged: only its place is checked here.
  const placed = placeStrike(strike, views, null, want);
  if (placed.ok) {
    const verticals = reading.kind === 'strikeVerticals' ? rectsWithRole(reading, 'modifier') : null;
    return {
      kind: 'placed',
      mark: {
        kind: 'line',
        strike: refs[0] ?? {id: strike.id, numInPage: strike.numInPage},
        view: placed.view,
        lineIndex: placed.lineIndex,
        words: placed.words,
        span: strikeSpan(placed.words, strikeRect, verticals),
        consumed,
        owner,
      },
    };
  }
  const guess = placed.locked ? null : guessPart(strikeRect, views, want);
  const guessView = guess ? views.find(item => item.uuid === guess.uuid) : undefined;
  if (options.confirmed && guess && guessView) {
    const words = wordsIn(guessView, guess.start, guess.end);
    return {
      kind: 'placed',
      mark: {
        kind: 'line',
        strike: refs[0] ?? {id: strike.id, numInPage: strike.numInPage},
        view: guessView,
        lineIndex: guess.lineIndex,
        words,
        span: {start: guess.start, end: guess.end, exact: false},
        consumed,
        owner,
      },
    };
  }
  return {kind: 'open', reason: placed.reason, guess, ...(placed.locked ? {locked: placed.locked} : {})};
}
