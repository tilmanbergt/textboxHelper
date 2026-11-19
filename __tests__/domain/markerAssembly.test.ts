import {SPLIT_SIGN} from '../../src/domain/paragraphMarks';
import {assembleMarkerPreview, penOperationStatus} from '../../src/domain/markerAssembly';
import type {MarkerPreviewBase, OperationDraft, PenTextState} from '../../src/domain/markerTypes';

const TEXT = 'This can feel humble, but not because';

const textbox = {
  uuid: 'tb',
  numInPage: 2,
  layerNum: 0,
  originalText: TEXT,
  textRect: {left: 144, top: 155, right: 1248, bottom: 372},
  fontSize: 36,
  fontPath: null,
  textAlign: 0,
  textBold: 0,
  textItalics: 0,
  textFrameWidthType: 0,
  textFrameStyle: 0,
  textEditable: 0,
};

const draft = (id: string, start: number, end: number, extra: Partial<OperationDraft['operation']> = {}): OperationDraft => ({
  range: {kind: extra.penEditId ? 'replace' : 'delete', start, end},
  operation: {
    id,
    kind: extra.penEditId ? 'replace' : 'delete',
    markerUuid: id,
    markerNumInPage: extra.markerNumInPage ?? 4,
    consumedMarkerNums: extra.consumedMarkerNums ?? [4],
    targetTextboxUuid: 'tb',
    targetTextboxNumInPage: 2,
    lineIndex: 0,
    summary: '',
    detail: '',
    words: [TEXT.slice(start, end)],
    textStart: start,
    ...extra,
  },
});

const replaceDraft = draft('r', 14, 21, {penEditId: 'pe1', penEditNumber: 1, consumedMarkerNums: [4, 5, 6]});

const base = (overrides: Partial<MarkerPreviewBase> = {}): MarkerPreviewBase => ({
  notePath: '/n.note',
  page: 17,
  selectedMarkerCount: 3,
  selectedTextboxCount: 0,
  drafts: [replaceDraft],
  ignored: [],
  textboxes: [textbox],
  replacementSourceTextboxNums: [],
  insertions: [],
  penEdits: [{id: 'pe1', kind: 'replacement', number: 1, pictureUri: null}],
  penStates: {},
  ...overrides,
});

const state = (overrides: Partial<PenTextState> = {}): PenTextState => ({
  status: 'done',
  text: 'proud',
  correctedText: null,
  review: 'open',
  ...overrides,
});

describe('penOperationStatus', () => {
  it('follows recognition, correction and skip', () => {
    expect(penOperationStatus(undefined)).toBe('recognizing');
    expect(penOperationStatus(state({status: 'waiting', text: ''}))).toBe('recognizing');
    expect(penOperationStatus(state())).toBe('ready');
    expect(penOperationStatus(state({text: ' '}))).toBe('empty');
    expect(penOperationStatus(state({status: 'failed', text: ''}))).toBe('failed');
    expect(penOperationStatus(state({status: 'failed', correctedText: 'fixed'}))).toBe('ready');
    expect(penOperationStatus(state({review: 'skipped'}))).toBe('skipped');
  });
});

