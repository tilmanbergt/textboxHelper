import type {ManuscriptEntry} from '../../src/domain/manuscriptPages';
import type {RecognizedEditOperation} from '../../src/domain/markerTypes';
import {chipLabel, type NoteEntry} from '../../src/domain/manuscriptPages';
import type {EditMarkerPreview} from '../../src/domain/markerTypes';
import type {NoteRow} from '../../src/domain/notes/noteRows';
import {noteIsDone, notesList, rowMarker, splitReviewLists} from '../../src/domain/reviewLists';

/** The Review's two lists of changes (technical-design-mark-dialogue.md §13.5). */

function entry(key: string, page: number, operation: Partial<RecognizedEditOperation>): ManuscriptEntry {
  return {
    key,
    page,
    hunk: {operationId: key, label: '', meta: '', before: '', segments: [], after: ''},
    operation: {kind: 'delete', id: key, ...operation} as RecognizedEditOperation,
  };
}

describe('the Review lists New text and Marks', () => {
  const entries = [
    entry('d1', 0, {kind: 'delete'}),
    entry('r3', 0, {kind: 'replace', penEditId: 'pe3', penEditNumber: 3}),
    entry('s', 0, {kind: 'swap'}),
    entry('i1', 0, {kind: 'insert', penEditId: 'pe1', penEditNumber: 1}),
    entry('i2', 1, {kind: 'insert', penEditId: 'pe9', penEditNumber: 1}),
    entry('q', 0, {kind: 'replace', penEditId: 'peq'}),
  ];

  it('puts changes with tagged text in New text, by page and number on the page, "?" last', () => {
    expect(splitReviewLists(entries).text.map(item => item.key)).toEqual(['i1', 'r3', 'q', 'i2']);
  });

  it('keeps the other changes in Marks, in reading order', () => {
    expect(splitReviewLists(entries).marks.map(item => item.key)).toEqual(['d1', 's']);
  });

  it('circles only the number on the page; marks get a symbol for their kind', () => {
    expect(rowMarker(entries[1])).toEqual({circled: true, text: '3'});
    expect(rowMarker(entries[5])).toEqual({circled: true, text: '?'});
    expect(rowMarker(entries[0])).toEqual({circled: false, text: '−'});
    expect(rowMarker(entries[2])).toEqual({circled: false, text: '⇄'});
  });
});

describe('the Review list Notes (technical-design-comments-images.md §5.2)', () => {
  const noteEntry = (key: string, page: number, number: number | null, kind: 'comment' | 'image' = 'comment', done = false): NoteEntry => ({
    key,
    page,
    row: {
      id: key,
      kind,
      page,
      rect: {left: 0, top: 0, right: 1, bottom: 1},
      note: done ? {done: true} : {},
      paragraph: number === null ? {none: true, reason: ''} : {uuid: 'u', blockId: null, by: 'nearest'},
      at: number === null ? null : {uuid: 'u', page, number, words: '', rect: {left: 0, top: 0, right: 1, bottom: 1}},
      pictureUri: null,
    } as NoteRow,
  });

  it('by page, then by paragraph, no paragraph last', () => {
    const list = [noteEntry('c', 1, 1), noteEntry('b', 0, null), noteEntry('a', 0, 2), noteEntry('z', 0, 1)];
    expect(notesList(list).map(item => item.key)).toEqual(['z', 'a', 'b', 'c']);
  });

  it('a comment checked off stays in the list, greyed; an image is never done', () => {
    expect(noteIsDone(noteEntry('a', 0, 1, 'comment', true))).toBe(true);
    expect(noteIsDone(noteEntry('b', 0, 1, 'image', true))).toBe(false);
  });

  it('the page strip counts notes after the changes', () => {
    const read = (hunks: number, notes: number) => ({
      state: 'read' as const,
      preview: {hunks: Array(hunks).fill({}), toDecide: [], base: {notes: Array(notes).fill({})}} as unknown as EditMarkerPreview,
    });
    expect(chipLabel(2, read(3, 2))).toBe('p.3 · 3 · 2 notes');
    expect(chipLabel(2, read(0, 1))).toBe('p.3 · 1 note');
    expect(chipLabel(2, read(0, 0))).toBe('p.3 ✓');
  });
});
