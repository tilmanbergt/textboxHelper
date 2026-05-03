import {Clipboard} from 'react-native';
import RNFS from 'react-native-fs';
import {
  Element,
  PluginCommAPI,
  PluginFileAPI,
  PluginManager,
  PluginNoteAPI,
  type Rect,
  type TextBox,
} from 'sn-plugin-lib';
import {
  cloneRect,
  horizontalOverlapRatio,
  intersectionRect,
  pointInRect,
  rectCenter,
  rectHeight,
  rectWidth,
  sortTextElementsByReadingOrder,
} from './shared/supernoteTextboxGeometry';
import {
  buildResizedTextboxRect,
  DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION,
  measureDetailedTextLayout,
  type NativeDetailedLine,
  type NativeDetailedMeasurement,
  type NativeDetailedWord,
  type TextboxMeasurementCalibration,
} from './shared/supernoteTextboxLayout';
import {
  buildPageWordCandidates,
  findCandidateLineIndexes,
  findLineBandWordCandidates,
  type PageWordCandidate,
} from './shared/supernoteTextboxHitTesting';

/**
 * Edit marker engine.
 *
 * This module owns the full marker lifecycle:
 * - load lasso or full-page context
 * - recognize delete and replace markers
 * - resolve typed replacement lines
 * - build the preview shown in the UI
 * - apply text mutations and remove consumed markers
 *
 * Geometry, layout, and hit-testing primitives live in `src/shared`; this file should
 * orchestrate those pieces rather than re-implementing them.
 */

export type EditMarkerOperationKind = 'delete' | 'replace';

export type EditMarkerHighlightRange = {
  start: number;
  end: number;
};

export type EditMarkerPreviewBlock = {
  id: string;
  text: string;
  highlightRanges: EditMarkerHighlightRange[];
};

export type RecognizedEditOperation = {
  id: string;
  kind: EditMarkerOperationKind;
  markerUuid: string;
  markerNumInPage: number;
  consumedMarkerNums: number[];
  targetTextboxUuid: string;
  targetTextboxNumInPage: number;
  lineIndex: number;
  summary: string;
  detail: string;
  words: string[];
  replacementText?: string;
};

export type IgnoredEditMarker = {
  markerUuid: string;
  markerNumInPage: number;
  summary: string;
  reason: string;
};

export type EditMarkerPreview = {
  selectedMarkerCount: number;
  selectedTextboxCount: number;
  recognizedOperationCount: number;
  selectionMessage: string;
  summaryMessage: string;
  beforePreviewBlocks: EditMarkerPreviewBlock[];
  afterPreviewBlocks: EditMarkerPreviewBlock[];
  beforeBlocks: string[];
  afterBlocks: string[];
  operations: RecognizedEditOperation[];
  ignoredMarkers: IgnoredEditMarker[];
  canApply: boolean;
  applyPlan: EditMarkerApplyPlan | null;
};

export type EditMarkerProgressUpdate = {
  message: string;
  canCancel: boolean;
};

export type EditMarkerApplyResult = {
  message: string;
  backupPath: string;
  clipboardSummary: string;
  appliedOperationCount: number;
  removedMarkerCount: number;
  affectedTextboxCount: number;
};

export type EditMarkerPreviewScope = 'lasso' | 'page';

type TextElement = Element & {
  textBox: TextBox;
};

type StrokeStats = {
  points: Array<{x: number; y: number}>;
  rect: Rect;
  width: number;
  height: number;
  pathLength: number;
  directDistance: number;
  straightness: number;
  angleDeg: number;
  firstPoint: {x: number; y: number};
  lastPoint: {x: number; y: number};
  center: {x: number; y: number};
};

type RecognPointLike = {
  X?: unknown;
  Y?: unknown;
};

type BackupPayload = {
  action: 'edit-markers';
  createdAt: string;
  notePath: string;
  page: number;
  selectedMarkerCount: number;
  recognizedOperationCount: number;
  texts: Array<{
    uuid: string;
    numInPage: number;
    layerNum: number;
    textContentFull: string;
    textRect: Rect;
    fontSize: number;
    fontPath: string | null;
    textAlign: number;
    textBold: number;
    textItalics: number;
    textFrameWidthType: number;
    textFrameStyle: number;
    textEditable: number;
  }>;
};

type TextMutationPlan = {
  uuid: string;
  numInPage: number;
  layerNum: number;
  originalText: string;
  nextText: string;
  textRect: Rect;
  nextTextRect: Rect;
  fontSize: number;
  fontPath: string | null;
  textAlign: number;
  textBold: number;
  textItalics: number;
  textFrameWidthType: number;
  textFrameStyle: number;
  textEditable: number;
};

type EditMarkerApplyPlan = {
  notePath: string;
  page: number;
  selectedMarkerCount: number;
  operations: RecognizedEditOperation[];
  recognizedMarkerNums: number[];
  replacementSourceTextboxNums: number[];
  textMutations: TextMutationPlan[];
};

/**
 * Candidate recognized from a horizontal delete-style marker.
 *
 * These candidates are still pre-apply objects: replace detection, range conflict checks,
 * and final mutation planning all happen after this stage.
 */
type MarkerDeleteCandidate = {
  marker: Element;
  markerUuid: string;
  markerNumInPage: number;
  markerSortTop: number;
  markerSortLeft: number;
  strokeStats: StrokeStats;
  targetTextbox: TextElement;
  lineIndex: number;
  lineRect: Rect;
  words: WordCandidate[];
};

type MarkerStrokeAnalysis = {
  marker: Element;
  strokeStats: StrokeStats;
};

type ReplacementTextLine = {
  sourceTextboxUuid: string;
  sourceTextboxNumInPage: number;
  sourceLineIndex: number;
  sortTop: number;
  sortLeft: number;
  text: string;
  rawLine: string;
};

type TextMutationRange = {
  kind: EditMarkerOperationKind;
  start: number;
  end: number;
  replacementText?: string;
};

type WordCandidate = PageWordCandidate;

type PreviewContext = {
  notePath: string;
  page: number;
  lassoElements: Element[];
  pageElements: Element[];
  previewScope: EditMarkerPreviewScope;
  effectiveSelection: Element[];
};

type EditMarkerApplyOptions = {
  onProgress?: (update: EditMarkerProgressUpdate) => void;
};

const TEXT_TYPE_NORMAL = 500;
const MAIN_LAYER = 0;
const DEFAULT_FONT_SIZE = 32;
const CLIPBOARD_PREVIEW_LIMIT = 3000;
const MAX_DELETE_WORDS_PER_MARKER = 6;
const MIN_MARKER_WIDTH = 30;
const MAX_MARKER_HEIGHT_RATIO = 0.55;
const FALLBACK_MARKER_HEIGHT = 4;
const REPLACE_MODIFIER_MIN_HEIGHT = 18;
const REPLACE_MODIFIER_PAIR_MAX_GAP = 56;
const REPLACE_MODIFIER_MAX_CENTER_DISTANCE = 48;
const REPLACE_SOURCE_HORIZONTAL_OVERLAP_RATIO = 0.35;
export type EditMarkerCalibration = TextboxMeasurementCalibration;

const DEFAULT_EDIT_MARKER_CALIBRATION: EditMarkerCalibration = {
  ...DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION,
};

let currentEditMarkerCalibration: EditMarkerCalibration = {
  ...DEFAULT_EDIT_MARKER_CALIBRATION,
};

function logEditMarker(stage: string, payload?: unknown): void {
  if (payload === undefined) {
    console.log(`[EditMarkerActions] ${stage}`);
    return;
  }

  try {
    console.log(`[EditMarkerActions] ${stage}`, JSON.stringify(payload));
  } catch {
    console.log(`[EditMarkerActions] ${stage}`, String(payload));
  }
}

export function getEditMarkerCalibration(): EditMarkerCalibration {
  return {
    ...currentEditMarkerCalibration,
  };
}

export function setEditMarkerCalibration(
  nextCalibration: Partial<EditMarkerCalibration>,
): EditMarkerCalibration {
  currentEditMarkerCalibration = {
    ...currentEditMarkerCalibration,
    ...nextCalibration,
  };

  logEditMarker('calibrationUpdated', currentEditMarkerCalibration);
  return getEditMarkerCalibration();
}

