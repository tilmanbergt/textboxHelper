import {readDeclared, readMarks} from '../../src/domain/marks/pass1';
import {placeReading, resolvePage} from '../../src/domain/marks/pass2';
import type {Reading} from '../../src/domain/marks/reading';
import type {TextboxView} from '../../src/domain/marks/textboxView';
import {
  arc,
  at,
  caret,
  circle,
  cross,
  fixture,
  marks,
  page,
  sideways,
  slash,
  strike,
  swap,
  textbox,
  verticals,
  view,
  type Drawn,
} from './build';

/**
 * Pass 2 (technical-design-mark-dialogue.md §3): with which textboxes does a reading land where?
 * One table per need - a point, a part, two parts. A case draws its mark (read by pass 1; `select`:
 * as Select mark reads it) over textboxes laid out with 18 px per character and expects its place
 * ([textbox, start, end], the insert mode, a remark) or why it stays open.
 */

// "the big red car and more words here": character i starts at x 115 + 18·i; line 200–248.
const A = textbox('the big red car and more words here', {left: 100, top: 200, width: 1000});
const x = (offset: number, box = A) => at(box, offset).x;
const MID = at(A, 0).mid;
const SP = textbox('the bigred car and more words here', {left: 100, top: 200, width: 1000});
const DEFAULT = textbox('the default, red car', {left: 100, top: 200, width: 1000});
const BIGGER = textbox('a bigger word', {left: 100, top: 200, width: 1000});
const NOTE = textbox('a note book here', {left: 100, top: 200, width: 1000});
// Four lines of 20 characters.
const W = textbox('one two three four five six seven eight nine ten eleven twelve thirteen', {left: 100, top: 200, width: 400});

type Expect = {at: [string, number, number]; mode?: string; uncertain?: string} | {open: string; onText?: boolean};
type Case = {name: string; strokes: Drawn[]; boxes: TextboxView[]; select?: boolean; expect: Expect};

const TABLES: Record<string, Case[]> = {
  point: [
    {name: 'a ∧ in a word gap', strokes: [caret('up', {x: x(7) + 9, y: 246})], boxes: [view(A)], expect: {at: ['tb1', 7, 7], mode: 'betweenWords'}},
    {name: 'a V inside a word', strokes: [caret('down', {x: x(22), y: 206})], boxes: [view(A)], expect: {at: ['tb1', 22, 22], mode: 'inWord'}},
    {
      name: "a V just inside a word's edge goes to the edge, worth a look",
      strokes: [caret('down', {x: x(20) + 8, y: 206})],
      boxes: [view(A)],
      expect: {at: ['tb1', 20, 20], mode: 'betweenWords', uncertain: 'inside a word'},
    },
    {name: 'a ∧ at the line end', strokes: [caret('up', {x: x(35) + 30, y: 246})], boxes: [view(A)], expect: {at: ['tb1', 35, 35], mode: 'betweenWords'}},
    {name: 'a caret far from text', strokes: [caret('up', {x: 300, y: 900})], boxes: [view(A)], expect: {open: "doesn't point", onText: false}},
    {name: 'a space mark inside a word', strokes: [caret('up', {x: x(7, SP), y: 246}), cross(x(7, SP), 300)], boxes: [view(SP)], expect: {at: ['tb1', 7, 7], mode: 'inWord'}},
    {name: 'a space mark where there is a space', strokes: [caret('up', {x: x(7) + 9, y: 246}), cross(x(7) + 9, 300)], boxes: [view(A)], expect: {open: 'already a space'}},
    {
      name: 'a punctuation circle after a word',
      strokes: [caret('up', {x: x(15) + 2, y: 246}, 44), circle(x(15) + 2, 274, 9, ',')],
      boxes: [view(A)],
      expect: {at: ['tb1', 15, 15], mode: 'betweenWords'},
    },
    {name: 'a < between two lines splits there', strokes: [sideways('left', {x: W.rect.right + 6, y: W.lines[1].top})], boxes: [view(W)], expect: {at: ['tb1', W.lines[1].start, W.lines[1].start], mode: 'split'}},
    {name: 'a > before the first line is already a break', strokes: [sideways('right', {x: W.rect.left - 6, y: W.lines[0].top - 2})], boxes: [view(W)], expect: {open: 'already a paragraph break'}},
    {name: 'on a font that can\'t be read', strokes: [caret('up', {x: x(7) + 9, y: 246})], boxes: [view(A, {locked: true})], expect: {open: "can't be read"}},
  ],
  part: [
    {name: 'a strike over a word', strokes: [strike(x(4) + 3, x(7) - 3, MID)], boxes: [view(A)], expect: {at: ['tb1', 4, 7]}},
    {name: 'a strike over two words', strokes: [strike(x(20) + 3, x(30) - 3, MID)], boxes: [view(A)], expect: {at: ['tb1', 20, 30]}},
    {
      name: 'a strike that stops before the comma keeps it',
      strokes: [strike(x(4, DEFAULT) + 3, x(11, DEFAULT) - 3, MID)],
      boxes: [view(DEFAULT)],
      expect: {at: ['tb1', 4, 11]},
    },
    {
      name: 'verticals at the ends of a strike inside a word: exactly between them',
      strokes: [strike(x(4, BIGGER) - 2, x(6, BIGGER) + 2, MID), verticals(x(4, BIGGER) + 1, x(6, BIGGER) - 1, MID)],
      boxes: [view(BIGGER)],
      expect: {at: ['tb1', 4, 6]},
    },
    {name: 'a slash on a letter', strokes: [slash(x(4) + 9, MID, 60, 40)], boxes: [view(A)], expect: {at: ['tb1', 4, 5]}},
    {name: 'a slanted slash: check the letter', strokes: [slash(x(26) + 9, MID, 35, 46)], boxes: [view(A)], expect: {at: ['tb1', 26, 27], uncertain: 'slanted'}},
    {name: 'a slash on a space', strokes: [slash(x(19) + 9, MID, 60, 40)], boxes: [view(A)], expect: {open: 'marks one letter'}},
    {
      name: 'a strike over two lines',
      strokes: [strike(x(0, W) + 3, x(13, W), at(W, 0).mid).map(points => points.map(point => ({x: point.x, y: point.y + ((point.x - x(0, W)) / 240) * 48})))],
      boxes: [view(W)],
      expect: {open: 'multiple rendered lines'},
    },
    {name: 'a strike on a font that can\'t be read', strokes: [strike(x(4) + 3, x(7) - 3, MID)], boxes: [view(A, {locked: true})], expect: {open: "can't be read"}},
    {name: 'a strike away from the text', strokes: [strike(200, 420, 600)], boxes: [view(A)], expect: {open: 'exactly one', onText: false}},
    {name: 'a strike chosen with Select mark', strokes: [strike(x(12) + 2, x(15) - 2, MID)], boxes: [view(A)], select: true, expect: {at: ['tb1', 12, 15]}},
    {name: 'a close-up arc under a gap', strokes: [arc(x(4, NOTE) - 4, x(7, NOTE) + 4, at(NOTE, 0).base + 8, 'down')], boxes: [view(NOTE)], expect: {at: ['tb1', 6, 7]}},
  ],
};

