import {formatBlockTag, parseBlockTag} from '../../src/domain/blockTag';
import {
  NO_PARAGRAPH,
  paragraphOf,
  sectionAt,
  sectionsOf,
  type NoteAt,
  type ParagraphCandidate,
} from '../../src/domain/notes/paragraphOf';
import {box, note} from './build';

/**
 * Which paragraph does a comment or image belong to (technical-design-comments-images.md §4)?
 * Same page, same region, same linked file; the most height overlap, else the nearest above,
 * else the nearest below; headings count; a stored choice wins while its block is there.
 */

type Case = {
  name: string;
  note: NoteAt;
  textboxes: ParagraphCandidate[];
  stored?: string;
  expect: {uuid: string; by: 'stored' | 'nearest'; gone?: true} | {none: true; gone?: true};
};

const p1 = box('p1', 200, 400);
const p2 = box('p2', 450, 700);
const p3 = box('p3', 750, 900);
const heading = box('h', 100, 160);

const CASES: Case[] = [
  {name: 'beside a paragraph: the one it overlaps', note: note(500, 560), textboxes: [p1, p2, p3], expect: {uuid: 'p2', by: 'nearest'}},
  {name: 'overlapping two: the one it overlaps most', note: note(380, 470), textboxes: [p1, p2], expect: {uuid: 'p1', by: 'nearest'}},
  {name: 'below a paragraph, in the gap: the one above', note: note(405, 445), textboxes: [p1, p2], expect: {uuid: 'p1', by: 'nearest'}},
  {name: 'below the last paragraph: the last one', note: note(950, 1000), textboxes: [p1, p2, p3], expect: {uuid: 'p3', by: 'nearest'}},
  {name: 'above the first paragraph: the first one', note: note(20, 80), textboxes: [p1, p2], expect: {uuid: 'p1', by: 'nearest'}},
  {name: 'a heading counts as a paragraph', note: note(110, 150), textboxes: [heading, p1], expect: {uuid: 'h', by: 'nearest'}},
  {name: 'between a heading and its paragraph: the heading above', note: note(165, 195), textboxes: [heading, p1], expect: {uuid: 'h', by: 'nearest'}},
  {name: 'only on its own page', note: note(500, 560, {page: 1}), textboxes: [p2, box('q', 600, 700, {page: 1})], expect: {uuid: 'q', by: 'nearest'}},
  {name: 'no paragraph on the page', note: note(500, 560, {page: 2}), textboxes: [p1, p2], expect: {none: true}},
  {
    name: 'in the aside area: an aside paragraph, never the text above it',
    note: note(820, 860, {region: 'aside'}),
    textboxes: [p1, p2, box('a', 800, 900, {region: 'aside'})],
    expect: {uuid: 'a', by: 'nearest'},
  },
  {
    name: 'in the text: never a paragraph of the aside area beside it',
    note: note(820, 860),
    textboxes: [p1, box('a', 800, 900, {region: 'aside'})],
    expect: {uuid: 'p1', by: 'nearest'},
  },
  {
    name: 'linked note with two files: only its own file',
    note: note(820, 860, {file: 'B'}),
    textboxes: [box('a1', 200, 400, {file: 'A'}), box('a2', 800, 900, {file: 'A'}), box('b1', 500, 700, {file: 'B'})],
    expect: {uuid: 'b1', by: 'nearest'},
  },
  {name: 'stored choice wins over the nearest', note: note(500, 560), textboxes: [p1, p2, p3], stored: 'b-p3', expect: {uuid: 'p3', by: 'stored'}},
  {name: 'stored choice on another page', note: note(500, 560), textboxes: [p2, box('x', 100, 200, {page: 1})], stored: 'b-x', expect: {uuid: 'x', by: 'stored'}},
  {name: 'stored choice gone: the nearest, said so', note: note(500, 560), textboxes: [p1, p2], stored: 'b-deleted', expect: {uuid: 'p2', by: 'nearest', gone: true}},
  {name: 'stored choice gone and no paragraph left', note: note(500, 560, {page: 3}), textboxes: [p1], stored: 'b-deleted', expect: {none: true, gone: true}},
];

describe('notes.paragraph: which paragraph a note belongs to', () => {
  it.each(CASES.map(item => [item.name, item] as const))('%s', (_name, item) => {
    const result = paragraphOf(item.note, item.textboxes, item.stored);
    if ('none' in item.expect) {
      expect(result).toEqual({none: true, reason: NO_PARAGRAPH, ...(item.expect.gone ? {gone: true} : {})});
    } else {
      expect(result).toMatchObject({uuid: item.expect.uuid, by: item.expect.by});
      expect('gone' in result && result.gone).toBe(item.expect.gone ?? false);
    }
  });
});

describe('notes.paragraph: a note\'s region and file follow position', () => {
  const tag = (value: object | null) => (value ? parseBlockTag(formatBlockTag({v: 1, id: 'x', ...value})) : null);

  it.each([
    ['plain text', [null, null], {region: 'text', file: null}, ['text:', 'text:']],
    ['a file divider starts its file', [null, {k: 'f', s: 'A'}, null], {region: 'text', file: null}, ['text:', 'text:A', 'text:A']],
    ['the next divider starts the next file', [{k: 'f', s: 'A'}, null, {k: 'f', s: 'B'}, null], {region: 'text', file: null}, ['text:A', 'text:A', 'text:B', 'text:B']],
    ['the aside divider ends every file', [{k: 'f', s: 'A'}, {k: 'a'}, {k: 'f', s: 'B'}], {region: 'text', file: null}, ['text:A', 'aside:', 'aside:']],
    ['a page starts in the section it carries', [null, null], {region: 'aside', file: null}, ['aside:', 'aside:']],
  ] as const)('%s', (_name, tags, carry, expected) => {
    const sections = sectionsOf(tags.map(value => tag(value)), carry);
    expect(sections.map(section => `${section.region}:${section.file ?? ''}`)).toEqual(expected);
  });

  it.each([
    ['beside a paragraph of file B: B', note(520, 560), {region: 'text', file: 'B'}],
    ['above every textbox of the page: the first one\'s', note(20, 60), {region: 'text', file: 'A'}],
    ['below the aside divider: the aside area', note(950, 990), {region: 'aside', file: null}],
  ] as const)('%s', (_name, at, expected) => {
    const textboxes = [box('a', 100, 300, {file: 'A'}), box('b', 500, 700, {file: 'B'}), box('d', 900, 940, {region: 'aside'})];
    expect(sectionAt(at, textboxes, {region: 'text', file: null})).toEqual(expected);
  });
});
