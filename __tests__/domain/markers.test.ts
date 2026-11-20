import {buildClipboardSummary, createEditMarkerBackupPayload} from '../../src/domain/backupPayload';
import {
  buildRecognizeRect,
  buildStrokeStats,
  findBestReplaceModifierPair,
  isSupportedEditMarkerElement,
  orderTextboxMarkerCandidates,
} from '../../src/domain/markerStrokes';
import {
  applyTextMutationRangesDetailed,
  formatOperationSnippet,
  mergeHighlightRanges,
} from '../../src/domain/markerText';
import type {EditMarkerApplyPlan, MarkerDeleteCandidate, MarkerStrokeAnalysis, StrokeStats} from '../../src/domain/markerTypes';
import type {PageElementData, Rect, TextElementData} from '../../src/domain/textboxModel';

const rect = (left: number, top: number, right: number, bottom: number): Rect => ({left, top, right, bottom});

function element(uuid: string, overrides: Partial<PageElementData> = {}): PageElementData {
  return {uuid, type: 0, layerNum: 0, numInPage: 1, textBox: null, title: null, link: null, picture: null, geometry: null, ...overrides};
}

function textbox(uuid: string, text: string, textRect: Rect): TextElementData {
  return {
    ...element(uuid, {type: 500, numInPage: 7}),
    textBox: {
      fontSize: 36,
      fontPath: null,
      textContentFull: text,
      textRect,
      textAlign: 0,
      textBold: 0,
      textItalics: 0,
      textFrameWidthType: 0,
      textFrameStyle: 0,
      textEditable: 0,
    },
  };
}

function stroke(points: Array<{x: number; y: number}>): StrokeStats {
  const stats = buildStrokeStats(points);
  if (!stats) {
    throw new Error('test stroke needs two points');
  }
  return stats;
}

describe('marker strokes', () => {
  it('measures a stroke: bounds, length, straightness and angle', () => {
    const stats = stroke([{x: 100, y: 200}, {x: 150, y: 202}, {x: 200, y: 204}]);
    expect(stats.rect).toEqual(rect(100, 200, 200, 204));
    expect(stats.center).toEqual({x: 150, y: 202});
    expect(stats.straightness).toBe(1);
    expect(stats.angleDeg).toBeCloseTo(2.29, 2);
    expect(buildStrokeStats([{x: 1, y: 1}])).toBeNull();
  });

  it('reads the recognition rectangle only when all four corners are numbers', () => {
    expect(buildRecognizeRect({up_left_point_x: 1, up_left_point_y: 2, down_right_point_x: 30, down_right_point_y: 6})).toEqual(
      rect(1, 2, 30, 6),
    );
    expect(buildRecognizeRect({up_left_point_x: 1})).toBeNull();
    expect(buildRecognizeRect(null)).toBeNull();
  });

  it('accepts main-layer strokes and straight lines as markers', () => {
    expect(isSupportedEditMarkerElement(element('s'))).toBe(true);
    expect(isSupportedEditMarkerElement(element('s', {layerNum: 1}))).toBe(false);
    const line = {type: 'straightLine', points: [{x: 0, y: 0}, {x: 10, y: 0}]};
    expect(isSupportedEditMarkerElement(element('g', {type: 700, geometry: line}))).toBe(true);
    expect(isSupportedEditMarkerElement(element('g', {type: 700, geometry: {...line, type: 'GEO_circle'}}))).toBe(false);
  });

  const deleteStroke = stroke([{x: 100, y: 200}, {x: 200, y: 200}]);
  const candidate: MarkerDeleteCandidate = {
    marker: element('delete'),
    markerUuid: 'delete',
    markerNumInPage: 1,
    markerSortTop: 200,
    markerSortLeft: 100,
    strokeStats: deleteStroke,
    targetTextbox: textbox('t', 'text', rect(0, 0, 500, 500)),
    lineIndex: 0,
    lineRect: rect(80, 180, 220, 220),
    words: [],
  };
  const vertical = (uuid: string, x: number): MarkerStrokeAnalysis => ({
    marker: element(uuid),
    strokeStats: stroke([{x, y: 185}, {x, y: 215}]),
  });

  it('pairs the two closest vertical strokes on the delete line into a replace mark', () => {
    const pair = findBestReplaceModifierPair(candidate, [vertical('far', 400), vertical('b', 150), vertical('a', 120), vertical('delete', 130)]);
    expect(pair.map(analysis => analysis.marker.uuid)).toEqual(['a', 'b']);
  });

  it('needs two vertical strokes for a replace mark', () => {
    expect(findBestReplaceModifierPair(candidate, [vertical('a', 120)])).toEqual([]);
  });

  it('orders candidates by line, then by the first word', () => {
    const at = (uuid: string, lineIndex: number, start: number) => ({
      ...candidate,
      markerUuid: uuid,
      lineIndex,
      words: [{start} as MarkerDeleteCandidate['words'][number]],
    });
    expect(orderTextboxMarkerCandidates([at('c', 1, 0), at('b', 0, 20), at('a', 0, 5)]).map(item => item.markerUuid)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

describe('marker text changes', () => {
  it('applies deletes and replaces once each, tidies spaces, and highlights inserted text', () => {
    expect(
      applyTextMutationRangesDetailed('The quick brown fox jumps.', [
        {kind: 'delete', start: 4, end: 10},
        {kind: 'replace', start: 16, end: 19, replacementText: 'cat'},
        {kind: 'delete', start: 4, end: 10},
      ]),
    ).toEqual({text: 'The brown cat jumps.', insertedRanges: [{start: 10, end: 13}]});
  });

  it('merges overlapping highlight ranges and drops empty ones', () => {
    expect(mergeHighlightRanges([{start: 5, end: 8}, {start: 0, end: 3}, {start: 2, end: 4}, {start: 9, end: 9}])).toEqual([
      {start: 0, end: 4},
      {start: 5, end: 8},
    ]);
  });

  it('words the operations for the review', () => {
    expect(formatOperationSnippet('replace', ['old', 'text'], 'new')).toBe('Replace "old text" -> "new"');
    expect(formatOperationSnippet('delete', ['gone'])).toBe('Delete "gone"');
  });
});

describe('edit-marker backup', () => {
  it('keeps the edit-marker summary header as before', () => {
    const plan: EditMarkerApplyPlan = {
      notePath: '/note.note',
      page: 2,
      operations: [],
      recognizedMarkerNums: [],
      penEditIds: [],
      insertions: [],
      textMutations: [
        {
          uuid: 't',
          numInPage: 7,
          layerNum: 0,
          originalText: 'Old text',
          nextText: 'New',
          textRect: rect(0, 0, 100, 50),
          nextTextRect: rect(0, 0, 100, 50),
          fontSize: 36,
          fontPath: null,
          textAlign: 0,
          textBold: 0,
          textItalics: 0,
          textFrameWidthType: 0,
          textFrameStyle: 0,
          textEditable: 0,
        },
      ],
    };
    const payload = {...createEditMarkerBackupPayload(plan), createdAt: '2026-11-15T12:00:00.000Z'};
    expect(buildClipboardSummary(payload)).toBe(
      'textboxHelper edit-markers backup\nCreated: 2026-11-15T12:00:00.000Z\nNote: /note.note\nPage: 2\n' +
        'Recognized operations: 0\n\n#1\nOld text\n',
    );
  });
});
