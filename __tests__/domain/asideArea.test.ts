import {formatBlockTag, type BlockTag} from '../../src/domain/blockTag';
import {getIncludedScanItems, textPartOf, type ScanSummary, type ScannedTextBox} from '../../src/domain/exportClassification';
import {asideStart, hasAsideDivider, splitAtAside} from '../../src/domain/noteRegions';
import {blockActions} from '../../src/domain/outlineActions';
import {
  ASIDE,
  asideEntry,
  buildContents,
  contentsRows,
  initialEntry,
  isFlat,
  moveToEntry,
  ownRows,
} from '../../src/domain/outlineContents';
import {layoutNote, shiftedPage, type NoteLayoutBlock} from '../../src/domain/outlineLayout';
import {buildOutline, matchesFilter, type OutlineBlock} from '../../src/domain/outlineModel';
import {canMove, canRemove, canSetAside, plannedOrder, plannedSummary} from '../../src/domain/outlinePlan';
import {startsPage, DEFAULT_PAGE_LAYOUT} from '../../src/domain/pageLayout';

const divider: BlockTag = {v: 1, id: 'd', k: 'a'};
const linked = (i: number, extra: Partial<BlockTag> = {}): BlockTag => ({v: 1, id: `b-${i}`, s: 's-1', i, ...extra});

describe('where the aside area starts', () => {
  it('starts at the divider', () => {
    expect(asideStart([null, linked(0), divider, linked(1)])).toBe(2);
    expect(hasAsideDivider([null, divider])).toBe(true);
    expect(asideStart([null, linked(0)])).toBeNull();
  });

  it('starts, without divider, at the first older set-aside textbox after the linked text', () => {
    expect(asideStart([linked(0), linked(1), linked(2, {a: 1}), null])).toBe(2);
    // One moved back by hand into the text doesn't pull the text after it into the area.
    expect(asideStart([linked(0), linked(1, {a: 1}), linked(2), linked(3, {a: 1})])).toBe(3);
    // A title of ours over the divider is not a set-aside textbox.
    expect(asideStart([linked(0), {v: 1, id: 't', k: 't', a: 1}])).toBeNull();
  });

  it('splits items at the start, the divider going with the area', () => {
    const items = ['a', 'b', 'D', 'c'];
    const tags: Record<string, BlockTag | null> = {a: null, b: null, D: divider, c: null};
    expect(splitAtAside(items, item => tags[item])).toEqual({text: ['a', 'b'], aside: ['D', 'c']});
  });

  it('starts a page with the divider', () => {
    expect(startsPage({kind: 'aside', level: 0}, DEFAULT_PAGE_LAYOUT)).toBe(true);
  });
});

const scanned = (numInPage: number, text: string, tag: BlockTag | null = null, page = 0): ScannedTextBox => ({
  page,
  numInPage,
  userData: tag ? formatBlockTag(tag) : null,
  text,
  role: 'paragraph',
  styleSignature: '',
  fontSize: 30,
  bold: false,
  italic: false,
  border: false,
  rect: {left: 100, top: 100 * numInPage, right: 900, bottom: 100 * numInPage + 80},
});

