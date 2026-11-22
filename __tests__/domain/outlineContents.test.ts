import type {OutlineBlock} from '../../src/domain/outlineModel';
import {
  ASIDE,
  ORPHANS,
  START,
  buildContents,
  contentsRows,
  followingEntries,
  initialEntry,
  moveFileBefore,
  moveToEntry,
  ownRows,
  stepMoves,
} from '../../src/domain/outlineContents';
import {plannedOrder} from '../../src/domain/outlinePlan';

const block = (
  key: string,
  level: number | null = null,
  extra: Partial<OutlineBlock> = {},
): OutlineBlock => ({
  key,
  tagId: null,
  page: 0,
  numInPage: 0,
  text: level ? `${'#'.repeat(level)} ${key}` : key,
  firstLine: key,
  lastLine: '',
  kind: level ? 'heading' : 'paragraph',
  level,
  fileSource: null,
  aside: false,
  sourceBlock: null,
  piece: 0,
  placeholder: false,
  status: 'open',
  pendingEdits: 0,
  rect: {left: 0, top: 0, right: 100, bottom: 100},
  ...extra,
});
const file = (key: string) => block(key, null, {kind: 'file', level: 0, fileSource: `s-${key}`, text: key});
const map = (blocks: OutlineBlock[]) => new Map(blocks.map(item => [item.key, item]));

// A note without files: start text, # A with own text and a ## subsection, # B.
const plain = [
  block('s1'),
  block('A', 1),
  block('a1', null, {pendingEdits: 2}),
  block('a2'),
  block('A1', 2),
  block('a3', null, {status: 'final'}),
  block('B', 1),
  block('b1', null, {status: 'final'}),
];

describe('outline contents', () => {
  it('builds entries with their own paragraphs, children and sections', () => {
    const contents = buildContents(plain);
    expect(contents.entries.map(entry => [entry.key, entry.depth, entry.title])).toEqual([
      [START, 0, 'Start'],
      ['A', 0, 'A'],
      ['A1', 1, 'A1'],
      ['B', 0, 'B'],
    ]);
    const a = contents.byKey.get('A');
    expect(a?.own).toEqual(['a1', 'a2']);
    expect(a?.children).toEqual(['A1']);
    expect(a?.section).toEqual(['A', 'a1', 'a2', 'A1', 'a3']);
    expect([a?.pendingOwn, a?.pendingAll]).toEqual([2, 2]);
    expect(contents.ownerOf.get('a3')).toBe('A1');
    expect(contents.flat).toBe(false);
    expect(initialEntry(contents)).toBe('A');
    expect(followingEntries(contents, a!).map(next => [next.entry.key, next.paragraphs])).toEqual([['A1', 1]]);
  });

  it('puts files on top, text before the first file under "Not in a file", set-aside blocks last', () => {
    const contents = buildContents([
      block('loose'),
      file('F'),
      block('f1'),
      block('H', 1),
      block('h1'),
      file('G'),
      block('g1'),
      block('gone', null, {aside: true}),
    ]);
    expect(contents.entries.map(entry => [entry.key, entry.kind, entry.depth])).toEqual([
      [ORPHANS, 'orphans', 0],
      ['F', 'file', 0],
      ['H', 'heading', 1],
      ['G', 'file', 0],
      [ASIDE, 'aside', 0],
    ]);
    expect(contents.byKey.get('F')?.own).toEqual(['f1']);
    expect(contents.byKey.get('G')?.own).toEqual(['g1']);
    expect(contents.byKey.get(ASIDE)?.own).toEqual(['gone']);
  });

  it('is flat without headings and files', () => {
    const contents = buildContents([block('p1'), block('p2')]);
    expect(contents.flat).toBe(true);
    expect(contents.byKey.get(START)?.own).toEqual(['p1', 'p2']);
  });

  it('dims entries without matches and folds subheadings without matches', () => {
    const contents = buildContents(plain);
    const rows = contentsRows(contents, map(plain), 'edits');
    expect(rows.map(row => [row.entry.key, row.dim, row.folded])).toEqual([
      [START, true, 0],
      ['A', false, 1],
      ['B', true, 0],
    ]);
    expect(contentsRows(contents, map(plain), 'all')).toHaveLength(4);
    const own = ownRows(contents.byKey.get('A')!, map(plain), 'edits');
    expect([own.rows.map(item => item.key), own.hidden]).toEqual([['a1'], 1]);
  });

  it('steps a paragraph within its own paragraphs only', () => {
    const contents = buildContents(plain);
    expect(stepMoves(contents, plain, 'a1')).toEqual({up: null, down: 'A1', top: null, end: 'A1'});
    expect(stepMoves(contents, plain, 'a2')).toEqual({up: 'a1', down: null, top: 'a1', end: null});
    expect(stepMoves(contents, plain, 'A')).toEqual({up: null, down: null, top: null, end: null});
    const moved = plannedOrder(plain, [{kind: 'move', key: 'a1', before: 'A1'}]).order;
    expect(moved.map(item => item.key).slice(1, 5)).toEqual(['A', 'a2', 'a1', 'A1']);
  });

  it('moves a paragraph to the end of another entry’s own text, before its subheadings', () => {
    const contents = buildContents(plain);
    expect(moveToEntry(contents, plain, 'b1', 'A')).toBe('A1');
    expect(moveToEntry(contents, plain, 'a1', 'A')).toBeNull();
    expect(moveToEntry(contents, plain, 'a1', 'B')).toBe('end');
    expect(moveToEntry(contents, plain, 'a1', START)).toBe('A');
    const empty = [block('A', 1), block('A1', 2), block('x')];
    expect(moveToEntry(buildContents(empty), empty, 'x', 'A')).toBe('A1');
    expect(moveToEntry(contents, plain, 'A', 'B')).toBeNull();
  });

  it('moves a file among the files with its whole text', () => {
    const order = [file('F'), block('f1'), block('H', 1), file('G'), block('g1'), file('K')];
    const contents = buildContents(order);
    expect(stepMoves(contents, order, 'F')).toEqual({up: null, down: 'K', top: null, end: 'end'});
    expect(stepMoves(contents, order, 'G')).toEqual({up: 'F', down: 'end', top: 'F', end: 'end'});
    expect(moveFileBefore(order, 'K', 'F')).toBe('F');
    expect(moveFileBefore(order, 'F', 'G')).toBeNull();
    const result = plannedOrder(order, [{kind: 'move', key: 'G', before: 'F'}]).order;
    expect(result.map(item => item.key)).toEqual(['G', 'g1', 'F', 'f1', 'H', 'K']);
  });
});
