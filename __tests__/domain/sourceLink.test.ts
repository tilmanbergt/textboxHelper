import {paginateTextboxBlocksIntoPages} from '../../src/domain/blockPagination';
import {formatBlockTag, parseBlockTag, withAside, type BlockTag} from '../../src/domain/blockTag';
import {fingerprint} from '../../src/domain/fingerprint';
import {sourceImportBlocks} from '../../src/domain/importParsing';
import {
  blockName,
  parseSourceBlocks,
  protectedSummaryText,
  type SourceBlock,
} from '../../src/domain/sourceBlocks';
import {fileDiff, regenerateSource, type SourceItem} from '../../src/domain/sourceExport';
import {copyPath, newSourceId, parseSourceRecord, serializeSourceRecord, type SourceRecord} from '../../src/domain/sourceRecord';

const SOURCE = 's-1';

function record(original: string, extra: Partial<SourceRecord> = {}): SourceRecord {
  const parsed = parseSourceBlocks(original);
  return {
    version: 1,
    sourceId: SOURCE,
    filePath: '/storage/emulated/0/INBOX/Essay.txt',
    notePath: '/storage/emulated/0/Note/Essay.note',
    importedAt: '2026-11-20T10:00:00.000Z',
    original,
    eol: parsed.eol,
    frontmatterEnd: parsed.frontmatterEnd,
    blocks: parsed.blocks,
    removedProtected: [],
    lastWrittenAt: null,
    lastWrittenText: null,
    fileFingerprint: fingerprint(original),
    ...extra,
  };
}

function tag(i: number, extra: Partial<BlockTag> = {}): BlockTag {
  return {v: 1, id: `b-${i}`, s: SOURCE, i, ...extra};
}

/** The textboxes an import of the record would put on one page, untouched. */
function imported(r: SourceRecord): SourceItem[] {
  return r.blocks.map(block => ({
    page: 0,
    text: block.text,
    tag: tag(block.index, block.role === 'protected' ? {k: 'x'} : {}),
  }));
}

/** Everything outside frontmatter and spans must be whitespace. */
function outside(original: string, blocks: SourceBlock[], frontmatterEnd: number): string {
  let rest = '';
  let at = frontmatterEnd;
  for (const block of blocks) {
    rest += original.slice(at, block.start);
    at = block.end;
  }
  return rest + original.slice(at);
}

const ESSAY = [
  '---',
  'title: Essay',
  'tags: [draft]',
  '---',
  '',
  '# Essay',
  '',
  'First paragraph,',
  'with a second line.',
  '',
  '## Methods',
  'Directly after the heading.',
  '',
  '- one',
  '\t- nested',
  '- [ ] task',
  '',
  '```js',
  'const a = 1;',
  '',
  'const b = 2;',
  '```',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  '> [!note] Callout',
  '> body',
  '',
  'Last [[Link]] here.',
  '',
].join('\n');