export function resetEditMarkerCalibration(): EditMarkerCalibration {
  currentEditMarkerCalibration = {
    ...DEFAULT_EDIT_MARKER_CALIBRATION,
  };

  logEditMarker('calibrationReset', currentEditMarkerCalibration);
  return getEditMarkerCalibration();
}

function assertApiSuccess<T>(
  response: {success?: boolean; result?: T; error?: {message?: string}} | null | undefined,
  fallback: string,
): T {
  if (response?.success) {
    return response.result as T;
  }

  throw new Error(response?.error?.message || fallback);
}

function rectOverlapHeight(left: Rect, right: Rect): number {
  return Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
}

function roundNumber(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundRect(rect: Rect): Rect {
  return {
    left: roundNumber(rect.left),
    top: roundNumber(rect.top),
    right: roundNumber(rect.right),
    bottom: roundNumber(rect.bottom),
  };
}

function isNormalTextElement(element: Element): element is TextElement {
  return (
    element.type === TEXT_TYPE_NORMAL &&
    element.layerNum === MAIN_LAYER &&
    !!element.textBox?.textContentFull &&
    !!element.textBox?.textRect
  );
}

function isMainLayerStrokeElement(element: Element): boolean {
  return element.type === Element.TYPE_STROKE && element.layerNum === MAIN_LAYER;
}

function isStraightLineGeometryElement(element: Element): boolean {
  return (
    element.type === Element.TYPE_GEO &&
    element.layerNum === MAIN_LAYER &&
    element.geometry?.type === 'straightLine' &&
    Array.isArray(element.geometry?.points) &&
    element.geometry.points.length >= 2
  );
}

function isSupportedEditMarkerElement(element: Element): boolean {
  return isMainLayerStrokeElement(element) || isStraightLineGeometryElement(element);
}

function sortTextElements(elements: TextElement[]): TextElement[] {
  return sortTextElementsByReadingOrder(elements);
}

function getCandidateTextStart(candidate: MarkerDeleteCandidate): number {
  return candidate.words[0]?.start ?? Number.MAX_SAFE_INTEGER;
}

function orderTextboxMarkerCandidates(
  candidates: MarkerDeleteCandidate[],
): MarkerDeleteCandidate[] {
  return [...candidates].sort((left, right) => {
    if (left.lineIndex !== right.lineIndex) {
      return left.lineIndex - right.lineIndex;
    }

    const leftStart = getCandidateTextStart(left);
    const rightStart = getCandidateTextStart(right);
    if (leftStart !== rightStart) {
      return leftStart - rightStart;
    }

    if (Math.abs(left.markerSortLeft - right.markerSortLeft) > 1) {
      return left.markerSortLeft - right.markerSortLeft;
    }

    return left.markerNumInPage - right.markerNumInPage;
  });
}

function buildSelectionMessage(
  selectedMarkerCount: number,
  selectedTextboxCount: number,
): string {
  const parts: string[] = [];

  parts.push(
    selectedMarkerCount === 1 ? '1 marker selected' : `${selectedMarkerCount} markers selected`,
  );

  if (selectedTextboxCount > 0) {
    parts.push(
      selectedTextboxCount === 1
        ? '1 textbox also selected'
        : `${selectedTextboxCount} textboxes also selected`,
    );
  }

  return parts.join(' · ');
}

function buildSummaryMessage(
  operationCount: number,
  ignoredCount: number,
  selectedMarkerCount: number,
): string {
  if (selectedMarkerCount === 0) {
    return 'Select one or more handwritten edit markers.';
  }

  if (operationCount === 0) {
    if (ignoredCount > 0) {
      return ignoredCount === 1
        ? 'No operations recognized. 1 selected marker was ignored.'
        : `No operations recognized. ${ignoredCount} selected markers were ignored.`;
    }

    return 'No operations recognized yet.';
  }

  if (ignoredCount === 0) {
    return operationCount === 1
      ? 'Recognized 1 operation.'
      : `Recognized ${operationCount} operations.`;
  }

  return `Recognized ${operationCount} operations. Ignored ${ignoredCount} markers.`;
}

function shortenSnippet(text: string, limit = 44): string {
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function formatOperationSnippet(
  kind: EditMarkerOperationKind,
  words: string[],
  replacementText?: string,
): string {
  const joined = words.join(' ').trim();
  if (!joined) {
    return kind === 'replace' ? 'Replace text' : 'Delete text';
  }

  const shortened = shortenSnippet(joined);
  if (kind === 'replace') {
    const replacementLabel = replacementText?.trim()
      ? shortenSnippet(replacementText.trim())
      : '(missing)';
    return `Replace "${shortened}" -> "${replacementLabel}"`;
  }

  return `Delete "${shortened}"`;
}

function buildOperationDetail(
  targetTextbox: TextElement,
  lineIndex: number,
  words: WordCandidate[],
): string {
  const wordLabel = words.length === 1 ? 'word' : 'words';
  return `Textbox ${targetTextbox.numInPage}, line ${lineIndex + 1} · ${words.length} ${wordLabel}`;
}

function buildOperationDetailWithReplacement(
  targetTextbox: TextElement,
  lineIndex: number,
  words: WordCandidate[],
  replacementText?: string,
): string {
  const wordLabel = words.length === 1 ? 'word' : 'words';
  const baseDetail = `Textbox ${targetTextbox.numInPage}, line ${lineIndex + 1} - ${words.length} ${wordLabel}`;
  if (!replacementText) {
    return baseDetail;
  }

  return `${baseDetail} - replacement "${shortenSnippet(replacementText.trim(), 32)}"`;
}

function buildIgnoredMarker(
  marker: Element,
  reason: string,
): IgnoredEditMarker {
  return {
    markerUuid: marker.uuid,
    markerNumInPage: marker.numInPage,
    summary: `Ignored marker ${marker.numInPage}`,
    reason,
  };
}

function buildTextboxLogSummary(textbox: TextElement): Record<string, unknown> {
  return {
    uuid: textbox.uuid,
    numInPage: textbox.numInPage,
    layerNum: textbox.layerNum,
    rect: roundRect(cloneRect(textbox.textBox.textRect)),
    textPreview: (textbox.textBox.textContentFull || '').slice(0, 80).replace(/\s+/g, ' '),
    textLength: (textbox.textBox.textContentFull || '').length,
  };
}

function buildStrokeLogSummary(marker: Element, strokeStats: StrokeStats): Record<string, unknown> {
  return {
    uuid: marker.uuid,
    numInPage: marker.numInPage,
    sourceType:
      marker.type === Element.TYPE_STROKE
        ? 'stroke'
        : marker.type === Element.TYPE_GEO
          ? 'geometry'
          : `type-${marker.type}`,
    geometryType: marker.geometry?.type || null,
    layerNum: marker.layerNum,
    rect: roundRect(strokeStats.rect),
    center: {
      x: roundNumber(strokeStats.center.x),
      y: roundNumber(strokeStats.center.y),
    },
    width: roundNumber(strokeStats.width),
    height: roundNumber(strokeStats.height),
    straightness: roundNumber(strokeStats.straightness),
    angleDeg: roundNumber(strokeStats.angleDeg),
    firstPoint: {
      x: roundNumber(strokeStats.firstPoint.x),
      y: roundNumber(strokeStats.firstPoint.y),
    },
    lastPoint: {
      x: roundNumber(strokeStats.lastPoint.x),
      y: roundNumber(strokeStats.lastPoint.y),
    },
  };
}

function buildLineLogSummary(
  line: NativeDetailedLine,
  textRect: Rect,
): Record<string, unknown> {
  return {
    index: line.index,
    start: line.start,
    end: line.end,
    left: roundNumber(textRect.left + currentEditMarkerCalibration.offsetX + line.left),
    right: roundNumber(textRect.left + currentEditMarkerCalibration.offsetX + line.right),
    top: roundNumber(textRect.top + currentEditMarkerCalibration.offsetY + line.top),
    bottom: roundNumber(textRect.top + currentEditMarkerCalibration.offsetY + line.bottom),
    width: roundNumber(line.width),
    baseline: roundNumber(textRect.top + currentEditMarkerCalibration.offsetY + line.baseline),
  };
}

function buildWordLogSummary(candidate: WordCandidate): Record<string, unknown> {
  return {
    text: candidate.text,
    lineIndex: candidate.lineIndex,
    start: candidate.start,
    end: candidate.end,
    rect: roundRect({
      left: candidate.absoluteLeft,
      top: candidate.absoluteTop,
      right: candidate.absoluteRight,
      bottom: candidate.absoluteBottom,
    }),
    center: {
      x: roundNumber(candidate.absoluteCenterX),
      y: roundNumber(candidate.absoluteCenterY),
    },
    overlapRatio: roundNumber(candidate.overlapRatio),
    projectedY: roundNumber(candidate.projectedY),
  };
}

function buildRejectedResult(
  marker: Element,
  reason: string,
  extra?: Record<string, unknown>,
): {ignored: IgnoredEditMarker} {
  logEditMarker('markerRejected', {
    markerUuid: marker.uuid,
    markerNumInPage: marker.numInPage,
    reason,
    ...(extra || {}),
  });

  return {
    ignored: buildIgnoredMarker(marker, reason),
  };
}

function normalizeTextAfterEdit(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\[\s+/g, '[')
    .replace(/\{\s+/g, '{')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function applyWordDeletionsToText(text: string, words: WordCandidate[]): string {
  const uniqueWords = [...words]
    .sort((left, right) => right.start - left.start)
    .filter(
      (word, index, allWords) =>
        index === 0 ||
        word.start !== allWords[index - 1].start ||
        word.end !== allWords[index - 1].end,
    );

  let nextText = text;
  for (const word of uniqueWords) {
    nextText = `${nextText.slice(0, word.start)}${nextText.slice(word.end)}`;
  }

  return normalizeTextAfterEdit(nextText);
}

function getUniqueTextMutationRanges(ranges: TextMutationRange[]): TextMutationRange[] {
  return [...ranges]
    .sort((left, right) => {
      if (left.start !== right.start) {
        return left.start - right.start;
      }

      return left.end - right.end;
    })
    .filter(
      (range, index, allRanges) =>
        index === 0 ||
        range.start !== allRanges[index - 1].start ||
        range.end !== allRanges[index - 1].end ||
        range.kind !== allRanges[index - 1].kind ||
        (range.replacementText || '') !== (allRanges[index - 1].replacementText || ''),
    );
}

function applyTextMutationRangesDetailed(
  text: string,
  ranges: TextMutationRange[],
): {text: string; insertedRanges: EditMarkerHighlightRange[]} {
  const uniqueRanges = getUniqueTextMutationRanges(ranges);
  let nextText = text;
  let offset = 0;
  const insertedRanges: EditMarkerHighlightRange[] = [];

  for (const range of uniqueRanges) {
    const replacementText = range.kind === 'replace' ? range.replacementText || '' : '';
    const currentStart = range.start + offset;
    const currentEnd = range.end + offset;
    nextText = `${nextText.slice(0, currentStart)}${replacementText}${nextText.slice(currentEnd)}`;
    if (range.kind === 'replace' && replacementText.length > 0) {
      insertedRanges.push({
        start: currentStart,
        end: currentStart + replacementText.length,
      });
    }
    offset += replacementText.length - (range.end - range.start);
  }

  return {
    text: normalizeTextAfterEdit(nextText),
    insertedRanges: mergeHighlightRanges(insertedRanges),
  };
}

function applyTextMutationRanges(
  text: string,
  ranges: TextMutationRange[],
): string {
  return applyTextMutationRangesDetailed(text, ranges).text;
}

function isMeaningfulWord(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

function projectYOnStroke(stats: StrokeStats, x: number): number {
  void x;
  return stats.center.y;
}

function buildWordCandidates(
  measurement: NativeDetailedMeasurement,
  textRect: Rect,
  stroke: StrokeStats,
): WordCandidate[] {
  return buildPageWordCandidates(
    measurement,
    textRect,
    currentEditMarkerCalibration,
    stroke.rect,
    absoluteCenterX => projectYOnStroke(stroke, absoluteCenterX),
  );
}

function buildStrokeStats(points: Array<{x: number; y: number}>): StrokeStats | null {
  if (points.length < 2) {
    return null;
  }

  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  let pathLength = 0;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    minX = Math.min(minX, current.x);
    maxX = Math.max(maxX, current.x);
    minY = Math.min(minY, current.y);
    maxY = Math.max(maxY, current.y);
    pathLength += Math.hypot(current.x - previous.x, current.y - previous.y);
  }

  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  const directDistance = Math.hypot(lastPoint.x - firstPoint.x, lastPoint.y - firstPoint.y);
  const width = maxX - minX;
  const height = maxY - minY;
  const center = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
  };

  return {
    points,
    rect: {
      left: minX,
      top: minY,
      right: maxX,
      bottom: maxY,
    },
    width,
    height,
    pathLength,
    directDistance,
    straightness: pathLength > 0 ? directDistance / pathLength : 0,
    angleDeg: (Math.atan2(lastPoint.y - firstPoint.y, lastPoint.x - firstPoint.x) * 180) / Math.PI,
    firstPoint,
    lastPoint,
    center,
  };
}

function inflateStrokeStatsBounds(
  stats: StrokeStats,
  minimumThickness: number = FALLBACK_MARKER_HEIGHT,
): StrokeStats {
  const halfThickness = minimumThickness / 2;
  const nextRect: Rect = {
    left:
      stats.rect.left === stats.rect.right
        ? stats.center.x - halfThickness
        : stats.rect.left,
    top:
      stats.rect.top === stats.rect.bottom
        ? stats.center.y - halfThickness
        : stats.rect.top,
    right:
      stats.rect.left === stats.rect.right
        ? stats.center.x + halfThickness
        : stats.rect.right,
    bottom:
      stats.rect.top === stats.rect.bottom
        ? stats.center.y + halfThickness
        : stats.rect.bottom,
  };

  return {
    ...stats,
    rect: nextRect,
    width: rectWidth(nextRect),
    height: rectHeight(nextRect),
  };
}

async function recycleElements(elements: Element[]): Promise<void> {
  await Promise.all(
    elements.map(element =>
      typeof element.recycle === 'function'
        ? element.recycle().catch(() => undefined)
        : Promise.resolve(undefined),
    ),
  );
}

async function readAccessorRange<T>(
  accessor:
    | {
        size: () => Promise<number>;
        getRange: (startIndex: number, count: number) => Promise<T[]>;
      }
    | null
    | undefined,
): Promise<T[]> {
  if (!accessor) {
    return [];
  }

  try {
    const size = await accessor.size();
    if (!Number.isFinite(size) || size <= 0) {
      return [];
    }

    return await accessor.getRange(0, size);
  } catch {
    return [];
  }
}

function buildRecognizeRect(rawRecognizeResult: unknown): Rect | null {
  const recognizeResult = rawRecognizeResult as
    | {
        up_left_point_x?: unknown;
        up_left_point_y?: unknown;
        down_right_point_x?: unknown;
        down_right_point_y?: unknown;
      }
    | null
    | undefined;

  if (
    !recognizeResult ||
    typeof recognizeResult.up_left_point_x !== 'number' ||
    typeof recognizeResult.up_left_point_y !== 'number' ||
    typeof recognizeResult.down_right_point_x !== 'number' ||
    typeof recognizeResult.down_right_point_y !== 'number'
  ) {
    return null;
  }

  return {
    left: recognizeResult.up_left_point_x,
    top: recognizeResult.up_left_point_y,
    right: recognizeResult.down_right_point_x,
    bottom: recognizeResult.down_right_point_y,
  };
}

function buildStrokeStatsFromRect(rect: Rect): StrokeStats | null {
  const centerY = (rect.top + rect.bottom) / 2;
  const fallbackRect: Rect = {
    left: rect.left,
    top: centerY - FALLBACK_MARKER_HEIGHT / 2,
    right: rect.right,
    bottom: centerY + FALLBACK_MARKER_HEIGHT / 2,
  };

  return buildStrokeStats([
    {x: fallbackRect.left, y: centerY},
    {x: fallbackRect.right, y: centerY},
  ]);
}

async function loadMarkerStrokeStats(element: Element): Promise<StrokeStats | null> {
  if (isStraightLineGeometryElement(element)) {
    const geometryPoints = element.geometry?.points
      .map(point =>
        typeof point?.x === 'number' && typeof point?.y === 'number'
          ? {x: point.x, y: point.y}
          : null,
      )
      .filter((point): point is {x: number; y: number} => !!point);

    const geometryStats = buildStrokeStats(geometryPoints || []);
    if (geometryStats) {
      const normalizedGeometryStats = inflateStrokeStatsBounds(geometryStats);
      logEditMarker('markerSourceResolved', {
        markerUuid: element.uuid,
        markerNumInPage: element.numInPage,
        sourceType: 'geometry',
        geometryType: element.geometry?.type,
        pointCount: geometryPoints?.length || 0,
      });
      return normalizedGeometryStats;
    }
  }

  const recognPoints = await readAccessorRange<RecognPointLike>(element.stroke?.recognPoints);
  const points = recognPoints
    .map(point =>
      typeof point?.X === 'number' && typeof point?.Y === 'number'
        ? {
            x: point.X,
            y: point.Y,
          }
        : null,
    )
    .filter((point): point is {x: number; y: number} => !!point);

  const recognPointStats = buildStrokeStats(points);
  if (recognPointStats) {
    logEditMarker('markerSourceResolved', {
      markerUuid: element.uuid,
      markerNumInPage: element.numInPage,
      sourceType: 'stroke-recognPoints',
      pointCount: points.length,
    });
    return recognPointStats;
  }

  const contourGroups = await readAccessorRange<Array<{x?: unknown; y?: unknown}>>(
    element.contoursSrc,
  );
  const contourPoints = contourGroups
    .flat()
    .map(point =>
      typeof point?.x === 'number' && typeof point?.y === 'number'
        ? {x: point.x, y: point.y}
        : null,
    )
    .filter((point): point is {x: number; y: number} => !!point);

  const contourStats = buildStrokeStats(contourPoints);
  if (contourStats) {
    logEditMarker('markerSourceResolved', {
      markerUuid: element.uuid,
      markerNumInPage: element.numInPage,
      sourceType: 'stroke-contours',
      pointCount: contourPoints.length,
    });
    return contourStats;
  }

  const recognizeRect = buildRecognizeRect(element.recognizeResult);
  if (recognizeRect) {
    const rectStats = buildStrokeStatsFromRect(recognizeRect);
    if (rectStats) {
      logEditMarker('markerSourceResolved', {
        markerUuid: element.uuid,
        markerNumInPage: element.numInPage,
        sourceType: 'stroke-recognizeRect',
        recognizeRect: roundRect(recognizeRect),
      });
    }
    return rectStats;
  }

  return null;
}

async function getPreviewContext(
  previewScope: EditMarkerPreviewScope,
): Promise<PreviewContext> {
  const fileResponse = await PluginCommAPI.getCurrentFilePath();
  const pageResponse = await PluginCommAPI.getCurrentPageNum();

  const notePath = assertApiSuccess(
    fileResponse as {success?: boolean; result?: string; error?: {message?: string}},
    'Could not determine the current note path.',
  );
  const page = assertApiSuccess(
    pageResponse as {success?: boolean; result?: number; error?: {message?: string}},
    'Could not determine the current page.',
  );

  const lassoResponse = await PluginCommAPI.getLassoElements();
  const lassoElements = assertApiSuccess(
    lassoResponse as {success?: boolean; result?: Element[]; error?: {message?: string}},
    'Could not read the current lasso selection.',
  );

  const pageElementsResponse = await PluginFileAPI.getElements(page, notePath);
  const pageElements = assertApiSuccess(
    pageElementsResponse as {success?: boolean; result?: Element[]; error?: {message?: string}},
    'Could not read the current page elements.',
  );

  return {
    notePath,
    page,
    lassoElements,
    pageElements,
    previewScope,
    effectiveSelection: previewScope === 'page' ? pageElements : lassoElements,
  };
}

async function analyzeDeleteMarker(
  marker: Element,
  textboxes: TextElement[],
  preloadedStrokeStats?: StrokeStats,
): Promise<{candidate?: MarkerDeleteCandidate; ignored?: IgnoredEditMarker}> {
  const strokeStats = preloadedStrokeStats || (await loadMarkerStrokeStats(marker));
  if (!strokeStats) {
    return buildRejectedResult(
      marker,
      'No usable page-coordinate marker geometry was available.',
    );
  }

  const centeredTextboxes = textboxes.filter(textbox =>
    pointInRect(strokeStats.center, textbox.textBox.textRect),
  );
  const overlappingTextboxes = textboxes.filter(textbox =>
    !!intersectionRect(strokeStats.rect, textbox.textBox.textRect),
  );

  logEditMarker('markerTextboxMatching', {
    stroke: buildStrokeLogSummary(marker, strokeStats),
    centeredTextboxCount: centeredTextboxes.length,
    overlappingTextboxCount: overlappingTextboxes.length,
    centeredTextboxes: centeredTextboxes.map(buildTextboxLogSummary),
    overlappingTextboxes: overlappingTextboxes.map(buildTextboxLogSummary),
  });

  if (centeredTextboxes.length !== 1 || overlappingTextboxes.length !== 1) {
    return buildRejectedResult(
      marker,
      'The marker does not land clearly inside exactly one main-layer textbox.',
      {
        stroke: buildStrokeLogSummary(marker, strokeStats),
        centeredTextboxCount: centeredTextboxes.length,
        overlappingTextboxCount: overlappingTextboxes.length,
      },
    );
  }

  if (strokeStats.width < MIN_MARKER_WIDTH) {
    return buildRejectedResult(marker, 'The marker is too short to classify reliably.', {
      stroke: buildStrokeLogSummary(marker, strokeStats),
    });
  }

  if (strokeStats.height > strokeStats.width * MAX_MARKER_HEIGHT_RATIO) {
    return buildRejectedResult(marker, 'The marker is too tall relative to its width.', {
      stroke: buildStrokeLogSummary(marker, strokeStats),
    });
  }

  const targetTextbox = centeredTextboxes[0];
  const text = targetTextbox.textBox.textContentFull || '';
  const textboxRect = targetTextbox.textBox.textRect;
  const rawTextboxWidth = rectWidth(textboxRect);
  const effectiveMeasurementWidth = Math.max(
    24,
    rawTextboxWidth - currentEditMarkerCalibration.widthAdjustment,
  );
  const measurement = await measureDetailedTextLayout(
    text,
    rawTextboxWidth,
    targetTextbox.textBox.fontSize || DEFAULT_FONT_SIZE,
    targetTextbox.textBox.fontPath || undefined,
    currentEditMarkerCalibration,
  );

  if (!measurement) {
    return buildRejectedResult(
      marker,
      'Detailed text layout data was unavailable for the target textbox.',
      {
        stroke: buildStrokeLogSummary(marker, strokeStats),
        targetTextbox: buildTextboxLogSummary(targetTextbox),
      },
    );
  }

  const wordCandidates = buildWordCandidates(
    measurement,
    textboxRect,
    strokeStats,
  );
  const lineWordCandidates = findLineBandWordCandidates(wordCandidates);
  const lineIndexes = findCandidateLineIndexes(lineWordCandidates);
  logEditMarker('markerLineCalibration', {
    stroke: buildStrokeLogSummary(marker, strokeStats),
    targetTextbox: buildTextboxLogSummary(targetTextbox),
    calibration: {
      ...currentEditMarkerCalibration,
      rawTextboxWidth,
      rawTextboxHeight: rectHeight(textboxRect),
      effectiveMeasurementWidth,
      measurementRequestedWidth: measurement.requestedWidth,
      measurementLayoutHeight: measurement.layoutHeight,
      measurementLineCount: measurement.lineCount,
      measurementMaxLineWidth: measurement.maxLineWidth,
    },
    measuredLines: measurement.lines.map(line => buildLineLogSummary(line, textboxRect)),
    allWordCandidates: wordCandidates.map(buildWordLogSummary),
    lineBandCandidates: lineWordCandidates.map(buildWordLogSummary),
    candidateLineIndexes: lineIndexes,
  });
  if (lineIndexes.length !== 1) {
    return buildRejectedResult(
      marker,
      'The marker crosses multiple rendered lines or does not align with a single line.',
      {
        stroke: buildStrokeLogSummary(marker, strokeStats),
        targetTextbox: buildTextboxLogSummary(targetTextbox),
        candidateLineIndexes: lineIndexes,
      },
    );
  }

  const measurementLine = measurement.lines.find(line => line.index === lineIndexes[0]);
  if (!measurementLine) {
    return buildRejectedResult(
      marker,
      'The marker aligned to a rendered line that could not be resolved for preview.',
      {
        stroke: buildStrokeLogSummary(marker, strokeStats),
        targetTextbox: buildTextboxLogSummary(targetTextbox),
        candidateLineIndexes: lineIndexes,
      },
    );
  }

  const lineRect: Rect = {
    left: textboxRect.left + currentEditMarkerCalibration.offsetX + measurementLine.left,
    right: textboxRect.left + currentEditMarkerCalibration.offsetX + measurementLine.right,
    top: textboxRect.top + currentEditMarkerCalibration.offsetY + measurementLine.top,
    bottom: textboxRect.top + currentEditMarkerCalibration.offsetY + measurementLine.bottom,
  };

  const deletionCandidates = lineWordCandidates.filter(
    candidate => candidate.overlapRatio >= 0.5 && isMeaningfulWord(candidate.text),
  );
  logEditMarker('markerWordSelection', {
    stroke: buildStrokeLogSummary(marker, strokeStats),
    targetTextbox: buildTextboxLogSummary(targetTextbox),
    candidateLineIndex: lineIndexes[0],
    deletionCandidates: deletionCandidates.map(buildWordLogSummary),
  });

  if (deletionCandidates.length === 0) {
    return buildRejectedResult(
      marker,
      'No word was covered enough to classify a delete operation.',
      {
        stroke: buildStrokeLogSummary(marker, strokeStats),
        targetTextbox: buildTextboxLogSummary(targetTextbox),
        lineIndex: lineIndexes[0],
      },
    );
  }

  const uniqueByRange = new Map<string, WordCandidate>();
  deletionCandidates.forEach(candidate => {
    uniqueByRange.set(`${candidate.start}-${candidate.end}`, candidate);
  });

  const words = [...uniqueByRange.values()].sort((left, right) => left.start - right.start);

  if (words.length > MAX_DELETE_WORDS_PER_MARKER) {
    return buildRejectedResult(
      marker,
      `The marker would delete too many words at once (${words.length}).`,
      {
        stroke: buildStrokeLogSummary(marker, strokeStats),
        targetTextbox: buildTextboxLogSummary(targetTextbox),
        lineIndex: lineIndexes[0],
        candidateWords: words.map(word => word.text),
      },
    );
  }

  return {
    candidate: {
      marker,
      markerUuid: marker.uuid,
      markerNumInPage: marker.numInPage,
      markerSortTop: strokeStats.rect.top,
      markerSortLeft: strokeStats.rect.left,
      strokeStats,
      targetTextbox,
      lineIndex: lineIndexes[0],
      lineRect,
      words,
    },
  };
}

function isVerticalLikeStroke(strokeStats: StrokeStats): boolean {
  const absoluteAngle = Math.abs(strokeStats.angleDeg);
  const distanceToVertical = Math.abs(90 - Math.min(absoluteAngle, Math.abs(180 - absoluteAngle)));
  return distanceToVertical <= 45 || strokeStats.height >= strokeStats.width;
}

function isPotentialReplaceModifier(
  candidate: MarkerDeleteCandidate,
  strokeAnalysis: MarkerStrokeAnalysis,
): boolean {
  if (strokeAnalysis.marker.uuid === candidate.markerUuid) {
    return false;
  }

  const modifierRect = strokeAnalysis.strokeStats.rect;
  const lineOverlapHeight = rectOverlapHeight(candidate.lineRect, modifierRect);
  const markerCenter = rectCenter(candidate.strokeStats.rect);
  const modifierCenter = rectCenter(modifierRect);
  const markerXMargin = Math.max(16, candidate.strokeStats.width * 0.15);

  return (
    strokeAnalysis.strokeStats.height >= REPLACE_MODIFIER_MIN_HEIGHT &&
    strokeAnalysis.strokeStats.height > strokeAnalysis.strokeStats.width &&
    isVerticalLikeStroke(strokeAnalysis.strokeStats) &&
    lineOverlapHeight >= rectHeight(modifierRect) * 0.5 &&
    modifierCenter.x >= candidate.strokeStats.rect.left - markerXMargin &&
    modifierCenter.x <= candidate.strokeStats.rect.right + markerXMargin &&
    Math.abs(modifierCenter.x - markerCenter.x) <=
      Math.max(REPLACE_MODIFIER_MAX_CENTER_DISTANCE, candidate.strokeStats.width * 0.45) &&
    modifierRect.top <= markerCenter.y &&
    modifierRect.bottom >= markerCenter.y
  );
}

function findBestReplaceModifierPair(
  candidate: MarkerDeleteCandidate,
  strokeAnalyses: MarkerStrokeAnalysis[],
): MarkerStrokeAnalysis[] {
  const matchingModifiers = strokeAnalyses.filter(strokeAnalysis =>
    isPotentialReplaceModifier(candidate, strokeAnalysis),
  );

  if (matchingModifiers.length < 2) {
    return [];
  }

  let bestPair: MarkerStrokeAnalysis[] = [];
  let bestGap = Number.POSITIVE_INFINITY;

  for (let leftIndex = 0; leftIndex < matchingModifiers.length - 1; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < matchingModifiers.length; rightIndex += 1) {
      const left = matchingModifiers[leftIndex];
      const right = matchingModifiers[rightIndex];
      const leftCenter = rectCenter(left.strokeStats.rect);
      const rightCenter = rectCenter(right.strokeStats.rect);
      const gap = Math.abs(leftCenter.x - rightCenter.x);

      if (gap > REPLACE_MODIFIER_PAIR_MAX_GAP || gap >= bestGap) {
        continue;
      }

      bestGap = gap;
      bestPair = [left, right].sort(
        (first, second) => rectCenter(first.strokeStats.rect).x - rectCenter(second.strokeStats.rect).x,
      );
    }
  }

  return bestPair;
}

function parseReplacementLines(textbox: TextElement): ReplacementTextLine[] {
  const text = textbox.textBox.textContentFull || '';
  const lines = text.split(/\r?\n/);
  const rect = textbox.textBox.textRect;

  return lines
    .map((line, index) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('#')) {
        return null;
      }

      const replacementText = trimmed.slice(1).trim();
      if (!replacementText) {
        return null;
      }

      return {
        sourceTextboxUuid: textbox.uuid,
        sourceTextboxNumInPage: textbox.numInPage,
        sourceLineIndex: index,
        sortTop: rect.top + index,
        sortLeft: rect.left,
        text: replacementText,
        rawLine: line,
      };
    })
    .filter((line): line is ReplacementTextLine => !!line);
}

