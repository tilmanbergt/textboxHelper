import {MARK_GONE, placeLinked, type LinkedPlace} from '../../src/domain/marks/linked';
import type {MarkStroke} from '../../src/domain/marks/markStroke';
import type {StrokeOwner, StrokeRef} from '../../src/domain/marks/pass2';
import {readingOfStoredMark} from '../../src/domain/marks/storedMark';
import type {PenEditMark} from '../../src/domain/penEditModel';
import {at, loop, marks, slash, strike, textbox, verticals, view, type Drawn} from './build';

/**
 * Linked marks in pass 2 (technical-design-mark-dialogue.md §5.1, §13.1 Q2): a text's stored mark,
 * read again on its strokes as they are on the page now (`readingOfStoredMark`), placed with pass
 * 2 (`placeLinked`). A number on the page is never dropped: placed, or open with why and a guess.
 * One table per need. A case draws the mark's strokes, gives the stored mark (rects as drawn, or
 * moved), and expects the change ([start, end), kind) or the open place (reason, guess).
 */

// "the big red car and more words here": character i starts at x 115 + 18·i; line 200–248.
const A = textbox('the big red car and more words here', {left: 100, top: 200, width: 1000});
const x = (offset: number) => at(A, offset).x;
const MID = at(A, 0).mid;
const W = textbox('one two three four five six seven eight nine ten eleven twelve thirteen', {left: 100, top: 200, width: 400});
const OWNER: StrokeOwner = {id: 'pe-1', number: 1, mark: null};

type Expect = {placed: string} | {open: string; guess?: [number, number] | null};
type Case = {
  name: string;
  strokes: Drawn[];
  /** The stored mark from the drawn strokes' rects; `shift` moves them as if the strokes had moved. */
  mark: (rects: MarkStroke['rect'][]) => PenEditMark;
  boxes?: Parameters<typeof placeLinked>[3];
  confirmed?: boolean;
  gone?: boolean;
  expect: Expect;
};

const replace = (extra: Partial<Extract<PenEditMark, {kind: 'replace'}>> = {}) => (rects: MarkStroke['rect'][]): PenEditMark => ({
  kind: 'replace',
  strikeRect: rects[0],
  modifierRects: rects.slice(1),
  ...extra,
});
const moved = (rects: MarkStroke['rect'][], dx: number) => rects.map(rect => ({...rect, left: rect.left - dx, right: rect.right - dx}));

function describePlace(place: LinkedPlace): string {
  if (place.kind === 'open') {
    return 'open';
  }
  const mark = place.mark;
  return mark.kind === 'line'
    ? `replace [${mark.span.start}, ${mark.span.end})${mark.span.exact ? ' exact' : ''} strokes ${mark.consumed.join('+')}`
    : mark.kind === 'slash'
    ? `replace letter ${mark.offset} strokes ${mark.strokes.map(ref => ref.numInPage).join('+')}`
    : mark.kind;
}

const TABLES: Record<string, Case[]> = {
  part: [
    {
      name: 'a strike with a loop replaces the words it covers',
      strokes: [strike(x(12) + 2, x(15) - 2, MID), loop(x(15) + 20, MID)],
      mark: replace(),
      expect: {placed: 'replace [12, 15) strokes 1+2'},
    },
    {
      name: 'a strike chosen alone with Select mark replaces the words',
      strokes: [strike(x(12) + 2, x(15) - 2, MID)],
      mark: replace(),
      expect: {placed: 'replace [12, 15) strokes 1'},
    },
    {
      name: 'a strike with two verticals stored by an earlier build replaces exactly between them',
      strokes: [strike(x(4) - 4, x(7) + 4, MID), verticals(x(4) + 2, x(7) - 2, MID)],
      mark: replace({bounds: 'exact'}),
      expect: {placed: 'replace [4, 7) exact strokes 1+2+3'},
    },
    {
      name: 'a slash with its own circle for the number replaces its letter',
      strokes: [slash(x(8) + 9, MID, 65, 40), loop(x(8) + 20, MID - 40, 12)],
      mark: rects => ({kind: 'replace', strikeRect: rects[0], modifierRects: [], slash: true, bounds: 'exact', numberRect: rects[1]}),
      expect: {placed: 'replace letter 8 strokes 1+2'},
    },
    {
      name: 'a mark moved since it was tagged is found by its strokes as they are now',
      strokes: [strike(x(12) + 2, x(15) - 2, MID), loop(x(15) + 20, MID)],
      mark: rects => replace()(moved(rects, 300)),
      expect: {placed: 'replace [12, 15) strokes 1+2'},
    },
    {
      name: 'its strokes are gone: open, no guess',
      strokes: [strike(x(12) + 2, x(15) - 2, MID)],
      mark: replace(),
      gone: true,
      expect: {open: MARK_GONE, guess: null},
    },
    {
      name: 'a strike over two lines: open, the words it reaches on the line nearest its middle as the guess',
      strokes: [strike(at(W, 0).x + 3, at(W, 13).x, at(W, 0).mid).map(points => points.map(point => ({x: point.x, y: point.y + ((point.x - at(W, 0).x) / 240) * 48})))],
      mark: replace(),
      boxes: [view(W)],
      expect: {open: 'multiple rendered lines', guess: [19, 33]},
    },
    {
      name: 'the same strike with Here takes the guess',
      strokes: [strike(at(W, 0).x + 3, at(W, 13).x, at(W, 0).mid).map(points => points.map(point => ({x: point.x, y: point.y + ((point.x - at(W, 0).x) / 240) * 48})))],
      mark: replace(),
      boxes: [view(W)],
      confirmed: true,
      expect: {placed: 'replace [19, 33) strokes 1'},
    },
    {
      name: "on a font that can't be read: open, no guess",
      strokes: [strike(x(4) + 3, x(7) - 3, MID), loop(x(7) + 20, MID)],
      mark: replace(),
      boxes: [view(A, {locked: true})],
      expect: {open: "can't be read", guess: null},
    },
    {
      name: 'a slash through a space: open, the nearest letter (the d of "and") as the guess',
      strokes: [slash(x(19) + 9, MID, 60, 40)],
      mark: rects => ({kind: 'replace', strikeRect: rects[0], modifierRects: [], slash: true, bounds: 'exact'}),
      expect: {open: 'marks one letter', guess: [18, 19]},
    },
  ],
};

describe.each(Object.entries(TABLES))('linked marks placed: %s', (_need, cases) => {
  it.each(cases.map(item => [item.name, item] as const))('%s', (_name, item) => {
    const strokes = marks(...item.strokes);
    const reading = readingOfStoredMark(item.mark(strokes.map(stroke => stroke.rect)), item.gone ? [] : strokes);
    const refs = new Map<string, StrokeRef>(strokes.map(stroke => [stroke.id, {id: stroke.id, numInPage: stroke.numInPage}]));
    const place = placeLinked(reading, OWNER, refs, item.boxes ?? [view(A)], {confirmed: item.confirmed});
    if ('placed' in item.expect) {
      expect(describePlace(place)).toBe(item.expect.placed);
      expect(place.kind === 'placed' && 'owner' in place.mark ? place.mark.owner : null).toEqual(OWNER);
      return;
    }
    expect(place.kind).toBe('open');
    if (place.kind === 'open') {
      expect(place.reason).toContain(item.expect.open);
      if (item.expect.guess !== undefined) {
        expect(place.guess ? [place.guess.start, place.guess.end] : null).toEqual(item.expect.guess);
      }
    }
  });
});