describe('source blocks', () => {
  it('finds frontmatter, headings, paragraphs, lists and protected blocks', () => {
    const parsed = parseSourceBlocks(ESSAY);
    expect(parsed.eol).toBe('\n');
    expect(ESSAY.slice(0, parsed.frontmatterEnd)).toBe('---\ntitle: Essay\ntags: [draft]\n---');
    expect(parsed.blocks.map(block => [block.role, block.protectedKind ?? block.level, block.text])).toEqual([
      ['heading', 1, 'Essay'],
      ['paragraph', 0, 'First paragraph,\nwith a second line.'],
      ['heading', 2, 'Methods'],
      ['paragraph', 0, 'Directly after the heading.'],
      ['list', 0, '- one\n\t- nested\n- [ ] task'],
      ['protected', 'code', '⟦Code · 5 lines · kept as is⟧'],
      ['protected', 'table', '⟦Table · 2 rows · kept as is⟧'],
      ['protected', 'quote', '⟦Callout · 2 lines · kept as is⟧'],
      ['paragraph', 0, 'Last [[Link]] here.'],
    ]);
    expect(outside(ESSAY, parsed.blocks, parsed.frontmatterEnd).trim()).toBe('');
    expect(parsed.summary).toMatchObject({blocks: 9, headings: 2, paragraphs: 3, lists: 1, protectedCount: 3, frontmatter: true});
    expect(protectedSummaryText(parsed.summary)).toBe('Kept as is: 1 code block, 1 table, 1 quote or callout');
  });

  it('keeps every span exact with CRLF, no trailing newline and loose whitespace', () => {
    const text = '\r\n\r\n# Title #\r\nText one\r\n\r\n\r\n   \r\n$$\r\nx = 1\r\n\r\n$$\r\n%% note %%\r\n\r\n---\r\n\r\n![[a.png]]\r\n\r\n<div>x</div>\r\n\r\nend';
    const parsed = parseSourceBlocks(text);
    expect(parsed.eol).toBe('\r\n');
    expect(parsed.frontmatterEnd).toBe(0);
    expect(parsed.blocks.map(block => block.protectedKind ?? block.role)).toEqual([
      'heading',
      'paragraph',
      'math',
      'comment',
      'rule',
      'embed',
      'html',
      'paragraph',
    ]);
    expect(parsed.blocks[0].text).toBe('Title #');
    expect(outside(text, parsed.blocks, 0).trim()).toBe('');
    expect(text.slice(parsed.blocks[2].start, parsed.blocks[2].end)).toBe('$$\r\nx = 1\r\n\r\n$$');
  });

  it('lets an unclosed fence run to the end and needs a closing frontmatter line', () => {
    const parsed = parseSourceBlocks('---\nnot closed\n\nText\n\n```\ncode\n\nmore\n\n');
    expect(parsed.frontmatterEnd).toBe(0);
    const code = parsed.blocks[parsed.blocks.length - 1];
    expect(code.protectedKind).toBe('code');
    expect(code.text).toBe('⟦Code · 4 lines · kept as is⟧');
  });

  it('names blocks by their first words', () => {
    const [heading, paragraph] = parseSourceBlocks('# A\n\none two three four five six seven').blocks;
    expect(blockName(heading)).toBe('A');
    expect(blockName(paragraph)).toBe('one two three four five…');
  });

  it('parses an empty file and a frontmatter-only file', () => {
    expect(parseSourceBlocks('').blocks).toEqual([]);
    const only = parseSourceBlocks('---\na: 1\n---\n');
    expect(only.blocks).toEqual([]);
    expect(only.frontmatterEnd).toBe(12);
  });
});

