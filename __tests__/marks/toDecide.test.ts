import type {RecognizedEditOperation} from '../../src/domain/markerTypes';
import {resolvePage} from '../../src/domain/marks/pass2';
import {
  isIgnored,
  leftOutItem,
  parseIgnoredMarks,
  ignoredOnPage,
  strokesById,
  unclearItems,
  withIgnored,
} from '../../src/domain/marks/toDecide';
import {at, caret, hand, loop, page, sideways, slash, step, strike, textbox, view, type Drawn} from './build';

/**
 * Building To decide (technical-design-mark-dialogue.md §5.2, §13.3 Q5–Q7): from a page's strokes
 * over a textbox, which items are listed - unclear marks on or over the text, never handwriting
 * beside it; strokes the strike family refused close together over one line as one item; one
 * problem, one item. A case draws strokes and expects the items: what they may be, their strokes,
 * the words under them, why.
 */

// "the big red car and more words here": character i starts at x 115 + 18·i; line 200–248.
const A = textbox('the big red car and more words here', {left: 100, top: 200, width: 1000});
const W = textbox('one two three four five six seven eight nine ten eleven twelve thirteen', {left: 100, top: 200, width: 400});
const x = (offset: number) => at(A, offset).x;
const MID = at(A, 0).mid;

type Case = {name: string; strokes: Drawn[]; box?: typeof A; items: Array<{summary: string; strokes: number[]; words?: string; reason?: string}>};

const CASES: Case[] = [
  {name: 'handwriting beside the text is not listed', strokes: [hand('note', 20, 100), hand('later', 300, 600)], items: []},
  {
    name: 'a handwritten word over the text is one item (§13.3 Q7)',
    strokes: [hand('ok', x(12), 214)],
    items: [{summary: 'Strokes over the text', strokes: [2, 3], words: 'car'}],
  },
  {
    name: 'two scribbles far apart on one line are two items',
    strokes: [strike(x(0) + 2, x(0) + 20, MID), strike(x(25) + 2, x(25) + 20, MID)],
    items: [
      {summary: 'Strokes over the text', strokes: [2], words: 'the', reason: 'too short'},
      {summary: 'Strokes over the text', strokes: [3], words: 'words', reason: 'too short'},
    ],
  },
  {
    name: 'a slash through a space: its reading is offered',
    strokes: [slash(x(19) + 9, MID, 60, 40)],
    items: [{summary: 'Slash', strokes: [2], reason: 'marks one letter'}],
  },
  {
    name: 'a loop without text is one item with its strike (one problem, one item)',
    strokes: [strike(x(12) + 2, x(15) - 2, MID), loop(x(15) + 20, MID)],
    items: [{summary: 'Strike with a loop', strokes: [2, 3], words: 'car and', reason: 'without new text'}],
  },
  {
    name: 'a > in the margin that points at no break is listed: it reads as a mark',
    box: W,
    strokes: [sideways('right', {x: W.rect.left - 6, y: W.lines[0].top - 2})],
    items: [{summary: 'Paragraph mark', strokes: [2], reason: 'already a paragraph break'}],
  },
  {
    name: 'a caret away from the text is handwriting',
    strokes: [caret('up', {x: 300, y: 900})],
    items: [],
  },
  {
    name: 'a bare step over the text is listed',
    box: W,
    strokes: [step(at(W, 65).x - 9, at(W, 65).mid)],
    items: [{summary: 'Strokes over the text', strokes: [2], reason: 'A swap middle piece (or a step)'}],
  },
];

describe('To decide from a page', () => {
  it.each(CASES.map(item => [item.name, item] as const))('%s', (_name, item) => {
    const box = item.box ?? A;
    const strokes = page(...item.strokes).map(stroke => ({...stroke, numInPage: stroke.numInPage + 1, stroke: stroke.stroke && {...stroke.stroke, numInPage: stroke.numInPage + 1}}));
    const views = [view(box)];
    const result = resolvePage(strokes, views);
    const items = unclearItems(result.refused, strokesById(strokes), views);
    expect(items.map(entry => ({summary: entry.summary, strokes: entry.strokeNums}))).toEqual(
      item.items.map(expected => ({summary: expected.summary, strokes: expected.strokes})),
    );
    item.items.forEach((expected, index) => {
      if (expected.words !== undefined) {
        expect(items[index].words).toBe(expected.words);
      }
      if (expected.reason) {
        expect(items[index].reason).toContain(expected.reason);
      }
      expect(items[index].kind).toBe('unclear');
      expect(items[index].ignore?.hash).toMatch(/^[0-9a-z]+$/);
    });
  });

  it('hides strokes a change took along', () => {
    const strokes = page(strike(x(0) + 2, x(0) + 20, MID));
    const views = [view(A)];
    expect(unclearItems(resolvePage(strokes, views).refused, strokesById(strokes), views, new Set([1]))).toEqual([]);
  });
});