function buildReplacementLineLogSummary(line: ReplacementTextLine): Record<string, unknown> {
  return {
    sourceTextboxUuid: line.sourceTextboxUuid,
    sourceTextboxNumInPage: line.sourceTextboxNumInPage,
    sourceLineIndex: line.sourceLineIndex,
    text: line.text,
    rawLine: line.rawLine,
  };
}

function findReplacementLinesForTextbox(
  targetTextbox: TextElement,
  replaceCandidateCount: number,
  selectedTextboxes: TextElement[],
  targetTextboxesByOrder: TextElement[],
): ReplacementTextLine[] {
  const targetIndex = targetTextboxesByOrder.findIndex(
    textbox => textbox.uuid === targetTextbox.uuid,
  );
  const nextTarget = targetIndex >= 0 ? targetTextboxesByOrder[targetIndex + 1] : null;
  const upperBoundTop = nextTarget ? nextTarget.textBox.textRect.top : Number.POSITIVE_INFINITY;

  const eligibleTextboxes = selectedTextboxes.filter(textbox => {
    if (textbox.uuid === targetTextbox.uuid) {
      return false;
    }

    const textboxRect = textbox.textBox.textRect;
    return (
      textboxRect.top >= targetTextbox.textBox.textRect.bottom &&
      textboxRect.top < upperBoundTop &&
      horizontalOverlapRatio(textboxRect, targetTextbox.textBox.textRect) >=
        REPLACE_SOURCE_HORIZONTAL_OVERLAP_RATIO
    );
  });

  const replacementLines = eligibleTextboxes
    .flatMap(parseReplacementLines)
    .sort((left, right) => {
      if (Math.abs(left.sortTop - right.sortTop) > 1) {
        return left.sortTop - right.sortTop;
      }

      return left.sortLeft - right.sortLeft;
    });

  logEditMarker('replaceSourceResolution', {
    targetTextbox: buildTextboxLogSummary(targetTextbox),
    replaceCandidateCount,
    eligibleTextboxes: eligibleTextboxes.map(buildTextboxLogSummary),
    replacementLines: replacementLines.map(buildReplacementLineLogSummary),
  });

  return replacementLines;
}

