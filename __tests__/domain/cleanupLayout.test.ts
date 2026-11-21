import {
  blocksInScope,
  cleanupRange,
  fileStartsPage,
  fitText,
  groupText,
  layoutCleanup,
  pieceGroups,
} from '../../src/domain/cleanupLayout';
import type {OutlineBlock} from '../../src/domain/outlineModel';
import {CLEANUP_KEY, plannedOrder, plannedSummary, type PlannedChange} from '../../src/domain/outlinePlan';

const block = (key: string, page: number, extra: Partial<OutlineBlock> = {}): OutlineBlock => ({
  key,
  tagId: null,
  page,
  numInPage: 0,
  rect: {left: 100, top: 100, right: 900, bottom: 200},
  text: key,
  firstLine: key,
  lastLine: '',
  kind: 'paragraph',
  level: null,
  fileSource: null,
  aside: false,
  sourceBlock: null,
  piece: 0,
  placeholder: false,
  status: 'open',
  pendingEdits: 0,
  ...extra,
});
const file = (key: string, page: number) => block(key, page, {kind: 'file', level: 0, fileSource: `s-${key}`});

describe('clean up scope', () => {
  const blocks = [file('A', 0), block('a1', 0), block('a2', 1), file('B', 3), block('b1', 3), block('x', 5, {aside: true})];

  it('takes the whole note without set-aside blocks, or one file', () => {
    expect(blocksInScope(blocks, {kind: 'note'}).map(item => item.key)).toEqual(['A', 'a1', 'a2', 'B', 'b1']);
    expect(blocksInScope(blocks, {kind: 'file', sourceId: 's-A'}).map(item => item.key)).toEqual(['A', 'a1', 'a2']);
    expect(blocksInScope(blocks, {kind: 'file', sourceId: 's-B'}).map(item => item.key)).toEqual(['B', 'b1']);
  });

  it('covers a file up to the page before the next file', () => {
    const scoped = blocksInScope(blocks, {kind: 'file', sourceId: 's-A'});
    expect(cleanupRange(scoped, blocks, {kind: 'file', sourceId: 's-A'})).toEqual({first: 0, last: 2});
    expect(cleanupRange(blocksInScope(blocks, {kind: 'note'}), blocks, {kind: 'note'})).toEqual({first: 0, last: 3});
  });

  it('offers a file on its own only when it starts its page', () => {
    expect(fileStartsPage(blocks, 's-B')).toBe(true);
    expect(fileStartsPage([file('A', 0), block('a1', 0), file('B', 0)], 's-B')).toBe(false);
  });
});

describe('pieces', () => {
  it('groups the pieces cut from one block and joins them with a space', () => {
    const blocks = [
      block('p0', 0, {sourceBlock: 's:4'}),
      block('p1', 1, {sourceBlock: 's:4', piece: 1, text: 'more'}),
      block('q', 1, {sourceBlock: 's:5'}),
      block('r', 1, {sourceBlock: 's:5', piece: 0}),
    ];
    const groups = pieceGroups(blocks);
    expect(groups.map(group => group.map(item => item.key))).toEqual([['p0', 'p1'], ['q'], ['r']]);
    expect(groupText(groups[0])).toBe('p0 more');
  });

  it('cuts a text taller than the area into pieces that fit', async () => {
    const measure = async (text: string) => text.length * 10;
    const area = {left: 0, top: 0, right: 500, bottom: 300};
    expect(await fitText({text: 'short one', area, fontSize: 36, measureHeight: measure})).toEqual([{text: 'short one', height: 90}]);
    const pieces = await fitText({text: 'One sentence. Two sentence. Three here.', area, fontSize: 36, measureHeight: measure});
    expect(pieces.map(piece => piece.text)).toEqual(['One sentence. Two sentence.', 'Three here.']);
    expect(pieces.every(piece => piece.height <= 300)).toBe(true);
  });
});

describe('clean up layout', () => {
  const area = {left: 100, top: 100, right: 1100, bottom: 1000};

  it('stacks full-width boxes with the gap and breaks pages', () => {
    const layout = layoutCleanup(
      [
        {id: 'a', height: 400, startsPage: true},
        {id: 'b', height: 400, startsPage: false},
        {id: 'c', height: 400, startsPage: false},
        {id: 'd', height: 100, startsPage: true},
      ],
      area,
      20,
      2,
    );
    expect(layout.placements.get('a')).toEqual({page: 2, rect: {left: 100, right: 1100, top: 100, bottom: 500}});
    expect(layout.placements.get('b')).toEqual({page: 2, rect: {left: 100, right: 1100, top: 520, bottom: 920}});
    expect(layout.placements.get('c')?.page).toBe(3);
    expect(layout.placements.get('d')).toEqual({page: 4, rect: {left: 100, right: 1100, top: 100, bottom: 200}});
    expect(layout.pageCount).toBe(3);
  });

  it('is planned as one change and named in the summary', () => {
    const blocks = [file('Essay', 0), block('a', 0)];
    const plan: PlannedChange[] = [{kind: 'cleanup', key: CLEANUP_KEY, scope: {kind: 'file', sourceId: 's-Essay'}}];
    const planned = plannedOrder(blocks, plan);
    expect(planned.cleanup).toEqual({kind: 'file', sourceId: 's-Essay'});
    expect(planned.order.map(item => item.key)).toEqual(['Essay', 'a']);
    expect(plannedSummary(blocks, plan, planned)).toBe('Clean up layout: Essay');
  });
});
