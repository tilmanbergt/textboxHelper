import {dividerTag, formatBlockTag, parseBlockTag, titleTag, type BlockTag} from '../../src/domain/blockTag';
import {segmentByFile} from '../../src/domain/fileSegments';
import {fileState, isWritable} from '../../src/domain/fileState';
import {covers, isFileTitle, planFileTitles} from '../../src/domain/fileTitles';
import {fingerprint} from '../../src/domain/fingerprint';
import {sourceImportBlocks} from '../../src/domain/importParsing';
import {
  baseName,
  fileNameProblem,
  indexLinks,
  indexText,
  newFiles,
  newLinkedFolder,
  newNoteLinks,
  noteKey,
  parseNoteLinks,
  serializeNoteLinks,
  startOrder,
  withFolder,
  withoutSource,
  withSources,
} from '../../src/domain/noteLinks';
import {addSummaries, parseSourceBlocks} from '../../src/domain/sourceBlocks';
import type {SourceItem} from '../../src/domain/sourceExport';
import {dividerText} from '../../src/domain/sourceRecord';
import {ELEMENT_TYPE_TITLE, TEXT_TYPE_NORMAL, type PageElementData, type Rect} from '../../src/domain/textboxModel';

const NOW = new Date('2026-11-21T10:00:00.000Z');

function block(s: string, i: number, extra: Partial<BlockTag> = {}): BlockTag {
  return {v: 1, id: `b-${s}-${i}`, s, i, ...extra};
}

function item(text: string, tag: BlockTag | null, page = 0): SourceItem {
  return {page, text, tag};
}

function divider(s: string, page = 0): SourceItem {
  return item(s, {v: 1, id: `d-${s}`, s, k: 'f'}, page);
}

describe('file segments', () => {
  it('gives each file the textboxes from its divider to the next', () => {
    const items = [
      divider('a'),
      item('A1', block('a', 0)),
      item('typed', null),
      divider('b', 1),
      item('B1', block('b', 0), 1),
    ];
    const segments = segmentByFile(items);
    expect(segments.order).toEqual(['a', 'b']);
    expect(segments.bySource.get('a')?.map(i => i.text)).toEqual(['A1', 'typed']);
    expect(segments.bySource.get('b')?.map(i => i.text)).toEqual(['B1']);
    expect(segments.orphans).toEqual([]);
    expect([...segments.withDivider]).toEqual(['a', 'b']);
  });

  it('lets a file linked before dividers existed own its pages before the first divider', () => {
    const items = [
      item('Earlier note text', null, 0),
      item('Old 1', block('old', 0), 1),
      item('typed', null, 1),
      item('Old 2', block('old', 1), 2),
      item('Later text', null, 3),
      divider('new', 4),
      item('N1', block('new', 0), 4),
    ];
    const segments = segmentByFile(items);
    expect(segments.order).toEqual(['old', 'new']);
    expect(segments.bySource.get('old')?.map(i => i.text)).toEqual(['Old 1', 'typed', 'Old 2']);
    expect(segments.orphans.map(i => i.text)).toEqual(['Earlier note text', 'Later text']);
    expect(segments.withDivider.has('old')).toBe(false);
  });

  it('leaves text before the first divider to no file when it is unclear', () => {
    const items = [item('Before', null), item('X', block('x', 0)), item('Y', block('y', 0)), divider('z')];
    const segments = segmentByFile(items);
    expect(segments.orphans.map(i => i.text)).toEqual(['Before', 'X', 'Y']);
    expect(segments.bySource.has('x')).toBe(false);
  });

  it('ignores a second divider of the same file', () => {
    const segments = segmentByFile([divider('a'), item('A', block('a', 0)), divider('a'), item('more', null)]);
    expect(segments.extraDividers).toBe(1);
    expect(segments.bySource.get('a')?.map(i => i.text)).toEqual(['A', 'more']);
  });
});

