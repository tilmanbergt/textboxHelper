import {notePlace, parsePenEditEntry, type PenEditEntry} from '../../src/domain/penEditModel';

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
