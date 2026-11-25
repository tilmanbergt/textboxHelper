import type {MarkStroke} from '../../src/domain/marks/markStroke';
import {lookBackPointsWanted, readDeclared, readLookBack, readMarks, VERTICALS_NO_TEXT_REASON} from '../../src/domain/marks/pass1';
import type {MarkKind, Reading} from '../../src/domain/marks/reading';
import {marks} from './build';
import {TABLES} from './pass1.cases';

/**
 * Do the tag's look-back, Select mark and the review judge the same strokes the same
 * (technical-design-mark-dialogue.md §3, decision 4)? Every case of `pass1.cases.ts` with one mark
 * that takes text runs through all three: the review reads every stroke; Select mark the strokes
 * as lassoed; the look-back the strokes in writing order with points only where it reads them
 * (caret-sized strokes, the two newest that may be a slash), as on the device. Same kind, same
 * anchors. The look-back takes no strike alone (a strike needs its loop to take text after it);
 * a strike with verticals takes text in none of them (§13.1 Q2).
 */

const TAKES_TEXT: MarkKind[] = ['strike', 'replaceLoop', 'slash', 'caret', 'sideways', 'step'];
const NONE = {strikes: [], carets: []};

/** The window as the look-back has it: rects for all, points only where it reads them. */
function asLookBack(strokes: MarkStroke[]): MarkStroke[] {
  const rectOnly = strokes.map(stroke => ({...stroke, points: null}));
  const wanted = lookBackPointsWanted(rectOnly, NONE);
  return strokes.map(stroke => (wanted.has(stroke.id) ? stroke : {...stroke, points: null}));
}

const judged = (reading: Reading | null | undefined) =>
  reading ? {kind: reading.kind, anchors: reading.anchors.map(anchor => [Math.round(anchor.x), Math.round(anchor.y)])} : null;

const cases = Object.entries(TABLES).flatMap(([family, items]) =>
  items
    .filter(item => item.expect !== 'none' && item.expect.length === 1 && item.expect[0].kinds.length > 0)
    .map(item => [`${family}: ${item.name}`, item] as const),
);

describe('the same judge for look-back, Select mark and review', () => {
  it.each(cases)('%s', (_name, item) => {
    const strokes = marks(...item.strokes);
    const review = readMarks(strokes)[0].readings[0];
    const declared = readDeclared(strokes);
    const lookBack = readLookBack(asLookBack(strokes), NONE);
    if (review.kind === 'strikeVerticals') {
      expect(declared).toMatchObject({readings: [], reason: VERTICALS_NO_TEXT_REASON});
      expect(lookBack).toBeNull();
      return;
    }
    if (!TAKES_TEXT.includes(review.kind)) {
      // Space, punctuation, close-up: review-only marks.
      expect(lookBack?.kind ?? null).not.toBe(review.kind);
      return;
    }
    expect(judged(declared.readings[0])).toEqual(judged(review));
    expect(judged(lookBack)).toEqual(review.kind === 'strike' ? null : judged(review));
  });

  it('agrees there is no mark in handwriting', () => {
    for (const item of TABLES.handwriting) {
      const strokes = marks(...item.strokes);
      expect(readMarks(strokes)).toEqual([]);
      expect(readLookBack(asLookBack(strokes), NONE)).toBeNull();
      expect(readDeclared(strokes).readings).toEqual([]);
    }
  });
});
