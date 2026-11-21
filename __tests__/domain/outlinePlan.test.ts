import type {OutlineBlock} from '../../src/domain/outlineModel';
import {layoutAside, layoutRebuild, type LayoutBlock} from '../../src/domain/outlineLayout';
import {canMoveBefore, canRemove, plannedOrder, plannedSummary, sectionOf, undoFor, undoLast} from '../../src/domain/outlinePlan';

const block = (key: string, page: number, heading = false, fileSource: string | null = null): OutlineBlock => ({
  key,
  tagId: null,
  page,
  numInPage: 0,
  text: key,
  firstLine: key,
  lastLine: '',
  heading,
  fileSource,
  status: 'open',
  pendingEdits: 0,
  rect: {left: 100, top: 0, right: 900, bottom: 100},
});

const blocks = [block('H1', 0, true), block('a', 0), block('b', 0), block('H2', 1, true), block('c', 1), block('d', 2)];
const keys = (list: OutlineBlock[]) => list.map(item => item.key);

describe('outline plan', () => {
  it('moves a linked file with its whole section, headings included', () => {
    const files = [
      block('A', 0, true, 's-a'),
      block('A1', 0, true),
      block('a', 0),
      block('B', 1, true, 's-b'),
      block('b', 1),
      block('B1', 2, true),
      block('b1', 2),
    ];
    expect(sectionOf(files, 'A')).toEqual(['A', 'A1', 'a']);
    // A heading's section ends at the next file.
    expect(sectionOf(files, 'A1')).toEqual(['A1', 'a']);
    expect(sectionOf(files, 'B')).toEqual(['B', 'b', 'B1', 'b1']);
    expect(keys(plannedOrder(files, [{kind: 'move', key: 'B', before: 'A'}]).order)).toEqual([
      'B',
      'b',
      'B1',
      'b1',
      'A',
      'A1',
      'a',
    ]);
    // A file's divider can't be set aside or deleted on its own.
    expect(canRemove(files[0])).toBe(false);
    expect(keys(plannedOrder(files, [{kind: 'delete', key: 'A'}]).order)).toEqual(keys(files));
  });

  it('moves a heading with its section', () => {
    expect(sectionOf(blocks, 'H2')).toEqual(['H2', 'c', 'd']);
    expect(sectionOf(blocks, 'a')).toEqual(['a']);
    expect(keys(plannedOrder(blocks, [{kind: 'move', key: 'H2', before: 'H1'}]).order)).toEqual(['H2', 'c', 'd', 'H1', 'a', 'b']);
  });

  it('moves, sets aside and deletes in order, and marks them', () => {
    const result = plannedOrder(blocks, [
      {kind: 'move', key: 'd', before: 'a'},
      {kind: 'aside', key: 'b'},
      {kind: 'delete', key: 'c'},
    ]);
    expect(keys(result.order)).toEqual(['H1', 'd', 'a', 'H2']);
    expect(keys(result.aside)).toEqual(['b']);
    expect(keys(result.deleted)).toEqual(['c']);
    expect([...result.marks]).toEqual([['d', 'moved'], ['b', 'aside'], ['c', 'delete']]);
  });

  it('ignores a move into its own section and offers no target that changes nothing', () => {
    expect(keys(plannedOrder(blocks, [{kind: 'move', key: 'H2', before: 'c'}]).order)).toEqual(keys(blocks));
    expect(canMoveBefore(blocks, 'a', 'b')).toBe(false);
    expect(canMoveBefore(blocks, 'a', 'a')).toBe(false);
    expect(canMoveBefore(blocks, 'a', 'H1')).toBe(true);
    expect(canMoveBefore(blocks, 'd', 'end')).toBe(false);
    expect(canMoveBefore(blocks, 'a', 'end')).toBe(true);
  });

  it('undoes one block or the last change, and sums up', () => {
    const plan = [
      {kind: 'move' as const, key: 'd', before: 'a'},
      {kind: 'aside' as const, key: 'b'},
    ];
    expect(undoFor(plan, 'd')).toEqual([plan[1]]);
    expect(undoLast(plan)).toEqual([plan[0]]);
    expect(plannedSummary(blocks, plan)).toBe('1 move (p.3) · 1 set aside (p.1)');
  });
});

describe('rebuild layout', () => {
  const frame = {top: 100, bottom: 1000};
  // Three pages, two blocks of 300 each, gap 50.
  const original: LayoutBlock[] = [
    {key: 'a', page: 0, rect: {left: 100, top: 100, right: 900, bottom: 400}},
    {key: 'b', page: 0, rect: {left: 100, top: 450, right: 900, bottom: 750}},
    {key: 'c', page: 1, rect: {left: 100, top: 100, right: 900, bottom: 400}},
    {key: 'd', page: 1, rect: {left: 100, top: 450, right: 900, bottom: 750}},
    {key: 'e', page: 2, rect: {left: 100, top: 100, right: 900, bottom: 400}},
    {key: 'f', page: 2, rect: {left: 100, top: 450, right: 900, bottom: 750}},
  ];

  it('changes nothing for the same order', () => {
    expect(layoutRebuild(original, ['a', 'b', 'c', 'd', 'e', 'f'], frame, 3)).toBeNull();
  });

  it('swaps two blocks on one page and stops there', () => {
    const layout = layoutRebuild(original, ['b', 'a', 'c', 'd', 'e', 'f'], frame, 3);
    expect(layout?.pages).toEqual([0]);
    expect(layout?.placements.get('b')).toEqual({page: 0, rect: {left: 100, top: 100, right: 900, bottom: 400}});
    expect(layout?.placements.get('a')).toEqual({page: 0, rect: {left: 100, top: 450, right: 900, bottom: 750}});
    expect(layout?.newPages).toBe(0);
  });

  it('carries the overflow on until the pages are as before', () => {
    // e moves to page 0: b goes to page 1, c and d follow, page 2 keeps f only.
    const layout = layoutRebuild(original, ['a', 'e', 'b', 'c', 'd', 'f'], frame, 3);
    expect(layout?.pages).toEqual([0, 1, 2]);
    expect(layout?.placements.get('e')?.page).toBe(0);
    expect(layout?.placements.get('b')?.page).toBe(1);
    expect(layout?.placements.get('d')?.page).toBe(2);
    expect(layout?.placements.get('f')?.page).toBe(2);
  });

  it('closes the gap of a deleted block on its page only', () => {
    const layout = layoutRebuild(original, ['b', 'c', 'd', 'e', 'f'], frame, 3);
    expect(layout?.pages).toEqual([0]);
    expect(layout?.placements.get('b')).toEqual({page: 0, rect: {left: 100, top: 100, right: 900, bottom: 400}});
  });

  it('adds pages at the end when the last page overflows', () => {
    const layout = layoutRebuild(original, ['a', 'b', 'c', 'd', 'f', 'e'], frame, 3);
    expect(layout?.pages).toEqual([2]);
    const tall: LayoutBlock[] = [...original.slice(0, 5), {key: 'f', page: 2, rect: {left: 100, top: 400, right: 900, bottom: 1000}}];
    const more = layoutRebuild(tall, ['a', 'b', 'c', 'd', 'f', 'e'], frame, 3);
    expect(more?.newPages).toBe(1);
    expect(more?.placements.get('e')?.page).toBe(3);
  });

  it('stacks set-aside blocks on new pages', () => {
    const aside = layoutAside([original[0], original[1], original[2]], frame, 2);
    expect([...aside.values()].map(place => [place.page, place.rect.top])).toEqual([
      [3, 100],
      [3, 424],
      [4, 100],
    ]);
  });
});
