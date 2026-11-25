import {
  canConvertSidemark,
  convertSidemarkEntry,
  notePlace,
  parsePenEditEntry,
  type PenEditEntry,
  type SidemarkKind,
} from '../../src/domain/penEditModel';

/**
 * Do comment and image entries parse (technical-design-comments-images.md §2.1)? One row per
 * stored shape: its kind, number, mark and note as read.
 */

const stored = {
  id: 'pe-20261125-100000-001',
  notePath: '/n.note',
  page: 0,
  rect: {left: 600, top: 300, right: 900, bottom: 360},
  iconRect: {left: 544, top: 306, right: 592, bottom: 354},
};
const strike = {kind: 'replace', strikeRect: {left: 0, top: 0, right: 100, bottom: 6}, modifierRects: []};

type Case = {
  name: string;
  value: Record<string, unknown>;
  expect: Partial<Pick<PenEditEntry, 'kind' | 'number' | 'mark' | 'note'>> & {noteMissing?: true};
};

const CASES: Case[] = [
  {name: 'a comment with no note info: defaults', value: {kind: 'comment'}, expect: {kind: 'comment', number: null, mark: null, note: {}}},
  {name: 'an image placed before its paragraph', value: {kind: 'image', note: {place: 'before', paragraph: 'b-1'}}, expect: {kind: 'image', note: {place: 'before', paragraph: 'b-1'}}},
  {name: 'a comment checked off', value: {kind: 'comment', note: {done: true}}, expect: {note: {done: true}}},
  {name: 'a note never has a number', value: {kind: 'comment', number: 3}, expect: {number: null}},
  {name: 'a note never has a mark', value: {kind: 'image', mark: strike}, expect: {mark: null}},
  {name: 'unreadable note info is left out', value: {kind: 'image', note: {place: 'left', paragraph: 7, done: 'yes'}}, expect: {note: {}}},
  {name: 'note info is only read on notes', value: {kind: 'unpaired', note: {done: true}}, expect: {kind: 'unpaired', noteMissing: true}},
  {name: 'an unknown kind is read as text without a mark', value: {kind: 'drawing', number: 2}, expect: {kind: 'unpaired', number: null}},
  {name: 'a missing kind is read as text without a mark', value: {}, expect: {kind: 'unpaired'}},
];

describe('notes.model: comment and image entries', () => {
  it.each(CASES.map(item => [item.name, item] as const))('%s', (_name, item) => {
    const entry = parsePenEditEntry({...stored, ...item.value});
    expect(entry).not.toBeNull();
    const {noteMissing, ...fields} = item.expect;
    expect(entry).toMatchObject(fields);
    if (noteMissing) {
      expect(entry?.note).toBeUndefined();
    }
  });

  it('an image goes after its paragraph unless the user chose before', () => {
    expect(notePlace({note: {}})).toBe('after');
    expect(notePlace({})).toBe('after');
    expect(notePlace({note: {place: 'before'}})).toBe('before');
  });
});

/** Does a sidemark change between "?", comment and image (§3.3), and what does it keep? */
describe('notes.model: converting a sidemark', () => {
  const read = (value: Record<string, unknown>) => parsePenEditEntry({...stored, ...value}) as PenEditEntry;
  type Step = {name: string; from: Record<string, unknown>; to: SidemarkKind; expect: Partial<PenEditEntry> & {noNote?: true}};
  const STEPS: Step[] = [
    {name: '"?" -> comment', from: {kind: 'unpaired'}, to: 'comment', expect: {kind: 'comment', number: null, note: {}}},
    {name: '"?" -> image', from: {kind: 'unpaired'}, to: 'image', expect: {kind: 'image', note: {}}},
    {name: 'comment -> "?": the note goes', from: {kind: 'comment', note: {done: true, paragraph: 'b-1'}}, to: 'unpaired', expect: {kind: 'unpaired', noNote: true}},
    {name: 'comment -> image keeps the paragraph, not Done', from: {kind: 'comment', note: {done: true, paragraph: 'b-1'}}, to: 'image', expect: {kind: 'image', note: {paragraph: 'b-1'}}},
    {name: 'image -> comment keeps the paragraph, not the place', from: {kind: 'image', note: {place: 'before', paragraph: 'b-2'}}, to: 'comment', expect: {kind: 'comment', note: {paragraph: 'b-2'}}},
    {name: 'a waiting "?" stops waiting', from: {kind: 'unpaired', awaitingMark: {since: '2026-11-25T10:00:00.000Z', from: 'tag'}}, to: 'comment', expect: {awaitingMark: null}},
    {name: '"Insert right here" is forgotten', from: {kind: 'insertion', placement: 'here'}, to: 'image', expect: {kind: 'image'}},
  ];

  it.each(STEPS.map(item => [item.name, item] as const))('%s', (_name, item) => {
    const before = read(item.from);
    expect(canConvertSidemark(before)).toBe(true);
    const after = convertSidemarkEntry(before, item.to);
    const {noNote, ...fields} = item.expect;
    expect(after).toMatchObject(fields);
    expect(after.strokeRects).toBe(before.strokeRects);
    if (noNote) {
      expect(after.note).toBeUndefined();
    }
    expect(after.placement).toBeUndefined();
    expect(parsePenEditEntry(JSON.parse(JSON.stringify(after)))).toEqual(after);
  });

  it('round trip "?" -> comment -> image -> "?" ends as it began', () => {
    const start = read({kind: 'unpaired'});
    const back = convertSidemarkEntry(convertSidemarkEntry(convertSidemarkEntry(start, 'comment'), 'image'), 'unpaired');
    expect(back).toEqual(start);
  });

  it.each([
    ['linked text (a number on the page)', {kind: 'replacement', number: 2, mark: strike}],
    ['applied text', {kind: 'unpaired', state: 'applied'}],
  ])('%s stays as it is', (_name, value) => {
    expect(canConvertSidemark(read(value))).toBe(false);
  });
});