describe('regenerating the file', () => {
  it('writes an untouched import back byte for byte', () => {
    for (const text of [
      ESSAY,
      ESSAY.replace(/\n/g, '\r\n'),
      '# Only\nno trailing newline',
      '﻿\n\nText\n\n\n\n',
      '   leading spaces\n\n# H',
    ]) {
      const r = record(text);
      const result = regenerateSource(r, imported(r));
      expect(result.text).toBe(text);
      expect(result.identical).toBe(true);
      expect(result.counts.edited + result.counts.added + result.counts.missing).toBe(0);
    }
  });

  it('writes an edited paragraph and keeps a heading level', () => {
    const r = record(ESSAY);
    const items = imported(r);
    items[1] = {...items[1], text: 'First paragraph, changed.'};
    items[2] = {...items[2], text: 'Method'};
    const result = regenerateSource(r, items);
    expect(result.text).toContain('\n# Essay\n\nFirst paragraph, changed.\n\n## Method\n');
    expect(result.counts).toMatchObject({unchanged: 4, edited: 2, added: 0, missing: 0, protectedKept: 3});
    expect(result.text.startsWith('---\ntitle: Essay')).toBe(true);
  });

  it('writes a split tail as new text after its shortened head', () => {
    const r = record('One. Two.\n\nNext.\n');
    const items: SourceItem[] = [
      {page: 0, text: 'One.', tag: tag(0)},
      {page: 0, text: 'Two.', tag: null},
      {page: 0, text: 'Next.', tag: tag(1)},
    ];
    expect(regenerateSource(r, items).text).toBe('One.\n\nTwo.\n\nNext.\n');
  });

  it('writes a joined textbox once and reports the block it swallowed as missing', () => {
    const r = record('A.\n\nB.\n');
    const result = regenerateSource(r, [{page: 0, text: 'A. B.', tag: tag(0)}]);
    expect(result.text).toBe('A. B.\n');
    expect(result.missing).toEqual(['B.']);
    expect(result.present).toBe(true);
    // With no tag of the file left in its segment, nothing of it is on the note.
    expect(regenerateSource(r, [{page: 0, text: 'A. B.', tag: null}]).present).toBe(false);
  });

  it('writes typed markdown as typed, and follows the page order', () => {
    const r = record('# One\n\nText one.\n\n# Two\n\nText two.\n');
    const items = imported(r);
    const moved = [items[2], items[3], items[0], items[1], {page: 0, text: '## New', tag: null}];
    expect(regenerateSource(r, moved).text).toBe('# Two\n\nText two.\n\n# One\n\nText one.\n\n## New\n');
  });

  it('joins the pieces of a paragraph the import cut', () => {
    const r = record('alpha beta gamma\n');
    const pieces = [
      {page: 0, text: 'alpha beta', tag: tag(0, {p: 0})},
      {page: 1, text: 'gamma', tag: tag(0, {p: 1})},
    ];
    expect(regenerateSource(r, pieces).text).toBe('alpha beta gamma\n');
    pieces[1] = {...pieces[1], text: 'delta'};
    expect(regenerateSource(r, pieces).text).toBe('alpha beta delta\n');
  });

  it('moves a protected block with its placeholder and ignores the placeholder text', () => {
    const r = record('Intro.\n\n```\ncode\n```\n\nEnd.\n');
    const items = imported(r);
    const result = regenerateSource(r, [items[0], items[2], {...items[1], text: 'scribbled'}]);
    expect(result.text).toBe('Intro.\n\nEnd.\n\n```\ncode\n```\n');
  });

  it('keeps a protected block whose placeholder was deleted until its removal is confirmed', () => {
    const r = record('A.\n\n| x |\n\nB.\n\nC.\n');
    const items = imported(r).filter(item => item.tag?.i !== 1);
    const pending = regenerateSource(r, [items[2], items[0], items[1]]);
    expect(pending.pendingRemoval.map(block => block.index)).toEqual([1]);
    expect(pending.text).toBe('C.\n\nA.\n\n| x |\n\nB.\n');
    expect(pending.warnings[0]).toContain('deleted on the page');
    const removed = regenerateSource({...r, removedProtected: [1]}, items);
    expect(removed.pendingRemoval).toEqual([]);
    expect(removed.text).toBe('A.\n\nB.\n\nC.\n');
    expect(removed.counts.protectedRemoved).toBe(1);
  });

  it('writes a copied placeholder once', () => {
    const r = record('A.\n\n---\n');
    const items = imported(r);
    const result = regenerateSource(r, [...items, items[1]]);
    expect(result.text).toBe('A.\n\n---\n');
    expect(result.warnings[0]).toContain('copy');
  });

  it('warns about changed list indentation and broken links', () => {
    const r = record('- a\n\t- b\n\nSee [[Page]].\n');
    const items = imported(r);
    items[0] = {...items[0], text: '- a\n- b'};
    items[1] = {...items[1], text: 'See [[Page.'};
    const result = regenerateSource(r, items);
    expect(result.warnings).toEqual([
      'List "- a - b": check its indentation.',
      'A link may be broken in "See [[Page.".',
    ]);
  });

  it('counts a deleted paragraph as missing and holds back a textbox of another file', () => {
    const r = record('A.\n\nB.\n\nC.\n');
    const items: SourceItem[] = [
      {page: 1, text: 'A.', tag: tag(0)},
      {page: 1, text: 'Other file', tag: {v: 1, id: 'x', s: 's-2', i: 0}},
      {page: 2, text: 'C.', tag: tag(2)},
    ];
    const result = regenerateSource(r, items);
    expect(result.text).toBe('A.\n\nC.\n');
    expect(result.missing).toEqual(['B.']);
    expect(result.crossings).toEqual([{from: 's-2', id: 'x', name: 'Other file'}]);
    // Confirmed, it is written here as it is.
    expect(regenerateSource(r, items, {accept: true}).text).toBe('A.\n\nOther file\n\nC.\n');
  });

  it('leaves out blocks the Outline set aside, without calling them missing', () => {
    const r = record('A.\n\nB.\n\nC.\n');
    const items: SourceItem[] = [
      {page: 0, text: 'A.', tag: tag(0)},
      {page: 0, text: 'C.', tag: tag(2)},
      {page: 1, text: 'B.', tag: tag(1, {a: 1})},
    ];
    const result = regenerateSource(r, items);
    expect(result.text).toBe('A.\n\nC.\n');
    expect(result.missing).toEqual([]);
    expect(result.counts.setAside).toBe(1);
  });

  it('writes CRLF for edited text in a CRLF file', () => {
    const r = record('A\r\n\r\nB\r\n');
    const items = imported(r);
    items[1] = {...items[1], text: 'B one\nB two'};
    expect(regenerateSource(r, items).text).toBe('A\r\n\r\nB one\r\nB two\r\n');
  });

  it('leaves only the frontmatter when every textbox is gone', () => {
    const r = record('---\na: 1\n---\n\nText\n');
    expect(regenerateSource(r, []).text).toBe('---\na: 1\n---\n');
  });
});

