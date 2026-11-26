import {buildClipboardSummary, createEditMarkerBackupPayload} from '../../src/domain/backupPayload';
import {
  buildRecognizeRect,
  buildStrokeStats,
  isSupportedEditMarkerElement,
} from '../../src/domain/markerStrokes';
import {
  applyTextMutationRangesDetailed,
  formatOperationSnippet,
  mergeHighlightRanges,
} from '../../src/domain/markerText';
import type {EditMarkerApplyPlan, StrokeStats} from '../../src/domain/markerTypes';
import type {PageElementData, Rect} from '../../src/domain/textboxModel';

const rect = (left: number, top: number, right: number, bottom: number): Rect => ({left, top, right, bottom});

function element(uuid: string, overrides: Partial<PageElementData> = {}): PageElementData {
  return {uuid, type: 0, layerNum: 0, numInPage: 1, textBox: null, title: null, link: null, picture: null, geometry: null, ...overrides};
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
  it('holds every page of one apply', () => {
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
    const payload = {...createEditMarkerBackupPayload([plan, {...plan, page: 4}]), createdAt: '2026-11-15T12:00:00.000Z'};
    expect(payload.texts.map(text => text.page)).toEqual([2, 4]);
    expect(buildClipboardSummary(payload)).toBe(
      'Manuscript edit-markers backup\nCreated: 2026-11-15T12:00:00.000Z\nNote: /note.note\nPages: 2, 4\n' +
        'Recognized operations: 0\n\n#1\nOld text\n\n#2\nOld text\n',
    );
  });
});