describe('file state', () => {
  const record = {original: 'A\n', lastWrittenText: null, fileFingerprint: fingerprint('A\n')};

  it('tells which files are written', () => {
    expect(fileState({differs: false, current: 'A\n', record, onNote: true})).toBe('inSync');
    expect(fileState({differs: true, current: 'A\n', record, onNote: true})).toBe('changedHere');
    expect(fileState({differs: false, current: 'B\n', record, onNote: true})).toBe('changedOutside');
    expect(fileState({differs: true, current: 'B\n', record, onNote: true})).toBe('changedBoth');
    expect(fileState({differs: true, current: null, record, onNote: true})).toBe('notFound');
    expect(fileState({differs: true, current: 'A\n', record, onNote: false})).toBe('notOnNote');
    expect(
      fileState({differs: true, current: null, record: {original: '', lastWrittenText: null, fileFingerprint: ''}, onNote: true}),
    ).toBe('new');
    expect(['inSync', 'changedHere', 'changedOutside', 'changedBoth', 'notFound', 'notOnNote', 'new'].filter(s => isWritable(s as never))).toEqual([
      'changedHere',
      'new',
    ]);
  });
});

function textbox(numInPage: number, rect: Rect, tag: BlockTag | null): PageElementData {
  return {
    uuid: `t${numInPage}`,
    type: TEXT_TYPE_NORMAL,
    layerNum: 0,
    numInPage,
    textBox: {
      fontSize: 60,
      fontPath: null,
      textContentFull: 'Name',
      textRect: rect,
      textAlign: 0,
      textBold: 1,
      textItalics: 0,
      textFrameWidthType: 0,
      textFrameStyle: 0,
      textEditable: 0,
    },
    title: null,
    link: null,
    picture: null,
    geometry: null,
    userData: tag ? formatBlockTag(tag) : null,
  };
}

function title(numInPage: number, rect: Rect, userData: string | null): PageElementData {
  return {
    uuid: `h${numInPage}`,
    type: ELEMENT_TYPE_TITLE,
    layerNum: 0,
    numInPage,
    textBox: null,
    title: {X: rect.left, Y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top},
    link: null,
    picture: null,
    geometry: null,
    userData,
  };
}

describe('file titles', () => {
  const top: Rect = {left: 100, top: 100, right: 900, bottom: 180};
  const lower: Rect = {left: 100, top: 600, right: 900, bottom: 680};

  it('covers a divider without a title, and keeps one that covers it', () => {
    const plan = planFileTitles([textbox(1, top, dividerTag('a', NOW))]);
    expect(plan).toEqual({insert: [{sourceId: 'a', numInPage: 1, rect: top}], remove: []});
    const covered = planFileTitles([
      textbox(1, top, dividerTag('a', NOW)),
      title(2, top, formatBlockTag(titleTag('a', NOW))),
    ]);
    expect(covered).toEqual({insert: [], remove: []});
  });

  it('replaces a title left behind by a moved divider and removes one without divider', () => {
    const plan = planFileTitles([
      textbox(1, lower, dividerTag('a', NOW)),
      title(2, top, formatBlockTag(titleTag('a', NOW))),
      title(3, top, formatBlockTag(titleTag('gone', NOW))),
    ]);
    expect(plan.insert.map(i => i.sourceId)).toEqual(['a']);
    expect(plan.remove).toEqual([2, 3]);
  });

  it('never touches titles that are not ours', () => {
    const plan = planFileTitles([title(1, top, null), textbox(2, top, null)]);
    expect(plan).toEqual({insert: [], remove: []});
    expect(isFileTitle(title(1, top, null))).toBe(false);
    expect(isFileTitle(title(1, top, formatBlockTag(titleTag('a', NOW))))).toBe(true);
  });

  it('counts a title as covering when it overlaps half of the smaller rectangle', () => {
    expect(covers(top, {...top, top: 140, bottom: 220})).toBe(true);
    expect(covers(top, {...top, top: 170, bottom: 250})).toBe(false);
  });
});

describe('tags and links of a note', () => {
  it('reads the divider and title kinds', () => {
    expect(parseBlockTag(formatBlockTag(dividerTag('s-1', NOW)))).toMatchObject({s: 's-1', k: 'f'});
    expect(parseBlockTag(formatBlockTag(titleTag('s-1', NOW)))).toMatchObject({s: 's-1', k: 't'});
    expect(parseBlockTag('tbt:b:{"v":1,"id":"b-1","k":"q"}')?.k).toBeUndefined();
  });

  it('keeps the files of a note in order, each once', () => {
    const links = withSources(withSources(newNoteLinks('/n.note', 'files'), ['a', 'b']), ['b', 'c']);
    expect(links.sources).toEqual(['a', 'b', 'c']);
    expect(withoutSource(links, 'b').sources).toEqual(['a', 'c']);
    expect(parseNoteLinks(serializeNoteLinks(links))).toEqual(links);
    expect(parseNoteLinks('{"version":2}')).toBeNull();
    expect(parseNoteLinks('{"version":1,"notePath":"/n","sources":[]}')?.mode).toBe('files');
    expect(noteKey('/a.note')).not.toBe(noteKey('/b.note'));
  });
});

