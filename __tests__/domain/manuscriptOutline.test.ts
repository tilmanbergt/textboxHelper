import {formatBlockTag, newBlockId, parseBlockTag} from '../../src/domain/blockTag';
import type {ScannedTextBox} from '../../src/domain/exportClassification';
import {chipLabel, combinePages, readPages, unreadPages, type PageReview} from '../../src/domain/manuscriptPages';
import {createEmptyPreview} from '../../src/domain/markerText';
import type {EditMarkerPreview, RecognizedEditOperation} from '../../src/domain/markerTypes';
import {
  buildOutline,
  matchesFilter,
  firstLineOf,
  lastLineOf,
  parseBlockStatuses,
  serializeBlockStatuses,
} from '../../src/domain/outlineModel';

const operation = (id: string, num: number, target = 'tb'): RecognizedEditOperation => ({
  id,
  kind: 'delete',
  markerUuid: id,
  markerNumInPage: 1,
  consumedMarkerNums: [1],
  targetTextboxUuid: target,
  targetTextboxNumInPage: num,
  lineIndex: 0,
  summary: '',
  detail: '',
  words: [],
  textStart: 0,
});

const preview = (ops: RecognizedEditOperation[], extra: Partial<EditMarkerPreview> = {}): EditMarkerPreview => ({
  ...createEmptyPreview(),
  operations: ops,
  hunks: ops.map(op => ({operationId: op.id, label: 'Delete', before: '', segments: [], after: '', meta: ''})),
  ...extra,
});

describe('manuscript pages', () => {
  const plan = (page: number) => ({notePath: '/n', page, operations: [operation(`p${page}`, 3)], recognizedMarkerNums: [1], textMutations: [], penEditIds: [], insertions: []});
  const pages: Record<number, PageReview> = {
    2: {state: 'read', preview: preview([operation('b', 4)], {canApply: true, applyPlan: plan(2), pendingCount: 1})},
    0: {state: 'read', preview: preview([operation('a', 3)], {canApply: true, applyPlan: plan(0)})},
    1: {state: 'reading'},
    3: {state: 'failed', message: 'x'},
  };

  it('lists every read page\'s changes in page order and gathers the plans', () => {
    const view = combinePages(pages);
    expect(view.entries.map(entry => entry.key)).toEqual(['0:a', '2:b']);
    expect(view.plans.map(item => item.page)).toEqual([0, 2]);
    expect(view.readyCount).toBe(2);
    expect(view.pendingCount).toBe(1);
  });

  it('labels page chips and knows what is left to read', () => {
    expect(chipLabel(0, pages[0])).toBe('p.1 · 1');
    expect(chipLabel(1, pages[1])).toBe('p.2 …');
    expect(chipLabel(3, pages[3])).toBe('p.4 !');
    expect(chipLabel(4, undefined)).toBe('p.5 ?');
    expect(chipLabel(5, {state: 'read', preview: preview([])})).toBe('p.6 ✓');
    expect(unreadPages(5, pages)).toEqual([3, 4]);
    expect(readPages(pages)).toEqual([0, 2]);
  });
});

describe('block tag', () => {
  it('round-trips and ignores anything else', () => {
    const userData = formatBlockTag({v: 1, id: 'b-abc', s: 's-1', i: 4, p: 0});
    expect(parseBlockTag(userData)).toEqual({v: 1, id: 'b-abc', s: 's-1', i: 4, p: 0});
    expect(parseBlockTag('tbt:b:{"v":1}')).toBeNull();
    expect(parseBlockTag('tbt:b:{broken')).toBeNull();
    expect(parseBlockTag('gtdpara:mark:1')).toBeNull();
    expect(parseBlockTag(null)).toBeNull();
    expect(newBlockId(new Date(0), () => 0)).toBe('b-00000');
  });
});

describe('outline', () => {
  const item = (page: number, numInPage: number, text: string, extra: Partial<ScannedTextBox> = {}): ScannedTextBox => ({
    page,
    numInPage,
    userData: null,
    text,
    role: 'paragraph',
    styleSignature: '',
    fontSize: 36,
    bold: false,
    italic: false,
    border: false,
    rect: null,
    ...extra,
  });
  const long = 'Capture what matters first, then let the rest settle. A list made in the evening looks different in the morning. The next morning decides what was worth keeping.';

  it('shows first and last line of a long block, the first only of a short one', () => {
    expect(firstLineOf('Short text')).toBe('Short text');
    expect(lastLineOf('Short text')).toBe('');
    expect(firstLineOf(long)).toBe('Capture what matters first, then let the rest settle. A list …');
    expect(lastLineOf(long)).toBe('… the morning. The next morning decides what was worth keeping.');
  });

  it('builds blocks with status by tag and edits pending from read pages', () => {
    const tag = formatBlockTag({v: 1, id: 'b-1'});
    const blocks = buildOutline(
      [item(0, 3, 'Rest', {role: 'heading', userData: tag}), item(0, 5, long), item(1, 2, 'Other page')],
      {'b-1': 'final'},
      {0: {state: 'read', preview: preview([operation('x', 5), operation('y', 5), operation('z', 0, 'new:pe')])}},
    );
    expect(blocks.map(block => [block.key, block.kind, block.status, block.pendingEdits])).toEqual([
      ['b-1', 'paragraph', 'final', 0],
      ['0:5', 'paragraph', 'open', 2],
      ['1:2', 'paragraph', 'open', null],
    ]);
    expect(blocks.map(block => [matchesFilter(block, 'edits'), matchesFilter(block, 'notFinal')])).toEqual([
      [false, false],
      [true, true],
      [false, true],
    ]);
  });

  it('takes a heading\'s level from its #s, its file\'s record or its NOTE title, never its look', () => {
    const divider = formatBlockTag({v: 1, id: 'b-f', s: 's1', k: 'f'});
    const linked = formatBlockTag({v: 1, id: 'b-h', s: 's1', i: 3});
    const blocks = buildOutline(
      [
        item(0, 0, 'Essay', {userData: divider, underTitle: true}),
        item(0, 1, '## Methods', {role: 'paragraph'}),
        item(0, 2, 'Big and bold', {role: 'heading'}),
        item(0, 3, 'Old heading', {userData: linked}),
        item(0, 4, 'Under a title', {underTitle: true}),
        item(0, 5, '#tag is not a heading'),
        item(0, 6, 'Set aside', {userData: formatBlockTag({v: 1, id: 'b-a', a: 1})}),
      ],
      {},
      {},
      {defaultLevel: 2, recordLevel: tag => (tag.i === 3 ? 5 : null)},
    );
    expect(blocks.map(block => [block.kind, block.level])).toEqual([
      ['file', 0],
      ['heading', 2],
      ['paragraph', null],
      ['heading', 3],
      ['heading', 2],
      ['paragraph', null],
      ['paragraph', null],
    ]);
    expect(blocks[6].aside).toBe(true);
  });

  it('stores statuses without the default and drops what it can\'t read', () => {
    const json = serializeBlockStatuses({'b-1': 'final', 'b-2': 'open', 'b-3': 'review'});
    expect(parseBlockStatuses(json)).toEqual({'b-1': 'final', 'b-3': 'review'});
    expect(parseBlockStatuses('{"statuses":{"b-1":"done"}}')).toEqual({});
    expect(parseBlockStatuses('nope')).toEqual({});
  });
});
