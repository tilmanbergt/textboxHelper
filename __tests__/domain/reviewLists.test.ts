import type {ManuscriptEntry} from '../../src/domain/manuscriptPages';
import type {RecognizedEditOperation} from '../../src/domain/markerTypes';
import {rowMarker, splitReviewLists} from '../../src/domain/reviewLists';

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