describe('assembleMarkerPreview', () => {
  it('shows a placeholder and applies nothing while a replacement is recognized', () => {
    const preview = assembleMarkerPreview(base(), {pe1: state({status: 'recognizing', text: ''})});
    expect(preview.operations[0].penStatus).toBe('recognizing');
    expect(preview.textboxes[0].segments).toEqual([
      {text: 'This can feel '},
      {text: 'humble,', style: 'removed'},
      {text: ' ‹replacement 1 being recognized…›', style: 'muted'},
      {text: ' but not because'},
    ]);
    expect(preview.applyPlan).toBeNull();
    expect(preview.pendingCount).toBe(1);
  });

  it('applies a recognized replacement and removes its mark', () => {
    const preview = assembleMarkerPreview(base(), {pe1: state()});
    expect(preview.applyPlan?.textMutations[0].nextText).toBe('This can feel proud but not because');
    expect(preview.applyPlan?.recognizedMarkerNums).toEqual([4, 5, 6]);
    expect(preview.applyPlan?.penEditIds).toEqual(['pe1']);
    expect(preview.textboxes[0].segments).toContainEqual({text: ' proud', style: 'inserted'});
  });

  it('takes the correction over the recognized text', () => {
    const preview = assembleMarkerPreview(base(), {pe1: state({correctedText: 'modest,'})});
    expect(preview.applyPlan?.textMutations[0].nextText).toBe('This can feel modest, but not because');
  });

  it('keeps a skipped replacement and its marks for later, but applies the rest', () => {
    const preview = assembleMarkerPreview(base({drafts: [replaceDraft, draft('d', 26, 29, {consumedMarkerNums: [9]})]}), {
      pe1: state({review: 'skipped'}),
    });
    expect(preview.applyPlan?.textMutations[0].nextText).toBe('This can feel humble, but because');
    expect(preview.applyPlan?.recognizedMarkerNums).toEqual([9]);
    expect(preview.applyPlan?.penEditIds).toEqual([]);
    expect(preview.skippedCount).toBe(1);
  });

  it('adds a ready gap insertion as a new paragraph', () => {
    const insertionBase = base({
      drafts: [],
      textboxes: [],
      insertions: [
        {
          penEditId: 'pe2',
          number: 2,
          left: 144,
          width: 1104,
          style: {...textbox, textContentFull: TEXT},
          aboveNumInPage: 2,
          belowNumInPage: 17,
          aboveRect: {left: 144, top: 155, right: 1248, bottom: 372},
          belowRect: {left: 144, top: 400, right: 1248, bottom: 500},
        },
      ],
      penEdits: [{id: 'pe2', kind: 'insertion', number: 2, pictureUri: null}],
    });
    const waiting = assembleMarkerPreview(insertionBase, {});
    expect(waiting.operations[0]).toMatchObject({kind: 'insert', penStatus: 'recognizing'});
    expect(waiting.textboxes[0].title).toBe('New paragraph after textbox 2');
    expect(waiting.applyPlan).toBeNull();

    const ready = assembleMarkerPreview(insertionBase, {pe2: state({text: 'A new thought.'})});
    expect(ready.applyPlan?.insertions).toEqual([
      expect.objectContaining({penEditId: 'pe2', text: 'A new thought.', aboveRect: insertionBase.insertions[0].aboveRect}),
    ]);
    expect(ready.applyPlan?.textMutations).toEqual([]);
  });

  it('puts a caret insertion into the paragraph with the spaces it needs', () => {
    // Caret after "humble," (offset 21): the text goes in before " but".
    const caretDraft: OperationDraft = {
      range: {kind: 'replace', start: 21, end: 21},
      operation: {
        id: 'insert:pe3',
        kind: 'insert',
        markerUuid: 'pe3',
        markerNumInPage: 0,
        consumedMarkerNums: [],
        targetTextboxUuid: 'tb',
        targetTextboxNumInPage: 2,
        lineIndex: 0,
        summary: '',
        detail: '',
        words: [],
        textStart: 21,
        penEditId: 'pe3',
        penEditNumber: 3,
        insertMode: 'betweenWords',
      },
    };
    const caretBase = base({drafts: [caretDraft], penEdits: [{id: 'pe3', kind: 'insertion', number: 3, pictureUri: null}]});

    const waiting = assembleMarkerPreview(caretBase, {});
    expect(waiting.applyPlan).toBeNull();
    expect(waiting.textboxes[0].segments.some(segment => segment.style === 'muted')).toBe(true);

    const ready = assembleMarkerPreview(caretBase, {pe3: state({text: 'even proud'})});
    expect(ready.applyPlan?.textMutations[0].nextText).toBe('This can feel humble, even proud but not because');
    expect(ready.applyPlan?.penEditIds).toEqual(['pe3']);
    expect(ready.operations[0].summary).toBe('Insert "even proud"');
  });

  it('puts a caret insertion inside a word as written', () => {
    const inWord: OperationDraft = {
      range: {kind: 'replace', start: 18, end: 18},
      operation: {...draft('i', 18, 18).operation, kind: 'insert', id: 'insert:pe4', penEditId: 'pe4', penEditNumber: 4, consumedMarkerNums: [], insertMode: 'inWord'},
    };
    const ready = assembleMarkerPreview(base({drafts: [inWord]}), {pe4: state({text: 'b'})});
    expect(ready.applyPlan?.textMutations[0].nextText).toBe('This can feel humbble, but not because');
  });

  it('makes a paragraph break on its own a split sign, shown as a paragraph end', () => {
    const split: OperationDraft = {
      range: {kind: 'replace', start: 22, end: 22},
      operation: {...draft('s', 22, 22).operation, kind: 'split', id: 'split:m', consumedMarkerNums: [41]},
    };
    const preview = assembleMarkerPreview(base({drafts: [split]}), {});
    expect(preview.applyPlan?.textMutations[0].nextText).toBe(`This can feel humble, ${SPLIT_SIGN}but not because`);
    expect(preview.applyPlan?.recognizedMarkerNums).toEqual([41]);
    expect(preview.textboxes[0].segments.map(segment => segment.text).join('')).toContain('¶\n');
  });

  it('puts an insertion at a paragraph caret between two split signs', () => {
    const caret: OperationDraft = {
      range: {kind: 'replace', start: 22, end: 22},
      operation: {
        ...draft('p', 22, 22).operation,
        kind: 'insert',
        id: 'insert:pe9',
        penEditId: 'pe9',
        penEditNumber: 9,
        consumedMarkerNums: [],
        insertMode: 'paragraph',
      },
    };
    const ready = assembleMarkerPreview(base({drafts: [caret]}), {pe9: state({text: 'A new thought.'})});
    expect(ready.applyPlan?.textMutations[0].nextText).toBe(
      `This can feel humble, ${SPLIT_SIGN}A new thought.${SPLIT_SIGN}but not because`,
    );
    const waiting = assembleMarkerPreview(base({drafts: [caret]}), {});
    expect(waiting.applyPlan).toBeNull();
  });

  it('hides marker strokes used by a change from Ignored, but keeps ignored pen edits', () => {
    const preview = assembleMarkerPreview(
      base({
        ignored: [
          {markerUuid: 'v', markerNumInPage: 5, summary: '', reason: 'too short'},
          {markerUuid: 'x', markerNumInPage: 30, summary: '', reason: 'too short'},
          {markerUuid: 'pe9', markerNumInPage: 0, summary: 'Replacement 9', reason: 'no mark', penEditNumber: 9, penEditId: 'pe9'},
        ],
      }),
      {pe1: state()},
    );
    expect(preview.ignoredMarkers.map(marker => marker.markerUuid)).toEqual(['x', 'pe9']);
  });
});
