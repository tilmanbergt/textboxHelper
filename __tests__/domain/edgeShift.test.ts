import {coveredSpan, edgeContext, insertModeAt, shiftSpans, type MeasuredWord} from '../../src/domain/edgeShift';
import {assembleMarkerPreview} from '../../src/domain/markerAssembly';
import type {MarkerPreviewBase, OperationDraft, PenTextState} from '../../src/domain/markerTypes';

describe('shiftSpans', () => {
  const span = (start: number, end: number, shift: number[] | null = null, zeroLength = false) => ({
    start,
    end,
    shift,
    zeroLength,
  });

  it('grows and shrinks a span by characters, inside the text', () => {
    expect(shiftSpans(40, [span(14, 20, [0, 1])])).toEqual([{start: 14, end: 21}]);
    expect(shiftSpans(40, [span(14, 20, [2, -1])])).toEqual([{start: 16, end: 19}]);
    expect(shiftSpans(40, [span(1, 39, [-5, 5])])).toEqual([{start: 0, end: 40}]);
    // The end never passes the start.
    expect(shiftSpans(40, [span(14, 16, [0, -9])])).toEqual([{start: 14, end: 14}]);
  });

  it('moves a zero-length change as one', () => {
    expect(shiftSpans(40, [span(10, 10, [-2], true)])).toEqual([{start: 8, end: 8}]);
    expect(shiftSpans(40, [span(10, 10, [50], true)])).toEqual([{start: 40, end: 40}]);
  });

  it('keeps spans from running into each other, in the order given', () => {
    expect(shiftSpans(40, [span(20, 25, [-6, 0]), span(10, 15, [0, 3])])).toEqual([
      {start: 18, end: 25},
      {start: 10, end: 18},
    ]);
  });
});

describe('insertModeAt', () => {
  it('is inside a word only between two letters', () => {
    expect(insertModeAt('This can feel', 7, 'betweenWords')).toBe('inWord');
    expect(insertModeAt('This can feel', 8, 'inWord')).toBe('betweenWords');
    expect(insertModeAt('Größe', 2, 'betweenWords')).toBe('inWord');
    expect(insertModeAt('This can', 0, 'inWord')).toBe('betweenWords');
  });

  it('keeps paragraph insertions', () => {
    expect(insertModeAt('This can', 3, 'paragraph')).toBe('paragraph');
    expect(insertModeAt('This can', 3, 'blankLine')).toBe('blankLine');
  });
});

describe('edgeContext', () => {
  it('shows a few characters on each side, line breaks as ¶', () => {
    expect(edgeContext('This can feel humble,\nbut not', 21, 6)).toEqual({before: 'umble,', after: '¶but n'});
    expect(edgeContext('abc', 0)).toEqual({before: '', after: 'abc'});
  });
});

describe('coveredSpan', () => {
  // "humble," drawn from x 300 to 440: 7 characters of 20 px; the comma is the last 20 px.
  const words: MeasuredWord[] = [
    {start: 14, end: 21, text: 'humble,', absoluteLeft: 300, absoluteRight: 440},
  ];

  it('keeps a comma the stroke did not reach', () => {
    expect(coveredSpan(words, 290, 420)).toEqual({start: 14, end: 20});
  });

  it('takes the comma when the stroke reaches past its middle', () => {
    expect(coveredSpan(words, 290, 435)).toEqual({start: 14, end: 21});
  });

  it('keeps an opening quote the stroke started after', () => {
    const quoted: MeasuredWord[] = [{start: 0, end: 6, text: '„Hallo', absoluteLeft: 100, absoluteRight: 220}];
    expect(coveredSpan(quoted, 130, 230)).toEqual({start: 1, end: 6});
    expect(coveredSpan(quoted, 95, 230)).toEqual({start: 0, end: 6});
  });

  it('never trims a word that is only punctuation', () => {
    expect(coveredSpan([{start: 5, end: 6, text: ',', absoluteLeft: 0, absoluteRight: 10}], 4, 6)).toEqual({
      start: 5,
      end: 6,
    });
    expect(coveredSpan([], 0, 1)).toBeNull();
  });
});

describe('assembly with edge nudges', () => {
  const TEXT = 'This can feel humble but not because';
  const textbox = {
    uuid: 'tb',
    numInPage: 2,
    layerNum: 0,
    originalText: TEXT,
    textRect: {left: 0, top: 0, right: 900, bottom: 100},
    fontSize: 36,
    fontPath: null,
    textAlign: 0,
    textBold: 0,
    textItalics: 0,
    textFrameWidthType: 0,
    textFrameStyle: 0,
    textEditable: 0,
  };
  const deleteDraft: OperationDraft = {
    range: {kind: 'delete', start: 14, end: 20},
    operation: {
      id: 'd',
      kind: 'delete',
      markerUuid: 'd',
      markerNumInPage: 4,
      consumedMarkerNums: [4],
      targetTextboxUuid: 'tb',
      targetTextboxNumInPage: 2,
      lineIndex: 0,
      summary: '',
      detail: '',
      words: ['humble'],
      textStart: 14,
    },
  };
  const insertDraft: OperationDraft = {
    range: {kind: 'replace', start: 9, end: 9},
    operation: {
      ...deleteDraft.operation,
      id: 'insert:pe1',
      kind: 'insert',
      consumedMarkerNums: [],
      words: [],
      textStart: 9,
      penEditId: 'pe1',
      penEditNumber: 1,
      insertMode: 'betweenWords',
    },
  };
  const base = (drafts: OperationDraft[]): MarkerPreviewBase => ({
    notePath: '/n.note',
    page: 1,
    drafts,
    ignored: [],
    textboxes: [textbox],
    insertions: [],
    penEdits: [],
    penStates: {},
  });
  const ready = (edges: PenTextState['edges'] = null): PenTextState => ({
    status: 'done',
    text: 'quite',
    correctedText: null,
      edges,
  });

  it('applies a plain mark nudged one character further', () => {
    const preview = assembleMarkerPreview(base([deleteDraft]), {}, null, {d: [-1, 0]});
    expect(preview.applyPlan?.textMutations[0].nextText).toBe('This can feel but not because');
    expect(preview.operations[0].edgeView?.edges.map(edge => edge.label)).toEqual(['Start', 'End']);
    expect(preview.operations[0].edgeView?.edges[0]).toEqual({label: 'Start', before: 's can feel', after: ' humble bu'});
    expect(preview.operations[0].textStart).toBe(13);
  });

  it('moves an insertion with its stored nudge and joins it again at the new place', () => {
    const between = assembleMarkerPreview(base([insertDraft]), {pe1: ready()});
    expect(between.applyPlan?.textMutations[0].nextText).toBe('This can quite feel humble but not because');
    const inside = assembleMarkerPreview(base([insertDraft]), {pe1: ready([-2])});
    expect(inside.operations[0].edgeView?.edges.map(edge => edge.label)).toEqual(['Place']);
    expect(inside.operations[0].insertMode).toBe('inWord');
    expect(inside.applyPlan?.textMutations[0].nextText).toBe('This caquiten feel humble but not because');
    expect(inside.operations[0].edgeView?.result).toContain('caquiten');
  });
});