describe('the aside area in the Outline', () => {
  const items = [
    scanned(0, '# Essay'),
    scanned(1, 'Text'),
    scanned(0, 'Set aside', divider, 1),
    scanned(1, 'Parked', linked(4), 1),
    scanned(2, '# Comments for Anna', null, 1),
    scanned(3, 'Ask about the GTD part', null, 1),
    scanned(4, 'Old file title', {v: 1, id: 'f', s: 's-2', k: 'f'}, 1),
  ];
  const blocks = buildOutline(items, {}, {});

  it('makes the divider a block of its own and everything after it aside, by position', () => {
    expect(blocks.map(block => [block.kind, block.aside])).toEqual([
      ['heading', false],
      ['paragraph', false],
      ['aside', true],
      ['paragraph', true],
      ['heading', true],
      ['paragraph', true],
      // A file's divider in the area is just text: the area belongs to no file.
      ['paragraph', true],
    ]);
    expect(blocks[2].level).toBe(0);
  });

  it('shows the text or the aside area, never both', () => {
    expect(blocks.filter(block => matchesFilter(block, 'all')).map(block => block.text)).toEqual(['# Essay', 'Text']);
    expect(blocks.filter(block => matchesFilter(block, 'aside')).length).toBe(5);
    expect(blocks.filter(block => matchesFilter(block, 'notFinal')).length).toBe(2);
  });

  it('builds the area as the last top entry with the headings typed in it', () => {
    const contents = buildContents(blocks);
    const area = asideEntry(contents);
    expect(area?.key).toBe('d');
    expect(area?.title).toBe('Set aside');
    expect(area?.own).toEqual(['b-4']);
    expect(contents.entries.map(entry => [entry.kind, entry.depth, entry.aside])).toEqual([
      ['heading', 0, false],
      ['aside', 0, true],
      ['heading', 1, true],
    ]);
    const shown = new Map(blocks.map(block => [block.key, block]));
    expect(contentsRows(contents, shown, 'all').map(row => row.entry.kind)).toEqual(['heading']);
    expect(contentsRows(contents, shown, 'aside').map(row => row.entry.kind)).toEqual(['aside', 'heading']);
    expect(initialEntry(contents, 'aside')).toBe('d');
    expect(initialEntry(contents, 'all')).toBe(blocks[0].key);
    expect(ownRows(contents.byKey.get('d')!, shown, 'aside').rows.map(block => block.text)).toEqual(['Parked']);
    expect(isFlat(contents, 'aside')).toBe(false);
  });

  it('is flat in the aside view without headings there, and the text keeps its own flatness', () => {
    const contents = buildContents(buildOutline([scanned(0, 'Text'), scanned(0, 'Set aside', divider, 1), scanned(1, 'Parked', null, 1)], {}, {}));
    expect(contents.flat).toBe(true);
    expect(isFlat(contents, 'aside')).toBe(true);
  });

  it('moves a paragraph back into the text, and within the area', () => {
    const contents = buildContents(blocks);
    // Back to the end of "# Essay": before the divider.
    expect(moveToEntry(contents, blocks, 'b-4', blocks[0].key)).toBe('d');
    // From the area's own text to the end of "# Comments for Anna", the end of the note.
    const comments = contents.entries.find(entry => entry.title === 'Comments for Anna')!;
    expect(moveToEntry(contents, blocks, 'b-4', comments.key)).toBe('end');
  });

  it('keeps the divider in place and sets nothing aside twice', () => {
    expect([canMove(blocks[2]), canRemove(blocks[2]), canSetAside(blocks[2])]).toEqual([false, false, false]);
    expect([canRemove(blocks[3]), canSetAside(blocks[3])]).toEqual([true, false]);
    expect(plannedOrder(blocks, [{kind: 'aside', key: 'b-4'}]).aside).toEqual([]);
    expect(plannedOrder(blocks, [{kind: 'level', key: 'd', level: 2, withSubheadings: false}]).levels.size).toBe(0);
  });

  it('names a move back in the planned line, and puts the block in the text by its planned place', () => {
    const plan = [{kind: 'move' as const, key: 'b-4', before: 'd'}];
    const planned = plannedOrder(blocks, plan);
    expect(plannedSummary(blocks, plan, planned)).toBe('1 paragraph moved back');
    // Right before the divider, it is the text's last block.
    expect(planned.order.map(block => [block.key, block.aside]).slice(1, 4)).toEqual([
      [blocks[1].key, false],
      ['b-4', false],
      ['d', true],
    ]);
    expect(asideEntry(buildContents(planned.order))?.own).toEqual([]);
  });

  it('lays a block moved back right before the divider out with the text', () => {
    const plan = [{kind: 'move' as const, key: 'b-4', before: 'd'}];
    const planned = plannedOrder(blocks, plan);
    const original = blocks.map(block => ({...block, startsPage: block.kind === 'aside'}));
    const rebuild = layoutNote(original, planned.order.map(block => block.key), planned.order.findIndex(block => block.aside), {top: 0, bottom: 1000}, 2);
    expect(rebuild?.placements.get('b-4')?.page).toBe(0);
  });

  it('gives a note set aside before the divider a pseudo entry', () => {
    const old = buildOutline([scanned(0, 'Text', linked(0)), scanned(0, 'Parked', linked(1, {a: 1}), 1)], {}, {});
    const contents = buildContents(old);
    expect(asideEntry(contents)?.key).toBe(ASIDE);
    expect(contents.byKey.get(ASIDE)?.own).toEqual(['b-1']);
    expect(moveToEntry(contents, old, 'b-0', ASIDE)).toBe('end');
  });
});

