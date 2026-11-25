import {stepParagraph} from '../../src/domain/notes/noteRows';
import {neighbours, type ParagraphCandidate} from '../../src/domain/notes/paragraphOf';
import {box} from './build';

/**
 * What do ‹ Paragraph above · Paragraph below › select (technical-design-comments-images.md §4)?
 * Reading order, across the page edge, never into the aside area or another file.
 */

const page0 = [box('h', 100, 160), box('p1', 200, 400), box('p2', 450, 700)];
const page1 = [box('q1', 100, 300, {page: 1}), box('q2', 350, 500, {page: 1})];
const twoColumns = [box('left', 200, 400, {left: 100}), box('right', 200, 400, {left: 800})];
const aside = [box('p1', 200, 400), box('a1', 800, 900, {region: 'aside'})];
const files = [box('a1', 200, 400, {file: 'A'}), box('b1', 450, 700, {file: 'B'}), box('b2', 750, 900, {file: 'B'})];

type Case = {name: string; textboxes: ParagraphCandidate[]; from: string; expect: [string | null, string | null]};

const CASES: Case[] = [
  {name: 'in the middle of a page', textboxes: page0, from: 'p1', expect: ['h', 'p2']},
  {name: 'a heading is a step like any paragraph', textboxes: page0, from: 'h', expect: [null, 'p1']},
  {name: 'down past the page edge: the first of the next page', textboxes: [...page0, ...page1], from: 'p2', expect: ['p1', 'q1']},
  {name: 'up past the page edge: the last of the previous page', textboxes: [...page1, ...page0], from: 'q1', expect: ['p2', 'q2']},
  {name: 'at the end of the note', textboxes: [...page0, ...page1], from: 'q2', expect: ['q1', null]},
  {name: 'side by side: left before right', textboxes: twoColumns, from: 'left', expect: [null, 'right']},
  {name: 'the aside area is left out', textboxes: aside, from: 'p1', expect: [null, null]},
  {name: 'another file is left out', textboxes: files, from: 'b1', expect: [null, 'b2']},
  {name: 'an unknown paragraph has none', textboxes: page0, from: 'gone', expect: [null, null]},
];

describe('notes.neighbours: ‹ Paragraph above · Paragraph below ›', () => {
  it.each(CASES.map(item => [item.name, item] as const))('%s', (_name, item) => {
    const {above, below} = neighbours(item.from, item.textboxes);
    expect([above?.uuid ?? null, below?.uuid ?? null]).toEqual(item.expect);
  });
});

describe('notes.neighbours: ‹ › from a note, reading the next page on demand', () => {
  const pages = (...known: number[]) =>
    new Map<number, ParagraphCandidate[]>([[0, page0], [1, page1]].filter(([page]) => known.includes(page as number)) as Array<[number, ParagraphCandidate[]]>);
  type Step = {name: string; from: {page: number; uuid: string | null}; dir: 'above' | 'below'; known: number[]; count: number; expect: string};
  const STEPS: Step[] = [
    {name: 'on the page', from: {page: 0, uuid: 'p1'}, dir: 'below', known: [0], count: 2, expect: 'p2'},
    {name: 'past the edge, page not read yet: read it', from: {page: 0, uuid: 'p2'}, dir: 'below', known: [0], count: 2, expect: 'load 1'},
    {name: 'past the edge, page read: its first paragraph', from: {page: 0, uuid: 'p2'}, dir: 'below', known: [0, 1], count: 2, expect: 'q1'},
    {name: 'up past the edge: the last paragraph of the page before', from: {page: 1, uuid: 'q1'}, dir: 'above', known: [0, 1], count: 2, expect: 'p2'},
    {name: 'no paragraph on its page: the page before\'s last', from: {page: 1, uuid: null}, dir: 'above', known: [0, 1], count: 2, expect: 'p2'},
    {name: 'at the start of the note', from: {page: 0, uuid: 'h'}, dir: 'above', known: [0], count: 2, expect: 'none'},
    {name: 'at the end of the note', from: {page: 1, uuid: 'q2'}, dir: 'below', known: [0, 1], count: 2, expect: 'none'},
  ];
  it.each(STEPS.map(item => [item.name, item] as const))('%s', (_name, item) => {
    const step = stepParagraph(item.from, item.dir, pages(...item.known), item.count);
    const said = 'target' in step ? step.target.uuid : 'load' in step ? `load ${step.load}` : 'none';
    expect(said).toBe(item.expect);
  });
});
