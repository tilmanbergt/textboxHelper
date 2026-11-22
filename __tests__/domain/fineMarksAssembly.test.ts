import {assembleMarkerPreview} from '../../src/domain/markerAssembly';
import type {MarkerPreviewBase, OperationDraft} from '../../src/domain/markerTypes';
import {punctuationAtGap} from '../../src/domain/closeUpMark';

const textboxOf = (text: string) => ({
  uuid: 'tb',
  numInPage: 2,
  layerNum: 0,
  originalText: text,
  textRect: {left: 144, top: 155, right: 1248, bottom: 372},
  fontSize: 36,
  fontPath: null,
  textAlign: 0,
  textBold: 0,
  textItalics: 0,
  textFrameWidthType: 0,
  textFrameStyle: 0,
  textEditable: 0,
});

const operation = (id: string, kind: OperationDraft['operation']['kind'], extra: Partial<OperationDraft['operation']> = {}) => ({
  id,
  kind,
  markerUuid: id,
  markerNumInPage: 4,
  consumedMarkerNums: [4],
  targetTextboxUuid: 'tb',
  targetTextboxNumInPage: 2,
  lineIndex: 0,
  summary: '',
  detail: '',
  words: [],
  textStart: 0,
  ...extra,
});

const closeUp = (text: string, start: number, end: number, id = 'c'): OperationDraft => ({
  range: {kind: 'replace', start, end, replacementText: '', joins: true},
  operation: operation(id, 'closeUp', {
    closeUp: {gapStart: start, gapEnd: end, punct: punctuationAtGap(text, start, end), removePunct: false},
  }),
});

const punct = (offset: number, char: ',' | "'" | null, mode: 'inWord' | 'betweenWords' = 'betweenWords', tie = false): OperationDraft => ({
  range: {kind: 'replace', start: offset, end: offset},
  operation: operation('p', 'punct', {punct: {offset, mode, char, source: char ? 'own' : 'none', tie}}),
});

const base = (text: string, drafts: OperationDraft[]): MarkerPreviewBase => ({
  notePath: '/n.note',
  page: 0,
  drafts,
  ignored: [],
  textboxes: [textboxOf(text)],
  insertions: [],
  penEdits: [],
  penStates: {},
});

const nextText = (preview: ReturnType<typeof assembleMarkerPreview>) => preview.applyPlan?.textMutations[0]?.nextText;

describe('close-up in the review (§6)', () => {
  it('closes the gap, and takes the punctuation when asked', () => {
    const text = 'note- book';
    expect(nextText(assembleMarkerPreview(base(text, [closeUp(text, 5, 6)]), {}))).toBe('note-book');
    const preview = assembleMarkerPreview(base(text, [closeUp(text, 5, 6)]), {}, null, {}, {c: {removePunct: true}});
    expect(nextText(preview)).toBe('notebook');
    expect(preview.operations[0]).toMatchObject({closeUp: {removePunct: true}, summary: 'Close up · note|book'});
    expect(preview.hunks[0].label).toBe('Close up');
  });

  it('yields to another change at its gap, and contradicts a space mark', () => {
    const text = 'the big red car';
    const strike: OperationDraft = {range: {kind: 'delete', start: 4, end: 7}, operation: operation('d', 'delete')};
    const preview = assembleMarkerPreview(base(text, [closeUp(text, 7, 8), strike]), {});
    expect(nextText(preview)).toBe('the red car');
    expect(preview.ignoredMarkers.map(item => item.reason)).toEqual([expect.stringContaining('Another change')]);
    const space: OperationDraft = {
      range: {kind: 'replace', start: 8, end: 8, replacementText: ' '},
      operation: operation('s', 'space'),
    };
    const both = assembleMarkerPreview(base(text, [closeUp(text, 7, 8), space]), {});
    expect(both.applyPlan).toBeNull();
    expect(both.ignoredMarkers).toHaveLength(2);
  });

  it('cancels a swap whose gap it closes', () => {
    const text = 'big red car';
    const swap: OperationDraft = {
      range: {kind: 'replace', start: 0, end: 7, replacementText: 'red big'},
      operation: operation('swap:1', 'swap', {swap: {zones: {a0: 0, a1: 3, b0: 4, b1: 7}, fixCase: false, capsAvailable: false}}),
    };
    const preview = assembleMarkerPreview(base(text, [swap, closeUp(text, 3, 4)]), {});
    expect(preview.ignoredMarkers.map(item => item.reason)).toEqual([expect.stringContaining('close-up between')]);
    expect(nextText(preview)).toBe('bigred car');
  });
});