function readingOf(item: Case): Reading {
  const strokes = marks(...item.strokes);
  return item.select ? readDeclared(strokes).readings[0] : readMarks(strokes)[0].readings[0];
}

describe.each(Object.entries(TABLES))('pass 2 places: %s', (_need, cases) => {
  it.each(cases.map(item => [item.name, item] as const))('%s', (_name, item) => {
    const place = placeReading(readingOf(item), item.boxes);
    if ('open' in item.expect) {
      expect(place.ok).toBe(false);
      expect(place.ok ? '' : place.reason).toContain(item.expect.open);
      if (item.expect.onText !== undefined && !place.ok) {
        expect(place.onText).toBe(item.expect.onText);
      }
      return;
    }
    expect(place.ok).toBe(true);
    if (place.ok) {
      expect([place.uuid, place.start, place.end]).toEqual(item.expect.at);
      if (item.expect.mode) {
        expect(place.mode).toBe(item.expect.mode);
      }
      expect(place.uncertain ?? '').toContain(item.expect.uncertain ?? '');
      if (!item.expect.uncertain) {
        expect(place.uncertain).toBeUndefined();
      }
    }
  });
});

describe('pass 2 places: two parts (a swap, page-wide)', () => {
  it('a one-line swap mark: "big" and "red"', () => {
    const result = resolvePage(page(swap([x(4) - 3, x(7) + 2], [x(8) - 2, x(11) + 3], at(A, 4))), [view(A)]);
    expect(result.marks).toEqual([expect.objectContaining({kind: 'swap', zones: {a0: 4, a1: 7, b0: 8, b1: 11}, lineIndex: 0})]);
  });

  it('three swaps across line wraps and two textboxes (the device page of 2026-11-20)', () => {
    const device = fixture('swap-page-2026-11-20');
    const strokes = Object.entries(device.strokes).map(([num, points]) => ({
      id: `s${num}`,
      numInPage: Number(num),
      stroke: {id: `s${num}`, numInPage: Number(num), rect: rectOfPoints(points), points, straightLine: false},
    }));
    const views = device.boxes.map(box => ({uuid: box.uuid, numInPage: box.numInPage, rect: box.rect, text: box.text, measured: true, layout: box, fontReadable: true}));
    const swaps = resolvePage(strokes, views).marks.filter(mark => mark.kind === 'swap');
    expect(swaps.map(mark => (mark.kind === 'swap' ? [mark.view.numInPage, mark.strokes.map(ref => ref.numInPage)] : null))).toEqual([
      [4, [34]],
      [4, [35, 36]],
      [3, [26, 31, 33]],
    ]);
  });
});

function rectOfPoints(points: Array<{x: number; y: number}>) {
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  return {left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys)};
}
