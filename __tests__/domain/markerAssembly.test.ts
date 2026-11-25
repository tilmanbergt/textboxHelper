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
  drafts: [replaceDraft],
  toDecide: [],
  markPoints: {},
  textboxes: [textbox],
  insertions: [],
  penEdits: [{id: 'pe1', kind: 'replacement', number: 1, pictureUri: null}],
  penStates: {},
  ...overrides,
});

const state = (overrides: Partial<PenTextState> = {}): PenTextState => ({
  status: 'done',
  text: 'proud',
  correctedText: null,
  edges: null,
  ...overrides,
});

describe('penOperationStatus', () => {
  it('follows recognition and correction', () => {
    expect(penOperationStatus(undefined)).toBe('recognizing');
    expect(penOperationStatus(state({status: 'waiting', text: ''}))).toBe('recognizing');
    expect(penOperationStatus(state())).toBe('ready');
    expect(penOperationStatus(state({text: ' '}))).toBe('empty');
    expect(penOperationStatus(state({status: 'failed', text: ''}))).toBe('failed');
    expect(penOperationStatus(state({status: 'failed', correctedText: 'fixed'}))).toBe('ready');
  });
});

describe('assembleMarkerPreview', () => {
  it('shows a placeholder and applies nothing while a replacement is recognized', () => {
    const preview = assembleMarkerPreview(base(), {pe1: state({status: 'recognizing', text: ''})});
    expect(preview.operations[0].penStatus).toBe('recognizing');
    expect(preview.hunks[0]).toMatchObject({
      label: 'Replace 1',
      before: 'This can feel ',
      segments: [
        {text: 'humble,', style: 'removed'},
        {text: ' ‹replacement 1 being recognized…›', style: 'muted'},
      ],
      after: ' but not because',
    });
    expect(preview.applyPlan).toBeNull();
    expect(preview.pendingCount).toBe(1);
  });

  it('applies a recognized replacement and removes its mark', () => {
    const preview = assembleMarkerPreview(base(), {pe1: state()});
    expect(preview.applyPlan?.textMutations[0].nextText).toBe('This can feel proud but not because');
    expect(preview.applyPlan?.recognizedMarkerNums).toEqual([4, 5, 6]);
    expect(preview.applyPlan?.penEditIds).toEqual(['pe1']);
    expect(preview.hunks[0].segments).toContainEqual({text: ' proud', style: 'inserted'});
  });

  it('takes the correction over the recognized text', () => {
    const preview = assembleMarkerPreview(base(), {pe1: state({correctedText: 'modest,'})});
    expect(preview.applyPlan?.textMutations[0].nextText).toBe('This can feel modest, but not because');
  });

  it('keeps a replacement without text and its marks for later, but applies the rest', () => {
    const preview = assembleMarkerPreview(base({drafts: [replaceDraft, draft('d', 26, 29, {consumedMarkerNums: [9]})]}), {
      pe1: state({status: 'failed', text: ''}),
    });
    expect(preview.applyPlan?.textMutations[0].nextText).toBe('This can feel humble, but because');
    expect(preview.applyPlan?.recognizedMarkerNums).toEqual([9]);
    expect(preview.applyPlan?.penEditIds).toEqual([]);
    expect(preview.pendingCount).toBe(1);
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
    expect(waiting.hunks[0]).toMatchObject({label: 'New paragraph 2', meta: 'After textbox 2'});
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
    expect(waiting.hunks[0].segments.some(segment => segment.style === 'muted')).toBe(true);

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
    expect(preview.hunks[0].segments.map(segment => segment.text).join('')).toContain('¶');
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

  it('hides an unclear mark whose strokes a change took along, but keeps pen edits', () => {
    const item = (key: string, kind: 'unclear' | 'placeOpen', strokeNums?: number[]) => ({
      kind,
      key,
      summary: '',
      reason: 'too short',
      rect: null,
      strokes: [],
      words: '',
      readings: [],
      guess: null,
      ...(strokeNums ? {strokeNums} : {penEditId: key}),
    });
    const preview = assembleMarkerPreview(
      base({toDecide: [item('v', 'unclear', [5]), item('x', 'unclear', [30]), item('pe9', 'placeOpen')]}),
      {pe1: state()},
    );
    expect(preview.toDecide.map(entry => entry.key)).toEqual(['x', 'pe9']);
  });
});

describe('swaps and spaces in the assembly', () => {
  // TEXT = 'This can feel humble, but not because'
  // "can feel" (5–13) ⇄ "humble," (14–21): A = "can feel", B = "humble,".
  const swapDraft: OperationDraft = {
    range: {kind: 'replace', start: 5, end: 21, replacementText: ''},
    operation: {
      id: 'swap:s',
      kind: 'swap',
      markerUuid: 's',
      markerNumInPage: 9,
      consumedMarkerNums: [9],
      targetTextboxUuid: 'tb',
      targetTextboxNumInPage: 2,
      lineIndex: 0,
      summary: 'Swap',
      detail: '',
      words: ['can feel', 'humble,'],
      textStart: 5,
      swap: {zones: {a0: 5, a1: 13, b0: 14, b1: 21}, fixCase: true, capsAvailable: false},
    },
  };
  const textOf = (preview: ReturnType<typeof assembleMarkerPreview>) =>
    preview.applyPlan?.textMutations[0]?.nextText;

  it('swaps on its own, punctuation staying in its slot', () => {
    const preview = assembleMarkerPreview(base({drafts: [swapDraft], penEdits: []}), {});
    expect(textOf(preview)).toBe('This humble can feel, but not because');
    expect(preview.operations[0].kind).toBe('swap');
    expect(preview.applyPlan?.recognizedMarkerNums).toEqual([9]);
  });

  it('makes a delete inside a part first, and marks it as inside the swap', () => {
    const deleteFeel = draft('d', 9, 13, {markerNumInPage: 7, consumedMarkerNums: [7]});
    const preview = assembleMarkerPreview(base({drafts: [deleteFeel, swapDraft], penEdits: []}), {});
    expect(textOf(preview)).toBe('This humble can, but not because');
    expect(preview.operations.find(op => op.id === 'd')?.insideSwap).toBe('swap:s');
    expect(preview.applyPlan?.recognizedMarkerNums.sort()).toEqual([7, 9]);
  });

  it('waits for a replacement inside it that is being recognized, then swaps with it', () => {
    const replaceHumble = draft('r', 14, 20, {penEditId: 'pe1', penEditNumber: 1, consumedMarkerNums: [4]});
    const waiting = assembleMarkerPreview(base({drafts: [replaceHumble, swapDraft]}), {});
    expect(waiting.operations.find(op => op.kind === 'swap')?.swap?.waitingFor).toEqual(['r']);
    expect(waiting.applyPlan).toBeNull();
    const ready = assembleMarkerPreview(base({drafts: [replaceHumble, swapDraft]}), {pe1: state()});
    expect(textOf(ready)).toBe('This proud can feel, but not because');
  });

  it('reports a conflict under Ignored and keeps the other change', () => {
    const crossing = draft('x', 10, 18, {markerNumInPage: 7, consumedMarkerNums: [7]});
    const preview = assembleMarkerPreview(base({drafts: [crossing, swapDraft], penEdits: []}), {});
    expect(preview.operations.map(op => op.kind)).toEqual(['delete']);
    expect(preview.toDecide[0].reason).toContain('reaches over an edge');
    expect(preview.toDecide[0].removableNums).toEqual([9]);
    expect(preview.toDecide[0].kind).toBe('unclear');
  });

  it('puts a space in at its place', () => {
    const space: OperationDraft = {
      range: {kind: 'replace', start: 4, end: 4, replacementText: ' '},
      operation: {...swapDraft.operation, id: 'space:c', kind: 'space', swap: undefined, consumedMarkerNums: [3]},
    };
    const preview = assembleMarkerPreview(
      base({drafts: [space], penEdits: [], textboxes: [{...textbox, originalText: 'Thiscan go'}]}),
      {},
    );
    expect(textOf(preview)).toBe('This can go');
  });

  it('moves the capital when asked, by the review choice', () => {
    const capital: OperationDraft = {
      ...swapDraft,
      range: {kind: 'replace', start: 0, end: 8, replacementText: ''},
      operation: {...swapDraft.operation, swap: {zones: {a0: 0, a1: 4, b0: 5, b1: 8}, fixCase: true, capsAvailable: false}},
    };
    const preview = assembleMarkerPreview(base({drafts: [capital], penEdits: []}), {});
    expect(textOf(preview)?.startsWith('Can this feel')).toBe(true);
    expect(preview.operations[0].swap?.capsAvailable).toBe(true);
    const off = assembleMarkerPreview(base({drafts: [capital], penEdits: []}), {}, null, {}, {'swap:s': {fixCase: false}});
    expect(textOf(off)?.startsWith('can This feel')).toBe(true);
  });

  it('moves its three edges: start of A, where the parts meet, end of B', () => {
    const swap = assembleMarkerPreview(base({drafts: [swapDraft], penEdits: []}), {});
    expect(swap.operations[0].edgeView?.edges.map(edge => edge.label)).toEqual(['Start of A', 'A | B', 'End of B']);
    // "can feel" ⇄ "humble," → one more word in A: "This can feel humble" stays, the meeting point
    // moves left to "can" ⇄ "feel humble,".
    const nudged = assembleMarkerPreview(base({drafts: [swapDraft], penEdits: []}), {}, null, {'swap:s': [0, -5, 0]});
    expect(textOf(nudged)).toBe('This feel humble can, but not because');
    expect(nudged.operations[0].swap?.zones).toEqual({a0: 5, a1: 8, b0: 9, b1: 21});
  });

  it('lists the swap with A struck, B as it is and A in bold at its new place', () => {
    const plain: OperationDraft = {
      ...swapDraft,
      operation: {...swapDraft.operation, swap: {zones: {a0: 5, a1: 8, b0: 9, b1: 13}, fixCase: false, capsAvailable: false}},
    };
    const preview = assembleMarkerPreview(base({drafts: [plain], penEdits: []}), {});
    expect(preview.hunks[0]).toMatchObject({
      label: 'Swap',
      before: 'This ',
      segments: [
        {text: 'can', style: 'removed'},
        {text: ' feel'},
        {text: ' can', style: 'inserted'},
      ],
      after: ' humble, but not because',
    });
  });
});

describe('hunks', () => {
  it('lists changes in reading order, also when drafts come out of order', () => {
    const preview = assembleMarkerPreview(
      base({drafts: [draft('late', 26, 29, {consumedMarkerNums: [9]}), draft('early', 5, 8, {consumedMarkerNums: [8]})], penEdits: []}),
      {},
    );
    expect(preview.hunks.map(hunk => hunk.operationId)).toEqual(['early', 'late']);
    expect(preview.hunks[1]).toMatchObject({
      label: 'Delete',
      before: 'This can feel humble, but ',
      segments: [{text: 'not', style: 'removed'}],
      after: ' because',
      meta: 'Textbox 2 · line 1',
    });
  });

  it('puts a new paragraph right after the textbox above it', () => {
    const second = {...textbox, uuid: 'tb2', numInPage: 5, textRect: {left: 144, top: 600, right: 1248, bottom: 700}};
    const preview = assembleMarkerPreview(
      base({
        drafts: [
          draft('below', 0, 4, {targetTextboxUuid: 'tb2', targetTextboxNumInPage: 5, consumedMarkerNums: [11]}),
          draft('above', 5, 8, {consumedMarkerNums: [8]}),
        ],
        textboxes: [textbox, second],
        insertions: [
          {
            penEditId: 'pe2',
            number: 2,
            left: 144,
            width: 1104,
            style: {...textbox, textContentFull: TEXT},
            aboveNumInPage: 2,
            belowNumInPage: 5,
            aboveRect: textbox.textRect,
            belowRect: second.textRect,
          },
        ],
        penEdits: [{id: 'pe2', kind: 'insertion', number: 2, pictureUri: null}],
      }),
      {pe2: state({text: 'A new thought.'})},
    );
    expect(preview.hunks.map(hunk => hunk.label)).toEqual(['Delete', 'New paragraph 2', 'Delete']);
    expect(preview.hunks[1].segments).toEqual([{text: 'A new thought.', style: 'inserted'}]);
  });
});