function createEmptyPreview(
  selectedMarkerCount = 0,
  selectedTextboxCount = 0,
): EditMarkerPreview {
  return {
    selectedMarkerCount,
    selectedTextboxCount,
    recognizedOperationCount: 0,
    selectionMessage: buildSelectionMessage(selectedMarkerCount, selectedTextboxCount),
    summaryMessage:
      selectedMarkerCount === 0
        ? 'Select one or more handwritten edit markers.'
        : 'No operations recognized yet.',
    beforePreviewBlocks: [],
    afterPreviewBlocks: [],
    beforeBlocks: [],
    afterBlocks: [],
    operations: [],
    ignoredMarkers: [],
    canApply: false,
    applyPlan: null,
  };
}

function buildClipboardSummary(payload: BackupPayload): string {
  const lines = [
    'textboxHelper edit-markers backup',
    `Created: ${payload.createdAt}`,
    `Note: ${payload.notePath}`,
    `Page: ${payload.page}`,
    `Selected markers: ${payload.selectedMarkerCount}`,
    `Recognized operations: ${payload.recognizedOperationCount}`,
    '',
  ];

  payload.texts.forEach((text, index) => {
    lines.push(`#${index + 1}`);
    lines.push(text.textContentFull);
    lines.push('');
  });

  return lines.join('\n').slice(0, CLIPBOARD_PREVIEW_LIMIT);
}