describe('importing several files', () => {
  const structure = {
    layoutMode: 'paragraphTextboxes' as const,
    paragraphSeparator: 'line' as const,
    detectMarkdownHeadings: false,
    paragraph: {fontSize: 36, bold: false},
    heading1: {fontSize: 60, bold: true},
    heading2: {fontSize: 48, bold: true},
    heading3: {fontSize: 40, bold: true},
  };

  it('starts each file with its divider in the # style', () => {
    const {blocks} = parseSourceBlocks('Text\n');
    expect(sourceImportBlocks(blocks, structure, {index: 1, divider: 'Atomic notes'})).toEqual([
      {role: 'heading1', text: 'Atomic notes', fontSize: 60, bold: true, divider: true, sourceFile: 1},
      {role: 'paragraph', text: 'Text', fontSize: 36, bold: false, sourceIndex: 0, placeholder: undefined, sourceFile: 1},
    ]);
    expect(dividerText('/storage/emulated/0/Document/Zettel/Atomic notes.txt')).toBe('Atomic notes');
  });

  it('adds up what the files contain', () => {
    const total = addSummaries([
      parseSourceBlocks('# A\n\n| x |\n').summary,
      parseSourceBlocks('Text\n\n```\nx\n```\n\n| y |\n').summary,
    ]);
    expect(total).toMatchObject({blocks: 5, headings: 1, paragraphs: 1, protectedCount: 3, protectedKinds: {table: 2, code: 1}});
  });
});

describe('folder mode', () => {
  it('keeps a bound folder in the note record', () => {
    const links = withSources(
      newNoteLinks('/n.note', 'folder', newLinkedFolder('/storage/emulated/0/Document/Zettel', true, ['Draft.txt'])),
      ['a'],
    );
    expect(parseNoteLinks(serializeNoteLinks(links))).toEqual(links);
    expect(withFolder(links, {ordered: false}).folder?.ordered).toBe(false);
    // A folder record without its folder is read as files mode.
    expect(parseNoteLinks('{"version":1,"notePath":"/n","mode":"folder","sources":[]}')?.mode).toBe('files');
  });

  it('writes and reads the index as plain links', () => {
    const text = indexText(['Intro.txt', 'Atomic notes.txt']);
    expect(text).toBe('[[Intro]]\n[[Atomic notes]]\n');
    expect(indexLinks(text)).toEqual(['Intro', 'Atomic notes']);
    expect(indexLinks('# Book\n- [[Books/Zettel/Intro|Start]]\n- [[Atomic notes#Why]]\n[[Intro]]\n')).toEqual([
      'Intro',
      'Atomic notes',
    ]);
  });

  it('orders files by the index, by name or by date', () => {
    const files = [
      {name: 'b.txt', size: 1, mtime: 1},
      {name: 'a10.txt', size: 1, mtime: 3},
      {name: 'a2.txt', size: 1, mtime: 2},
    ];
    const names = (list: {name: string}[]) => list.map(file => file.name);
    expect(names(startOrder(files, null, 'name'))).toEqual(['a2.txt', 'a10.txt', 'b.txt']);
    expect(names(startOrder(files, null, 'date'))).toEqual(['b.txt', 'a2.txt', 'a10.txt']);
    expect(names(startOrder(files, ['b', 'a10'], 'name'))).toEqual(['b.txt', 'a10.txt', 'a2.txt']);
  });

  it('finds new files and checks new names', () => {
    expect(newFiles(['a.txt', 'B.txt', 'index.txt', 'c.txt'], ['b.txt'], ['c.txt'])).toEqual(['a.txt']);
    expect(fileNameProblem('Intro')).toBeNull();
    expect(fileNameProblem('  ')).toMatch(/empty/);
    expect(fileNameProblem('a/b')).toMatch(/can't contain/);
    expect(fileNameProblem('Index.txt')).toMatch(/index/);
    expect(baseName('Intro.TXT')).toBe('Intro');
  });
});