describe('punctuation circle in the review (§9)', () => {
  it('puts the mark in by its type', () => {
    expect(nextText(assembleMarkerPreview(base('Yes I know', [punct(4, ',')]), {}))).toBe('Yes, I know');
  });

  it('waits for a pick when nothing was read, and takes the pick', () => {
    const waiting = assembleMarkerPreview(base('Yes I know', [punct(3, null)]), {});
    expect(waiting.applyPlan).toBeNull();
    expect(waiting.pendingCount).toBe(1);
    expect(waiting.hunks[0].meta).toContain('Check');
    const picked = assembleMarkerPreview(base('Yes I know', [punct(3, null)]), {}, null, {}, {p: {char: ';'}});
    expect(nextText(picked)).toBe('Yes; I know');
    expect(picked.operations[0].uncertain).toBeUndefined();
  });

  it('marks a comma-apostrophe tie for a check, and refuses a comma between letters', () => {
    const tie = assembleMarkerPreview(base('Yes I know', [punct(3, ',', 'betweenWords', true)]), {});
    expect(tie.operations[0].uncertain).toContain('comma or an apostrophe');
    const refused = assembleMarkerPreview(base('walking', [punct(4, ',', 'inWord')]), {});
    expect(refused.applyPlan).toBeNull();
    expect(refused.ignoredMarkers[0].reason).toContain('goes after a word');
  });
});

describe('a new textbox for "Insert right here" (§8)', () => {
  it('is shown as a new paragraph where the handwriting is', () => {
    const preview = assembleMarkerPreview(
      {
        ...base('x', []),
        textboxes: [],
        insertions: [
          {
            penEditId: 'pe',
            number: 3,
            left: 200,
            width: 600,
            style: {...textboxOf(''), textContentFull: null},
            aboveNumInPage: null,
            belowNumInPage: null,
            aboveRect: null,
            belowRect: {left: 200, top: 900, right: 800, bottom: 900},
            here: 'newBox',
          },
        ],
        penEdits: [{id: 'pe', kind: 'insertion', number: 3, pictureUri: null}],
      },
      {pe: {status: 'done', text: 'Hello there', correctedText: null, edges: null}},
    );
    expect(preview.operations[0]).toMatchObject({detail: 'New textbox where the handwriting is'});
    expect(preview.applyPlan?.insertions[0]).toMatchObject({text: 'Hello there', left: 200});
  });
});

describe('joining two paragraphs (§7)', () => {
  const lowerBox = {...textboxOf('book is here.'), uuid: 'tb2', numInPage: 3, textRect: {left: 144, top: 400, right: 1248, bottom: 460}};
  const join = (upper: string): OperationDraft => ({
    range: {kind: 'replace', start: upper.length, end: upper.length},
    operation: operation('j', 'join', {
      join: {belowUuid: 'tb2', belowNumInPage: 3, hyphen: upper.trimEnd().endsWith('-') ? '-' : '', removeHyphen: false},
      detail: 'Textboxes 2 + 3',
    }),
  });
  const joinBase = (upper: string, drafts: OperationDraft[]): MarkerPreviewBase => ({
    ...base(upper, drafts),
    textboxes: [textboxOf(upper), lowerBox],
  });

  it('adds the lower text to the upper one and empties the lower textbox', () => {
    const preview = assembleMarkerPreview(joinBase('It is a note ', [join('It is a note ')]), {});
    const byUuid = new Map(preview.applyPlan?.textMutations.map(mutation => [mutation.uuid, mutation.nextText]));
    expect(byUuid.get('tb')).toBe('It is a note book is here.');
    expect(byUuid.get('tb2')).toBe('');
    expect(preview.hunks[0]).toMatchObject({label: 'Join paragraphs', meta: 'Textboxes 2 + 3'});
  });

  it('takes the dash and the space away when asked, and makes edits in both first', () => {
    const upper = 'It is a note-';
    const strike: OperationDraft = {
      range: {kind: 'delete', start: 0, end: 5},
      operation: {...operation('d', 'delete'), targetTextboxUuid: 'tb2', targetTextboxNumInPage: 3},
    };
    const preview = assembleMarkerPreview(joinBase(upper, [join(upper), strike]), {}, null, {}, {j: {removePunct: true}});
    const byUuid = new Map(preview.applyPlan?.textMutations.map(mutation => [mutation.uuid, mutation.nextText]));
    expect(byUuid.get('tb')).toBe('It is a noteis here.');
  });

  it('is left out with a paragraph break in either paragraph', () => {
    const split: OperationDraft = {
      range: {kind: 'replace', start: 5, end: 5},
      operation: {...operation('s', 'split'), targetTextboxUuid: 'tb2', targetTextboxNumInPage: 3},
    };
    const preview = assembleMarkerPreview(joinBase('It is a note', [join('It is a note'), split]), {});
    expect(preview.ignoredMarkers.map(item => item.reason)).toEqual([expect.stringContaining('paragraph break')]);
  });
});