function mergeHighlightRanges(
  ranges: EditMarkerHighlightRange[],
): EditMarkerHighlightRange[] {
  if (ranges.length === 0) {
    return [];
  }

  const sorted = [...ranges]
    .filter(range => range.end > range.start)
    .sort((left, right) => left.start - right.start);
  const merged: EditMarkerHighlightRange[] = [sorted[0]];

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const previous = merged[merged.length - 1];

    if (current.start <= previous.end) {
      previous.end = Math.max(previous.end, current.end);
      continue;
    }

    merged.push({...current});
  }

  return merged;
}

async function writeBackupFile(payload: BackupPayload): Promise<{
  backupPath: string;
  clipboardSummary: string;
}> {
  const pluginDir = await PluginManager.getPluginDirPath();
  const backupDir = `${pluginDir}\\textbox-action-backups`;
  await RNFS.mkdir(backupDir);

  const safeTimestamp = payload.createdAt.replace(/[:.]/g, '-');
  const backupPath = `${backupDir}\\edit-markers-${safeTimestamp}.json`;
  await RNFS.writeFile(backupPath, JSON.stringify(payload, null, 2), 'utf8');

  const clipboardSummary = buildClipboardSummary(payload);
  Clipboard.setString(clipboardSummary);

  return {backupPath, clipboardSummary};
}

