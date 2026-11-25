import {formatBlockTag} from '../../src/domain/blockTag';
import {blockCandidates, noteCountLabel, noteCounts, notesStayLine} from '../../src/domain/notes/outlineNotes';
import {buildOutline} from '../../src/domain/outlineModel';
import type {ScannedTextBox} from '../../src/domain/exportClassification';
import {parsePenEditEntry, type PenEditEntry} from '../../src/domain/penEditModel';

/**
 * How many comments and images does each Outline block have (technical-design-comments-images.md
 * §6)? From the index entries and the Outline's own scan, for the whole note, no page read.
 */

let num = 0;
function scanned(page: number, top: number, text: string, tag: object | null = null): ScannedTextBox {
  num += 1;
  return {
    page,
    numInPage: num,
    userData: tag ? formatBlockTag({v: 1, id: `b${num}`, ...tag}) : null,
    text,
    role: 'body',
    styleSignature: '',
    fontSize: 36,
    bold: false,
    italic: false,
    border: false,
    rect: {left: 100, top, right: 1100, bottom: top + 150},
  } as unknown as ScannedTextBox;
}

function note(kind: 'comment' | 'image', page: number, top: number, extra: Record<string, unknown> = {}): PenEditEntry {
  num += 1;
  return parsePenEditEntry({
    id: `pe-20261125-100000-${String(num).padStart(3, '0')}`,
    kind,
    notePath: '/n.note',
    page,
    rect: {left: 1150, top, right: 1350, bottom: top + 40},
    ...extra,
  }) as PenEditEntry;
}

const items = [
  scanned(0, 100, 'First paragraph'),
  scanned(0, 300, 'Second paragraph', {id: 'chosen'}),
  scanned(1, 100, 'Page two paragraph'),
  scanned(1, 700, 'Set aside', {k: 'a'}),
  scanned(1, 900, 'Aside paragraph'),
];
const blocks = buildOutline(items, {}, {});
const key = (text: string) => blocks.find(block => block.text === text)?.key as string;

describe('notes.outline: counts per block', () => {
  type Case = {name: string; entries: PenEditEntry[]; expect: Record<string, string>};
  const CASES: Case[] = [
    {name: 'a comment beside the first paragraph', entries: [note('comment', 0, 150)], expect: {'First paragraph': 'C 1'}},
    {name: 'comments and an image on one paragraph', entries: [note('comment', 0, 320), note('comment', 0, 400), note('image', 0, 360)], expect: {'Second paragraph': 'C 2 ▣ 1'}},
    {name: 'below the last paragraph of a page: that one', entries: [note('image', 0, 600)], expect: {'Second paragraph': '▣ 1'}},
    {name: 'a chosen paragraph wins over the nearest', entries: [note('comment', 0, 150, {note: {paragraph: 'chosen'}})], expect: {'Second paragraph': 'C 1'}},
    {name: 'a chosen paragraph that is gone: the nearest', entries: [note('comment', 0, 150, {note: {paragraph: 'gone'}})], expect: {'First paragraph': 'C 1'}},
    {name: 'in the aside area: an aside paragraph', entries: [note('comment', 1, 920)], expect: {'Aside paragraph': 'C 1'}},
    {name: 'dropped notes and pen edits are not counted', entries: [note('comment', 0, 150, {state: 'dropped'}), parsePenEditEntry({id: 'pe-20261125-100000-999', kind: 'unpaired', notePath: '/n.note', page: 0, rect: {left: 0, top: 150, right: 10, bottom: 160}}) as PenEditEntry], expect: {}},
  ];

  it.each(CASES.map(item => [item.name, item] as const))('%s', (_name, item) => {
    const counts = noteCounts(blocks, item.entries);
    const shown = Object.fromEntries(blocks.filter(block => counts.has(block.key)).map(block => [block.text, noteCountLabel(counts.get(block.key), '▣')]));
    expect(shown).toEqual(item.expect);
  });
});

describe('notes.outline: sections and the planned line', () => {
  it('a block\'s file follows the dividers; the aside area has none', () => {
    const linked = buildOutline([scanned(0, 100, 'A.md', {k: 'f', s: 'A'}), scanned(0, 300, 'In A'), scanned(0, 500, 'Set aside', {k: 'a'})], {}, {});
    expect(blockCandidates(linked).map(item => `${item.region}:${item.file ?? ''}`)).toEqual(['text:A', 'text:A', 'aside:']);
  });

  it('says the comments stay only when a block with notes moves or is set aside', () => {
    const counts = noteCounts(blocks, [note('comment', 0, 150)]);
    expect(notesStayLine([key('First paragraph')], counts)).toBe('Its comments stay where they are (moving them comes later).');
    expect(notesStayLine([key('Second paragraph')], counts)).toBeNull();
  });
});
