import {isNoShift, shiftSpans, type EdgeShift} from '../edgeShift';
import type {Place} from './place';
import type {Reading} from './reading';

/**
 * Step 3, the user layer (technical-design-mark-dialogue.md §2.7): what the user decided on top of
 * passes 1 and 2. Here takes a place that stayed open at its guess; ‹ › move the place's edges by
 * characters (`edgeShift.ts`); an unclear mark is read the way the user chose. Pen edits keep it
 * in the index (`edges`, `confirmed`); plain marks keep it in memory. It is not part of the page's
 * fingerprint.
 */

export type UserLayer = {
  /** Here: the guess is the place. */
  here?: boolean;
  /** Character nudges of the place's edges (start, end). */
  edges?: EdgeShift | null;
  /** The reading the user chose among those pass 1 found (its index). */
  reading?: number;
};

/** A place with the user's layer on top. */
export function applyUserLayer(place: Place, layer: UserLayer, textLength: number): Place {
  let next: Place = place;
  if (!next.ok && layer.here && next.guess) {
    next = {ok: true, ...next.guess};
  }
  if (!next.ok || isNoShift(layer.edges)) {
    return next;
  }
  const [span] = shiftSpans(textLength, [{start: next.start, end: next.end, shift: layer.edges, zeroLength: next.start === next.end}]);
  return {...next, start: span.start, end: span.end};
}

/** The reading to place: the one the user chose, else pass 1's first. */
export function chosenReading(readings: Reading[], layer: UserLayer): Reading | null {
  const index = layer.reading ?? 0;
  return readings[index] ?? readings[0] ?? null;
}