function createBackupPayload(plan: EditMarkerApplyPlan): BackupPayload {
  return {
    action: 'edit-markers',
    createdAt: new Date().toISOString(),
    notePath: plan.notePath,
    page: plan.page,
    selectedMarkerCount: plan.selectedMarkerCount,
    recognizedOperationCount: plan.operations.length,
    texts: plan.textMutations.map(text => ({
      uuid: text.uuid,
      numInPage: text.numInPage,
      layerNum: text.layerNum,
      textContentFull: text.originalText,
      textRect: cloneRect(text.textRect),
      fontSize: text.fontSize,
      fontPath: text.fontPath,
      textAlign: text.textAlign,
      textBold: text.textBold,
      textItalics: text.textItalics,
      textFrameWidthType: text.textFrameWidthType,
      textFrameStyle: text.textFrameStyle,
      textEditable: text.textEditable,
    })),
  };
}

function buildReplacementPageElements(
  pageElements: Element[],
  textMutations: TextMutationPlan[],
  recognizedMarkerNums: number[],
  replacementSourceTextboxNums: number[],
): Element[] {
  const textUpdatesByNum = new Map(textMutations.map(update => [update.numInPage, update]));
  const markerNums = new Set(recognizedMarkerNums);
  const replacementSourceNums = new Set(replacementSourceTextboxNums);

  return pageElements
    .filter(element => !markerNums.has(element.numInPage))
    .filter(element => !replacementSourceNums.has(element.numInPage))
    .filter(element => {
      const update = textUpdatesByNum.get(element.numInPage);
      return !update || update.nextText.length > 0;
    })
    .map(element => {
      const update = textUpdatesByNum.get(element.numInPage);
      if (!update || !element.textBox) {
        return {
          ...element,
          textBox: element.textBox
            ? {
                ...element.textBox,
                textRect: element.textBox.textRect
                  ? cloneRect(element.textBox.textRect)
                  : element.textBox.textRect,
              }
            : element.textBox,
        } as Element;
      }

      return {
        ...element,
        textBox: {
          ...element.textBox,
          textContentFull: update.nextText,
          textRect: cloneRect(update.nextTextRect),
        },
      } as Element;
    });
}

async function saveCurrentNoteForConsistency(reason: string): Promise<void> {
  const response = await PluginNoteAPI.saveCurrentNote();
  assertApiSuccess(
    response as {success?: boolean; error?: {message?: string}},
    `Could not save the current note before ${reason}.`,
  );
}

async function replacePageElements(
  notePath: string,
  page: number,
  elements: Element[],
): Promise<void> {
  const response = await PluginFileAPI.replaceElements(
    notePath,
    page,
    elements as unknown as Object[],
  );
  assertApiSuccess(
    response as {success?: boolean; error?: {message?: string}},
    `Could not replace page ${page} elements.`,
  );
}

function reportProgress(
  options: EditMarkerApplyOptions | undefined,
  message: string,
  canCancel: boolean,
): void {
  options?.onProgress?.({message, canCancel});
}

