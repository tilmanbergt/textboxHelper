import type {OutlineBlock} from '../../src/domain/outlineModel';
import {layoutAside, layoutRebuild, type LayoutBlock} from '../../src/domain/outlineLayout';
import {
  blockedBy,
  canMove,
  canMoveBefore,
  canRemove,
  plannedOrder,
  plannedSummary,
  sectionOf,
  undoFor,
  undoLast,
} from '../../src/domain/outlinePlan';

/** A block: heading level 1 with `heading`, a file's divider with `fileSource`. */
const block = (key: string, page: number, heading: boolean | number = false, fileSource: string | null = null): OutlineBlock => {
  const level = fileSource ? 0 : heading === true ? 1 : heading || null;
  return {
    key,
    tagId: null,
    page,
    numInPage: 0,
    text: level ? `${'#'.repeat(level)} ${key}` : key,
    firstLine: key,
    lastLine: '',
    kind: fileSource ? 'file' : level ? 'heading' : 'paragraph',
    level: fileSource ? 0 : level,
    fileSource,
    aside: false,
    status: 'open',
    pendingEdits: 0,
    rect: {left: 100, top: 0, right: 900, bottom: 100},
  };
};

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

  it('knows a heading\'s section but never moves a heading', () => {
    expect(sectionOf(blocks, 'H2')).toEqual(['H2', 'c', 'd']);
    expect(sectionOf(blocks, 'a')).toEqual(['a']);
    expect(canMove(blocks[0])).toBe(false);
    expect(canMove(blocks[1])).toBe(true);
    expect(keys(plannedOrder(blocks, [{kind: 'move', key: 'H2', before: 'H1'}]).order)).toEqual(keys(blocks));
  });

  it('ends a section at the next heading of the same or a higher level', () => {
    const levels = [block('A', 0, 1), block('A1', 0, 2), block('x', 0), block('A2', 0, 3), block('y', 0), block('B', 1, 1)];
    expect(sectionOf(levels, 'A')).toEqual(['A', 'A1', 'x', 'A2', 'y']);
    expect(sectionOf(levels, 'A1')).toEqual(['A1', 'x', 'A2', 'y']);
    expect(sectionOf(levels, 'A2')).toEqual(['A2', 'y']);
  });

  it('changes a heading\'s level alone or with its subheadings', () => {
    const levels = [block('A', 0, 1), block('x', 0), block('B', 0, 1), block('B1', 0, 2), block('B2', 0, 3), block('C', 1, 1)];
    const alone = plannedOrder(levels, [{kind: 'level', key: 'B', level: 2, withSubheadings: false}]);
    expect(alone.order.map(item => [item.key, item.level])).toEqual([
      ['A', 1],
      ['x', null],
      ['B', 2],
      ['B1', 2],
      ['B2', 3],
      ['C', 1],
    ]);
    expect(alone.order[2].text).toBe('## B');
    expect([...alone.levels]).toEqual([['B', {from: 1, to: 2}]]);
    const along = plannedOrder(levels, [{kind: 'level', key: 'B', level: 2, withSubheadings: true}]);
    expect(along.order.map(item => item.level)).toEqual([1, null, 2, 3, 3, 1]);
    expect([...along.marks.keys()]).toEqual(['B', 'B1']);
    // A heading turned into a paragraph lifts its subheadings with it.
    const removed = plannedOrder(levels, [{kind: 'level', key: 'B', level: 0, withSubheadings: true}]);
    expect(removed.order.map(item => [item.kind, item.level])).toEqual([
      ['heading', 1],
      ['paragraph', null],
      ['paragraph', null],
      ['heading', 1],
      ['heading', 2],
      ['heading', 1],
    ]);
    expect(removed.order[2].text).toBe('B');
    // A paragraph becomes a heading; a file's divider keeps its level.
    const made = plannedOrder(levels, [
      {kind: 'level', key: 'x', level: 3, withSubheadings: true},
      {kind: 'level', key: 'A', level: 2, withSubheadings: false},
    ]);
    expect(made.order[1]).toMatchObject({kind: 'heading', level: 3, text: '### x'});
    const files = [block('F', 0, false, 's'), block('p', 0)];
    expect(plannedOrder(files, [{kind: 'level', key: 'F', level: 1, withSubheadings: false}]).levels.size).toBe(0);
    expect(
      plannedSummary(levels, [{kind: 'level', key: 'B', level: 2, withSubheadings: true}], along),
    ).toBe('1 heading level (with 1 subheading)');
  });

  it('sets aside or deletes a heading with its whole section', () => {
    const result = plannedOrder(blocks, [{kind: 'aside', key: 'H2'}]);
    expect(keys(result.order)).toEqual(['H1', 'a', 'b']);
    expect(keys(result.aside)).toEqual(['H2', 'c', 'd']);
    expect(plannedSummary(blocks, [{kind: 'aside', key: 'H2'}, {kind: 'delete', key: 'a'}], plannedOrder(blocks, [{kind: 'aside', key: 'H2'}, {kind: 'delete', key: 'a'}]))).toBe(
      '1 section set aside · 1 paragraph deleted',
    );
  });

  it('counts the edits that block a change', () => {
    expect(blockedBy([{...blocks[1], pendingEdits: 2}, {...blocks[2], pendingEdits: null}])).toBe(2);
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
    expect(plannedSummary(blocks, plan, plannedOrder(blocks, plan))).toBe('1 paragraph moved · 1 paragraph set aside');
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

  it('lays a page out again from a heading that grew', () => {
    // a grows by 400: b no longer fits on page 0 and goes on to page 1.
    const layout = layoutRebuild(original, ['a', 'b', 'c', 'd', 'e', 'f'], frame, 3, new Map([['a', 700]]));
    expect(layout?.placements.get('a')).toEqual({page: 0, rect: {left: 100, top: 100, right: 900, bottom: 800}});
    expect(layout?.placements.get('b')?.page).toBe(1);
    expect(layout?.pages[0]).toBe(0);
    expect(layoutRebuild(original, ['a', 'b', 'c', 'd', 'e', 'f'], frame, 3, new Map())).toBeNull();
  });

  it('starts a new page before a block that breaks', () => {
    // e moves before b and starts a page (a file's divider): b, c, d follow it on the next page.
    const breaking = original.map(item => (item.key === 'e' ? {...item, startsPage: true} : item));
    const layout = layoutRebuild(breaking, ['a', 'e', 'b', 'c', 'd', 'f'], frame, 3);
    expect(layout?.placements.get('a')?.page).toBe(0);
    expect(layout?.placements.get('e')).toEqual({page: 1, rect: {left: 100, top: 100, right: 900, bottom: 400}});
    expect(layout?.placements.get('b')?.page).toBe(1);
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
