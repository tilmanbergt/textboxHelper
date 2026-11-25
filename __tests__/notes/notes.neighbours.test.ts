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