export async function getEditMarkerPreview(
  previewScope: EditMarkerPreviewScope = 'lasso',
): Promise<EditMarkerPreview> {
  let lassoElements: Element[] = [];
  let pageElements: Element[] = [];

  try {
    const context = await getPreviewContext(previewScope);
    lassoElements = context.lassoElements;
    pageElements = context.pageElements;
    const effectiveSelection = context.effectiveSelection;

    const selectedMarkers = effectiveSelection.filter(isSupportedEditMarkerElement);
    const selectedTextboxes = sortTextElements(effectiveSelection.filter(isNormalTextElement));

    if (effectiveSelection.length === 0) {
      return createEmptyPreview();
    }

    if (selectedMarkers.length === 0) {
      return {
        ...createEmptyPreview(0, selectedTextboxes.length),
        summaryMessage: 'Select one or more handwritten edit markers.',
        beforePreviewBlocks: selectedTextboxes.map(textbox => ({
          id: textbox.uuid,
          text: textbox.textBox.textContentFull || '',
          highlightRanges: [],
        })),
        afterPreviewBlocks: selectedTextboxes.map(textbox => ({
          id: textbox.uuid,
          text: textbox.textBox.textContentFull || '',
          highlightRanges: [],
        })),
        beforeBlocks: selectedTextboxes.map(textbox => textbox.textBox.textContentFull || ''),
        afterBlocks: selectedTextboxes.map(textbox => textbox.textBox.textContentFull || ''),
      };
    }

    const pageTextboxes = pageElements.filter(isNormalTextElement);
    logEditMarker('previewContext', {
      previewScope: context.previewScope,
      notePath: context.notePath,
      page: context.page,
      lassoElementCount: lassoElements.length,
      effectiveSelectionCount: effectiveSelection.length,
      selectedMarkerCount: selectedMarkers.length,
      selectedTextboxCount: selectedTextboxes.length,
      pageTextboxCount: pageTextboxes.length,
      selectedTextboxes: selectedTextboxes.map(buildTextboxLogSummary),
      pageTextboxes: pageTextboxes.map(buildTextboxLogSummary),
      selectedMarkers: selectedMarkers.map(marker => ({
        uuid: marker.uuid,
        numInPage: marker.numInPage,
        type: marker.type,
        geometryType: marker.geometry?.type || null,
        layerNum: marker.layerNum,
        recognizeRect: buildRecognizeRect(marker.recognizeResult),
      })),
    });
    const strokeAnalyses = (
      await Promise.all(
        selectedMarkers.map(async marker => {
          const strokeStats = await loadMarkerStrokeStats(marker);
          return strokeStats ? {marker, strokeStats} : null;
        }),
      )
    ).filter((analysis): analysis is MarkerStrokeAnalysis => !!analysis);

    const strokeStatsByUuid = new Map(
      strokeAnalyses.map(analysis => [analysis.marker.uuid, analysis.strokeStats]),
    );

    const candidateResults = await Promise.all(
      selectedMarkers.map(marker =>
        analyzeDeleteMarker(marker, pageTextboxes, strokeStatsByUuid.get(marker.uuid)),
      ),
    );

    const markerCandidates = candidateResults
      .map(result => result.candidate)
      .filter((candidate): candidate is MarkerDeleteCandidate => !!candidate)
      .sort((left, right) => {
        if (Math.abs(left.markerSortTop - right.markerSortTop) > 1) {
          return left.markerSortTop - right.markerSortTop;
        }

        return left.markerSortLeft - right.markerSortLeft;
      });

    const ignoredMarkers = candidateResults
      .map(result => result.ignored)
      .filter((ignored): ignored is IgnoredEditMarker => !!ignored);

    const usedRangesByTextbox = new Map<string, Set<string>>();
    const operations: RecognizedEditOperation[] = [];
    const groupedWords = new Map<string, WordCandidate[]>();
    const groupedTextboxes = new Map<string, TextElement>();
    const groupedRanges = new Map<string, TextMutationRange[]>();
    const replacementSourceTextboxNums = new Set<number>();

    const targetTextboxesByOrder = sortTextElements(
      [
        ...new Map(
          markerCandidates.map(candidate => [candidate.targetTextbox.uuid, candidate.targetTextbox]),
        ).values(),
      ],
    );

    const replaceCandidateInfoByMarkerUuid = new Map<
      string,
      {
        pair: MarkerStrokeAnalysis[];
        replacementText?: string;
        replacementSourceTextboxNum?: number;
        mismatchReason?: string;
      }
    >();

    targetTextboxesByOrder.forEach(targetTextbox => {
      const textboxCandidates = orderTextboxMarkerCandidates(
        markerCandidates.filter(candidate => candidate.targetTextbox.uuid === targetTextbox.uuid),
      );
      const usedModifierMarkerUuids = new Set<string>();
      const replaceCandidates = textboxCandidates
        .map(candidate => ({
          candidate,
          pair: findBestReplaceModifierPair(candidate, strokeAnalyses),
        }))
        .filter(entry => {
          if (
            entry.pair.length !== 2 ||
            entry.pair.some(pairEntry => usedModifierMarkerUuids.has(pairEntry.marker.uuid))
          ) {
            return false;
          }

          entry.pair.forEach(pairEntry => {
            usedModifierMarkerUuids.add(pairEntry.marker.uuid);
          });
          return true;
        });

      if (replaceCandidates.length === 0) {
        return;
      }

      const replacementLines = findReplacementLinesForTextbox(
        targetTextbox,
        replaceCandidates.length,
        selectedTextboxes,
        targetTextboxesByOrder,
      );

      if (replacementLines.length !== replaceCandidates.length) {
        const mismatchReason =
          replacementLines.length === 0
            ? 'Replace markers were found, but no matching replacement lines starting with "#" were found below the paragraph.'
            : `Replace markers were found, but ${replaceCandidates.length} marker(s) need ${replaceCandidates.length} replacement line(s) and only ${replacementLines.length} were found.`;

        replaceCandidates.forEach(entry => {
          replaceCandidateInfoByMarkerUuid.set(entry.candidate.markerUuid, {
            pair: entry.pair,
            mismatchReason,
          });
        });

        logEditMarker('replaceResolutionMismatch', {
          targetTextbox: buildTextboxLogSummary(targetTextbox),
          replaceMarkerCount: replaceCandidates.length,
          replacementLineCount: replacementLines.length,
          replacementLines: replacementLines.map(buildReplacementLineLogSummary),
          reason: mismatchReason,
        });
        return;
      }

      replaceCandidates.forEach((entry, index) => {
        replaceCandidateInfoByMarkerUuid.set(entry.candidate.markerUuid, {
          pair: entry.pair,
          replacementText: replacementLines[index].text,
          replacementSourceTextboxNum: replacementLines[index].sourceTextboxNumInPage,
        });
      });

      logEditMarker('replaceResolutionMatched', {
        targetTextbox: buildTextboxLogSummary(targetTextbox),
        replaceMarkers: replaceCandidates.map(entry => ({
          markerUuid: entry.candidate.markerUuid,
          markerNumInPage: entry.candidate.markerNumInPage,
          modifierMarkerNums: entry.pair.map(pairEntry => pairEntry.marker.numInPage),
        })),
        replacementLines: replacementLines.map(buildReplacementLineLogSummary),
      });
    });

    markerCandidates.forEach(candidate => {
      const replaceInfo = replaceCandidateInfoByMarkerUuid.get(candidate.markerUuid);
      if (replaceInfo?.mismatchReason) {
        ignoredMarkers.push(
          buildIgnoredMarker(candidate.marker, replaceInfo.mismatchReason),
        );
        return;
      }

      const textboxUuid = candidate.targetTextbox.uuid;
      const usedRanges = usedRangesByTextbox.get(textboxUuid) || new Set<string>();
      const nextWords = candidate.words.filter(word => !usedRanges.has(`${word.start}-${word.end}`));

      if (nextWords.length === 0) {
        ignoredMarkers.push(
          buildIgnoredMarker(
            {
              ...candidate.targetTextbox,
              uuid: candidate.markerUuid,
              numInPage: candidate.markerNumInPage,
            } as Element,
            'This marker duplicates text already covered by another recognized marker.',
          ),
        );
        return;
      }

      nextWords.forEach(word => {
        usedRanges.add(`${word.start}-${word.end}`);
      });

      usedRangesByTextbox.set(textboxUuid, usedRanges);
      groupedTextboxes.set(textboxUuid, candidate.targetTextbox);
      groupedWords.set(textboxUuid, [...(groupedWords.get(textboxUuid) || []), ...nextWords]);

      const wordTexts = nextWords.map(word => word.text);
      const kind: EditMarkerOperationKind = replaceInfo?.replacementText ? 'replace' : 'delete';
      if (replaceInfo?.replacementSourceTextboxNum !== undefined) {
        replacementSourceTextboxNums.add(replaceInfo.replacementSourceTextboxNum);
      }
      groupedRanges.set(textboxUuid, [
        ...(groupedRanges.get(textboxUuid) || []),
        {
          kind,
          start: nextWords[0].start,
          end: nextWords[nextWords.length - 1].end,
          replacementText: replaceInfo?.replacementText,
        },
      ]);
      operations.push({
        id: `${candidate.markerUuid}:${candidate.targetTextbox.uuid}`,
        kind,
        markerUuid: candidate.markerUuid,
        markerNumInPage: candidate.markerNumInPage,
        consumedMarkerNums: [
          candidate.markerNumInPage,
          ...(replaceInfo?.pair.map(pairEntry => pairEntry.marker.numInPage) || []),
        ],
        targetTextboxUuid: candidate.targetTextbox.uuid,
        targetTextboxNumInPage: candidate.targetTextbox.numInPage,
        lineIndex: candidate.lineIndex,
        summary: formatOperationSnippet(kind, wordTexts, replaceInfo?.replacementText),
        detail: buildOperationDetailWithReplacement(
          candidate.targetTextbox,
          candidate.lineIndex,
          nextWords,
          replaceInfo?.replacementText,
        ),
        words: wordTexts,
        replacementText: replaceInfo?.replacementText,
      });
    });

    const mutationTargets = sortTextElements([...groupedTextboxes.values()]);
    const textMutations: TextMutationPlan[] = (
      await Promise.all(mutationTargets.map(async textbox => {
        const originalText = textbox.textBox.textContentFull || '';
        const nextText = applyTextMutationRanges(
          originalText,
          groupedRanges.get(textbox.uuid) || [],
        );

        if (nextText === originalText) {
          return null;
        }

        return {
          uuid: textbox.uuid,
          numInPage: textbox.numInPage,
          layerNum: textbox.layerNum,
          originalText,
          nextText,
          textRect: cloneRect(textbox.textBox.textRect),
          nextTextRect: await buildResizedTextboxRect(
            textbox.textBox.textRect,
            nextText,
            textbox.textBox.fontSize || DEFAULT_FONT_SIZE,
            textbox.textBox.fontPath || undefined,
            currentEditMarkerCalibration,
          ),
          fontSize: textbox.textBox.fontSize || DEFAULT_FONT_SIZE,
          fontPath: textbox.textBox.fontPath,
          textAlign: textbox.textBox.textAlign ?? 0,
          textBold: textbox.textBox.textBold ?? 0,
          textItalics: textbox.textBox.textItalics ?? 0,
          textFrameWidthType: textbox.textBox.textFrameWidthType ?? 0,
          textFrameStyle: textbox.textBox.textFrameStyle ?? 0,
          textEditable: textbox.textBox.textEditable ?? 0,
        };
      }))
    ).filter((mutation): mutation is TextMutationPlan => !!mutation);

    const relevantTextboxes =
      textMutations.length > 0
        ? textMutations
        : selectedTextboxes.map(textbox => ({
            uuid: textbox.uuid,
            numInPage: textbox.numInPage,
            layerNum: textbox.layerNum,
            originalText: textbox.textBox.textContentFull || '',
            nextText: textbox.textBox.textContentFull || '',
            textRect: cloneRect(textbox.textBox.textRect),
            nextTextRect: cloneRect(textbox.textBox.textRect),
            fontSize: textbox.textBox.fontSize || DEFAULT_FONT_SIZE,
            fontPath: textbox.textBox.fontPath,
            textAlign: textbox.textBox.textAlign ?? 0,
            textBold: textbox.textBox.textBold ?? 0,
            textItalics: textbox.textBox.textItalics ?? 0,
            textFrameWidthType: textbox.textBox.textFrameWidthType ?? 0,
            textFrameStyle: textbox.textBox.textFrameStyle ?? 0,
            textEditable: textbox.textBox.textEditable ?? 0,
          }));

    const beforePreviewBlocks = relevantTextboxes.map(textbox => ({
      id: textbox.uuid,
      text: textbox.originalText,
      highlightRanges: mergeHighlightRanges(
        (groupedWords.get(textbox.uuid) || []).map(word => ({
          start: word.start,
          end: word.end,
        })),
      ),
    }));
    const afterPreviewBlocks = relevantTextboxes.map(textbox => {
      const detailedMutation = applyTextMutationRangesDetailed(
        textbox.originalText,
        groupedRanges.get(textbox.uuid) || [],
      );

      return {
        id: textbox.uuid,
        text: detailedMutation.text,
        highlightRanges: detailedMutation.insertedRanges,
      };
    });

    const recognizedMarkerNums = [
      ...new Set(operations.flatMap(operation => operation.consumedMarkerNums)),
    ];
    const recognizedMarkerNumSet = new Set(recognizedMarkerNums);
    const visibleIgnoredMarkers = ignoredMarkers.filter(
      marker => !recognizedMarkerNumSet.has(marker.markerNumInPage),
    );
    const applyPlan =
      operations.length > 0 && textMutations.length > 0
        ? {
            notePath: context.notePath,
            page: context.page,
            selectedMarkerCount: selectedMarkers.length,
            operations,
            recognizedMarkerNums,
            replacementSourceTextboxNums: [...replacementSourceTextboxNums],
            textMutations,
          }
        : null;

    return {
      selectedMarkerCount: selectedMarkers.length,
      selectedTextboxCount: selectedTextboxes.length,
      recognizedOperationCount: operations.length,
      selectionMessage: buildSelectionMessage(selectedMarkers.length, selectedTextboxes.length),
      summaryMessage: buildSummaryMessage(
        operations.length,
        visibleIgnoredMarkers.length,
        selectedMarkers.length,
      ),
      beforePreviewBlocks,
      afterPreviewBlocks,
      beforeBlocks: relevantTextboxes.map(textbox => textbox.originalText),
      afterBlocks: relevantTextboxes.map(textbox => textbox.nextText),
      operations,
      ignoredMarkers: visibleIgnoredMarkers,
      canApply: !!applyPlan,
      applyPlan,
    };
  } finally {
    await recycleElements(lassoElements);
    await recycleElements(pageElements);
  }
}