describe('a change left out (§13.3 Q5)', () => {
  const operation = (penEditId?: string): RecognizedEditOperation => ({
    id: 'op',
    kind: 'closeUp',
    markerUuid: 's4',
    markerNumInPage: 4,
    consumedMarkerNums: [4],
    targetTextboxUuid: 'tb1',
    targetTextboxNumInPage: 1,
    lineIndex: 0,
    summary: 'Close up · red|car',
    detail: '',
    words: [],
    textStart: 11,
    ...(penEditId ? {penEditId, penEditNumber: 3} : {}),
  });
  const points = {4: [100, 240, 140, 250, 180, 240]};

  it('a linked one: place open at its place', () => {
    expect(leftOutItem(operation('pe-3'), 'Another change at its gap.', points)).toMatchObject({
      kind: 'placeOpen',
      penEditId: 'pe-3',
      number: 3,
      guess: {uuid: 'tb1', start: 11, end: 11},
      rect: {left: 100, top: 240, right: 180, bottom: 250},
    });
  });

  it('a plain one: unclear, its strokes removable', () => {
    expect(leftOutItem(operation(), 'Another change at its gap.', points)).toMatchObject({
      kind: 'unclear',
      reason: 'Another change at its gap.',
      removableNums: [4],
      strokes: [points[4]],
    });
  });
});

describe('Ignore remembers an item per note and page (§5.4)', () => {
  const key = {rect: {left: 100, top: 200, right: 160, bottom: 240}, hash: 'abc'};

  it('knows it again within 4 px, with the same strokes', () => {
    expect(isIgnored({rect: {left: 103, top: 197, right: 164, bottom: 236}, hash: 'abc'}, [key])).toBe(true);
    expect(isIgnored({rect: {left: 105, top: 200, right: 160, bottom: 240}, hash: 'abc'}, [key])).toBe(false);
    expect(isIgnored({...key, hash: 'abd'}, [key])).toBe(false);
  });

  it('stores per note and page, and reads what it wrote', () => {
    const file = withIgnored(withIgnored(parseIgnoredMarks(null), '/a.note', 2, key), '/b.note', 0, key);
    const read = parseIgnoredMarks(JSON.stringify(file));
    expect(ignoredOnPage(read, '/a.note', 2)).toEqual([key]);
    expect(ignoredOnPage(read, '/a.note', 1)).toEqual([]);
    expect(ignoredOnPage(read, '/b.note', 0)).toEqual([key]);
    expect(parseIgnoredMarks('not json')).toEqual({version: 1, notes: {}});
  });
});

describe('what To decide offers (§5.3)', () => {
  const {decideOptions, decideView} = require('../../src/domain/marks/decide') as typeof import('../../src/domain/marks/decide');
  const TEXT = 'the big red car and more words here';

  it('an unclear slash through a space offers the slash at its nearest letter, with why', () => {
    const strokes = page(slash(x(19) + 9, MID, 60, 40));
    const views = [view(A)];
    const [item] = unclearItems(resolvePage(strokes, views).refused, strokesById(strokes), views);
    const [option] = decideOptions(item.readings, views, new Map([['s1', 1]]));
    expect(option).toMatchObject({label: 'Slash', reason: expect.stringContaining('one letter'), at: {start: 18, end: 19}, text: TEXT});
    expect(option.draft?.range).toEqual({kind: 'delete', start: 18, end: 19});
  });

  it('shows a place with its edges moved, and the text as it will read', () => {
    const place = {uuid: 'tb1', numInPage: 1, lineIndex: 0, start: 4, end: 7};
    expect(decideView(TEXT, place, null, 'small')).toMatchObject({start: 4, end: 7, result: 'the small red car and more words …'});
    expect(decideView(TEXT, place, [0, 4], '').edges.map(edge => edge.label)).toEqual(['Start', 'End']);
    expect(decideView(TEXT, {...place, end: 4}, [1], 'X')).toMatchObject({start: 5, end: 5, edges: [{label: 'Place'}]});
  });
});