describe('file difference', () => {
  it('compares with what was last written, else the original', () => {
    const r = record('A.\n\nB.\n');
    expect(fileDiff({text: 'A.\n\nB.\n'}, r)).toEqual({differs: false, changedBlocks: 0});
    expect(fileDiff({text: 'A!\n\nB.\n'}, r)).toEqual({differs: true, changedBlocks: 1});
    expect(fileDiff({text: 'B.\n\nA.\n'}, r)).toEqual({differs: true, changedBlocks: 1});
    expect(fileDiff({text: 'A!\n\nB.\n'}, {...r, lastWrittenText: 'A!\n\nB.\n'}).differs).toBe(false);
  });
});

describe('source record and tag', () => {
  it('reads back what it writes and refuses broken records', () => {
    const r = record(ESSAY, {removedProtected: [5]});
    expect(parseSourceRecord(serializeSourceRecord(r))).toEqual(r);
    expect(parseSourceRecord('{"version":2}')).toBeNull();
    expect(parseSourceRecord('not json')).toBeNull();
  });

  it('builds ids and copy names', () => {
    expect(newSourceId(new Date(36), () => 0)).toBe('s-100000');
    expect(copyPath('/storage/emulated/0/INBOX/Essay.txt', new Date(2026, 10, 20, 17, 4))).toBe(
      '/storage/emulated/0/INBOX/Essay (Supernote 2026-11-20 1704).txt',
    );
  });

  it('carries the placeholder kind in the block tag', () => {
    const userData = formatBlockTag({v: 1, id: 'b-1', s: SOURCE, i: 3, k: 'x'});
    expect(parseBlockTag(userData)).toEqual({v: 1, id: 'b-1', s: SOURCE, i: 3, k: 'x'});
    expect(parseBlockTag('tbt:b:{"v":1,"id":"b","k":"y"}')).toEqual({v: 1, id: 'b'});
  });

  it('marks a tag as set aside and back, and leaves other userData alone', () => {
    const userData = formatBlockTag({v: 1, id: 'b-1', s: SOURCE, i: 3});
    const aside = withAside(userData, true);
    expect(parseBlockTag(aside)).toEqual({v: 1, id: 'b-1', s: SOURCE, i: 3, a: 1});
    expect(parseBlockTag(withAside(aside, false))).toEqual({v: 1, id: 'b-1', s: SOURCE, i: 3});
    expect(withAside(userData, false)).toBe(userData);
    expect(withAside('gtdpara:mark:1', true)).toBe('gtdpara:mark:1');
    expect(withAside(null, true)).toBeNull();
  });

  it('fingerprints text', () => {
    expect(fingerprint('abc')).toBe(fingerprint('abc'));
    expect(fingerprint('abc')).not.toBe(fingerprint('abd'));
    expect(fingerprint('')).toBe('0-811c9dc5');
  });
});

describe('linked import', () => {
  const structure = {
    layoutMode: 'paragraphTextboxes' as const,
    paragraphSeparator: 'line' as const,
    detectMarkdownHeadings: false,
    paragraph: {fontSize: 36, bold: false},
    heading1: {fontSize: 60, bold: true},
    heading2: {fontSize: 48, bold: true},
    heading3: {fontSize: 40, bold: true},
  };

  it('places one block per textbox with its source index, headings always recognized', () => {
    const {blocks} = parseSourceBlocks('# A\n\n#### Deep\n\ntext\n\n```\nx\n```\n');
    expect(sourceImportBlocks(blocks, structure)).toEqual([
      {role: 'heading1', text: 'A', fontSize: 60, bold: true, sourceIndex: 0},
      {role: 'heading3', text: 'Deep', fontSize: 40, bold: true, sourceIndex: 1},
      {role: 'paragraph', text: 'text', fontSize: 36, bold: false, sourceIndex: 2},
      {role: 'paragraph', text: '⟦Code · 3 lines · kept as is⟧', fontSize: 36, bold: false, sourceIndex: 3, placeholder: true},
    ]);
  });

  it('numbers the pieces of a block cut to fit the pages', async () => {
    const pages = await paginateTextboxBlocksIntoPages({
      blocks: [
        {role: 'paragraph', text: 'short', fontSize: 36, bold: false, sourceIndex: 0},
        {role: 'paragraph', text: `${'a'.repeat(60)} ${'b'.repeat(60)}`, fontSize: 36, bold: false, sourceIndex: 1},
      ],
      maxRect: {left: 0, top: 0, right: 100, bottom: 100},
      measureHeight: async text => text.length,
    });
    const chunks = pages.flatMap(page => page.chunks);
    expect(chunks.map(chunk => [chunk.sourceIndex, chunk.piece])).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
  });
});