describe('actions per block', () => {
  const kinds = (kind: OutlineBlock['kind'], aside: boolean, flat = false) => blockActions({kind, aside}, flat);

  it('offers Set aside in the text and Move back in the aside area', () => {
    expect(kinds('paragraph', false)).toEqual(['steps', 'moveTo', 'setAside', 'delete']);
    expect(kinds('paragraph', true)).toEqual(['moveBack', 'steps', 'moveTo', 'delete']);
    expect(kinds('paragraph', true, true)).toEqual(['moveBack', 'steps', 'delete']);
    expect(kinds('heading', false)).toEqual(['level', 'setAside', 'delete']);
    expect(kinds('heading', true)).toEqual(['level', 'delete']);
    expect(kinds('aside', true)).toEqual([]);
  });
});

describe('laying out the text and the aside area apart', () => {
  const frame = {top: 100, bottom: 1000};
  const at = (key: string, page: number, top: number, aside = false, breaks = false): NoteLayoutBlock => ({
    key,
    page,
    rect: {left: 100, top, right: 900, bottom: top + 300},
    aside,
    startsPage: breaks,
  });
  // Text on pages 0–1, the aside area on pages 2–3.
  const note = [
    at('a', 0, 100),
    at('b', 0, 450),
    at('c', 1, 100),
    at('d', 1, 450),
    at('D', 2, 100, true, true),
    at('x', 2, 450, true),
    at('y', 3, 100, true),
  ];
  const keys = note.map(block => block.key);

  it('inserts pages before the aside area when the text grows, and moves the area down whole', () => {
    // a grows: the text needs a third page.
    const rebuild = layoutNote(note, keys, 4, frame, 4, new Map([['a', 700]]));
    expect(rebuild?.insertAt).toBe(2);
    expect(rebuild?.insertCount).toBe(1);
    expect(rebuild?.pages).toEqual([0, 1]);
    expect(rebuild?.placements.get('d')?.page).toBe(2);
    expect(rebuild?.placements.has('D')).toBe(false);
    expect(shiftedPage(rebuild!, 2)).toBe(3);
    expect(shiftedPage(rebuild!, 1)).toBe(1);
  });

  it('moves a block back into the text and closes its gap in the area', () => {
    const order = ['a', 'b', 'x', 'c', 'd', 'D', 'y'];
    const rebuild = layoutNote(note, order, 5, frame, 4);
    expect(rebuild?.placements.get('x')?.page).toBe(1);
    expect(rebuild?.placements.get('d')?.page).toBe(2);
    expect(rebuild?.insertCount).toBe(1);
    // In the area, x's page is laid out again; y on the next page stays (a gap stays, as in the text).
    expect(rebuild?.placements.get('D')?.page).toBe(3);
    expect(rebuild?.placements.has('y')).toBe(false);
    expect(rebuild?.pages).toEqual([1, 2]);
  });

  it('gives an older aside area a page of its own for the divider', () => {
    const old = note.filter(block => block.key !== 'D').map(block => (block.key === 'x' ? {...block, top: 100} : block));
    const rebuild = layoutNote(old, old.map(block => block.key), 4, frame, 4, new Map(), true);
    expect(rebuild?.dividerPage).toBe(2);
    expect(rebuild?.insertCount).toBe(1);
  });

  it('falls back to one part when the text and the area share a page', () => {
    const shared = [at('a', 0, 100), at('x', 0, 450, true)];
    const rebuild = layoutNote(shared, ['x', 'a'], 1, frame, 1);
    expect(rebuild?.insertCount).toBe(0);
    expect(rebuild?.dividerPage).toBeNull();
  });
});

describe('the DOCX export', () => {
  it('leaves the aside area out', () => {
    const items = [scanned(0, 'Text'), scanned(0, 'Set aside', divider, 1), scanned(1, 'Parked', null, 1)];
    expect(textPartOf(items).map(item => item.text)).toEqual(['Text']);
    const scan: ScanSummary = {
      notePath: 'n',
      scope: 'wholeNote',
      scannedPages: [0, 1],
      items,
      counts: {heading: 0, paragraph: 3, comment: 0, meta: 0, unknown: 0},
    };
    expect(getIncludedScanItems(scan, false).map(item => item.text)).toEqual(['Text']);
  });
});