export async function applyEditMarkerPreview(
  preview: EditMarkerPreview,
  options?: EditMarkerApplyOptions,
): Promise<EditMarkerApplyResult> {
  const plan = preview.applyPlan;
  if (!plan || !preview.canApply) {
    throw new Error('No recognized edit marker operations are ready to apply.');
  }

  let pageElements: Element[] = [];

  try {
    reportProgress(options, 'Refreshing page state...', true);
    const pageElementsResponse = await PluginFileAPI.getElements(plan.page, plan.notePath);
    pageElements = assertApiSuccess(
      pageElementsResponse as {success?: boolean; result?: Element[]; error?: {message?: string}},
      `Could not read page ${plan.page} elements before applying edit markers.`,
    );

    const pageTextboxByNum = new Map(
      pageElements.filter(isNormalTextElement).map(element => [element.numInPage, element]),
    );

    plan.textMutations.forEach(mutation => {
      const currentTextbox = pageTextboxByNum.get(mutation.numInPage);
      if (!currentTextbox) {
        throw new Error(
          `Textbox ${mutation.numInPage} is no longer available. Refresh the preview and try again.`,
        );
      }

      const currentText = currentTextbox.textBox.textContentFull || '';
      if (currentText !== mutation.originalText) {
        throw new Error(
          `Textbox ${mutation.numInPage} changed after preview. Refresh the review before applying.`,
        );
      }
    });

    reportProgress(options, 'Creating backup...', true);
    const backupPayload = createBackupPayload(plan);
    const {backupPath, clipboardSummary} = await writeBackupFile(backupPayload);

    reportProgress(options, 'Saving current note...', false);
    await saveCurrentNoteForConsistency('applying edit markers');

    reportProgress(options, 'Applying recognized markers...', false);
    const replacementElements = buildReplacementPageElements(
      pageElements,
      plan.textMutations,
      plan.recognizedMarkerNums,
      plan.replacementSourceTextboxNums,
    );
    await replacePageElements(plan.notePath, plan.page, replacementElements);

    const hideResponse = await PluginCommAPI.setLassoBoxState(2);
    if (!hideResponse?.success) {
      console.log(
        '[EditMarkerActions] setLassoBoxState failed',
        JSON.stringify(hideResponse),
      );
    }

    return {
      message: `Applied ${plan.operations.length} recognized edit operations and removed ${plan.recognizedMarkerNums.length} marker(s).`,
      backupPath,
      clipboardSummary,
      appliedOperationCount: plan.operations.length,
      removedMarkerCount: plan.recognizedMarkerNums.length,
      affectedTextboxCount: plan.textMutations.length,
    };
  } finally {
    await recycleElements(pageElements);
  }
}
