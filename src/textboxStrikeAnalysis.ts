import {NativeModules} from 'react-native';
import {
  Element,
  EventType,
  PluginCommAPI,
  PluginFileAPI,
  PluginManager,
  PluginNoteAPI,
  PointUtils,
  type Point,
  type Rect,
  type TextBox,
} from 'sn-plugin-lib';

const MAIN_LAYER = 0;
const TEXT_TYPE_NORMAL = 500;
const STRIKE_ANALYSIS_TIMEOUT_MS = 4500;
const RECENT_STROKE_RETENTION_MS = 8000;

type TextElement = Element & {
  textBox: TextBox;
};

type StrikeAnalysisReport = {
  title: string;
  message: string;
  meta: string;
  createdAt: string;
};

type PageSize = {
  width: number;
  height: number;
};

type RecognizeResultLike = {
  predict_name?: unknown;
  up_left_point_x?: unknown;
  up_left_point_y?: unknown;
  key_point_x?: unknown;
  key_point_y?: unknown;
  down_right_point_x?: unknown;
  down_right_point_y?: unknown;
};

type NativeDetailedLine = {
  index: number;
  start: number;
  end: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  baseline: number;
  width: number;
};

type NativeDetailedWord = {
  start: number;
  end: number;
  tokenStart: number;
  tokenEnd: number;
  lineIndex: number;
  text: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

type NativeDetailedMeasurement = {
  text: string;
  requestedWidth: number;
  requestedFontSize: number;
  includePad: boolean;
  layoutHeight: number;
  lineCount: number;
  maxLineWidth: number;
  lines: NativeDetailedLine[];
  words: NativeDetailedWord[];
};

type NativeDetailedMetricsModuleType = {
  measureTextLayoutDetailed(options: {
    text: string;
    width: number;
    fontSize: number;
    includePad?: boolean;
    fontPath?: string;
  }): Promise<NativeDetailedMeasurement>;
};

type StrokeStats = {
  pointCount: number;
  rect: Rect;
  width: number;
  height: number;
  pathLength: number;
  directDistance: number;
  straightness: number;
  angleDeg: number;
  firstPoint: Point;
  lastPoint: Point;
  center: Point;
};

type WordCandidate = NativeDetailedWord & {
  absoluteLeft: number;
  absoluteRight: number;
  absoluteTop: number;
  absoluteBottom: number;
  absoluteCenterX: number;
  absoluteCenterY: number;
  overlapRatio: number;
  projectedY: number;
};

const textboxMetricsModule = NativeModules.TextboxMetrics as
  | NativeDetailedMetricsModuleType
  | undefined;

let isStrikeAnalysisInitialized = false;
let isStrikeAnalysisInFlight = false;
let queuedRawPenUpEvent: unknown | null = null;
let strikeMutationCooldownUntil = 0;
const recentlyHandledStrokeUuids = new Map<string, number>();
const DEVICE_TYPE_LABELS: Record<number, string> = {
  0: 'A5',
  1: 'A6',
  2: 'A6X',
  3: 'A5X',
  4: 'A6X2',
  5: 'A5X2',
};

function logStrikeAnalysis(stage: string, payload?: unknown): void {
  if (payload === undefined) {
    console.log(`[TextboxStrikeAnalysis] ${stage}`);
    return;
  }

  try {
    console.log(`[TextboxStrikeAnalysis] ${stage}`, JSON.stringify(payload));
  } catch {
    console.log(`[TextboxStrikeAnalysis] ${stage}`, String(payload));
  }
}

function logStrikeSummary(message: string): void {
  console.log(`[TextboxStrikeSummary] ${message}`);
}

function setStrikeMutationCooldown(durationMs: number): void {
  strikeMutationCooldownUntil = Date.now() + durationMs;
}

function buildReport(title: string, message: string, meta: string): StrikeAnalysisReport {
  return {
    title,
    message,
    meta,
    createdAt: new Date().toISOString(),
  };
}

function logStrikeAnalysisReport(report: StrikeAnalysisReport): void {
  logStrikeAnalysis('report', report);
  logStrikeSummary(`${report.meta}: ${report.message.replace(/\n+/g, ' | ')}`);
}

function summarizeEventElements(rawEvent: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(rawEvent)) {
    return [];
  }

  return rawEvent.map(item => ({
    uuid: typeof item?.uuid === 'string' ? item.uuid : null,
    type: typeof item?.type === 'number' ? item.type : null,
    pageNum: typeof item?.pageNum === 'number' ? item.pageNum : null,
    layerNum: typeof item?.layerNum === 'number' ? item.layerNum : null,
    numInPage: typeof item?.numInPage === 'number' ? item.numInPage : null,
    maxX: typeof item?.maxX === 'number' ? item.maxX : null,
    maxY: typeof item?.maxY === 'number' ? item.maxY : null,
    recognizeResult: summarizeRecognizeResult(
      item && typeof item === 'object' ? (item as {recognizeResult?: unknown}).recognizeResult : null,
    ),
  }));
}

function roundNumber(value: number): number {
  return Math.round(value * 100) / 100;
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function summarizeRecognizeResult(rawRecognizeResult: unknown): Record<string, unknown> | null {
  if (!rawRecognizeResult || typeof rawRecognizeResult !== 'object') {
    return null;
  }

  const recognizeResult = rawRecognizeResult as RecognizeResultLike;
  const left = toFiniteNumber(recognizeResult.up_left_point_x);
  const top = toFiniteNumber(recognizeResult.up_left_point_y);
  const right = toFiniteNumber(recognizeResult.down_right_point_x);
  const bottom = toFiniteNumber(recognizeResult.down_right_point_y);

  return {
    predictName:
      typeof recognizeResult.predict_name === 'string' ? recognizeResult.predict_name : null,
    upLeft:
      left !== null && top !== null
        ? {
            x: left,
            y: top,
          }
        : null,
    keyPoint:
      toFiniteNumber(recognizeResult.key_point_x) !== null &&
      toFiniteNumber(recognizeResult.key_point_y) !== null
        ? {
            x: toFiniteNumber(recognizeResult.key_point_x),
            y: toFiniteNumber(recognizeResult.key_point_y),
          }
        : null,
    downRight:
      right !== null && bottom !== null
        ? {
            x: right,
            y: bottom,
          }
        : null,
    rect:
      left !== null && top !== null && right !== null && bottom !== null
        ? roundRect({
            left,
            top,
            right,
            bottom,
          })
        : null,
  };
}

function summarizeRawEventShape(rawEvent: unknown): Record<string, unknown> {
  if (!Array.isArray(rawEvent)) {
    return {
      isArray: false,
      rawType: typeof rawEvent,
    };
  }

  const firstItem = rawEvent[0];
  return {
    isArray: true,
    elementCount: rawEvent.length,
    firstItemKeys:
      firstItem && typeof firstItem === 'object' ? Object.keys(firstItem).sort() : [],
  };
}

function pruneRecentStrokeUuids(now = Date.now()): void {
  for (const [uuid, timestamp] of recentlyHandledStrokeUuids.entries()) {
    if (now - timestamp > RECENT_STROKE_RETENTION_MS) {
      recentlyHandledStrokeUuids.delete(uuid);
    }
  }
}

function markStrokeUuidHandled(uuid: string): void {
  pruneRecentStrokeUuids();
  recentlyHandledStrokeUuids.set(uuid, Date.now());
}

function hasRecentlyHandledStrokeUuid(uuid: string): boolean {
  pruneRecentStrokeUuids();
  const timestamp = recentlyHandledStrokeUuids.get(uuid);
  return typeof timestamp === 'number' && Date.now() - timestamp <= RECENT_STROKE_RETENTION_MS;
}

function getEventStrokeElement(rawEvent: unknown): Element | null {
  if (!Array.isArray(rawEvent)) {
    return null;
  }

  const strokes = rawEvent.filter(
    item =>
      item &&
      typeof item === 'object' &&
      (item as {type?: unknown}).type === Element.TYPE_STROKE,
  );

  if (strokes.length !== 1) {
    return null;
  }

  return strokes[0] as Element;
}

function getSingleStrokeUuid(rawEvent: unknown): string | null {
  const stroke = getEventStrokeElement(rawEvent);
  return stroke && typeof stroke.uuid === 'string' && stroke.uuid.length > 0 ? stroke.uuid : null;
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

function cloneRect(rect: Rect): Rect {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  };
}

function roundPoint(point: Point): Point {
  return {
    x: Math.round(point.x * 100) / 100,
    y: Math.round(point.y * 100) / 100,
  };
}

function roundRect(rect: Rect): Rect {
  return {
    left: roundNumber(rect.left),
    top: roundNumber(rect.top),
    right: roundNumber(rect.right),
    bottom: roundNumber(rect.bottom),
  };
}

function rectWidth(rect: Rect): number {
  return Math.max(0, rect.right - rect.left);
}

function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  );
}

function intersectionRect(left: Rect, right: Rect): Rect | null {
  const rect: Rect = {
    left: Math.max(left.left, right.left),
    top: Math.max(left.top, right.top),
    right: Math.min(left.right, right.right),
    bottom: Math.min(left.bottom, right.bottom),
  };

  if (rect.right <= rect.left || rect.bottom <= rect.top) {
    return null;
  }

  return rect;
}

function isNormalTextElement(element: Element): element is TextElement {
  return (
    element.type === TEXT_TYPE_NORMAL &&
    element.layerNum === MAIN_LAYER &&
    !!element.textBox?.textContentFull &&
    !!element.textBox?.textRect
  );
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

async function readStrokePoints(element: Element): Promise<Point[]> {
  const accessor = element.stroke?.points;
  if (!accessor) {
    logStrikeAnalysis('strokePointsMissingAccessor', {
      uuid: element.uuid,
      type: element.type,
    });
    return [];
  }

  logStrikeAnalysis('strokePointsSizeStart', {
    uuid: element.uuid,
  });
  const size = await accessor.size();
  logStrikeAnalysis('strokePointsSizeDone', {
    uuid: element.uuid,
    size,
  });
  if (!Number.isFinite(size) || size <= 0) {
    return [];
  }

  logStrikeAnalysis('strokePointsRangeStart', {
    uuid: element.uuid,
    size,
  });
  const points = await accessor.getRange(0, size);
  logStrikeAnalysis('strokePointsRangeDone', {
    uuid: element.uuid,
    size,
    loadedCount: points.length,
  });
  return points.filter(
    point =>
      point &&
      typeof point.x === 'number' &&
      Number.isFinite(point.x) &&
      typeof point.y === 'number' &&
      Number.isFinite(point.y),
  );
}

function buildStrokeStats(points: Point[]): StrokeStats | null {
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
    pointCount: points.length,
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

function extractSingleStrokeReference(rawEvent: unknown): {
  numInPage: number;
  pageNum: number | null;
} | null {
  if (!Array.isArray(rawEvent)) {
    return null;
  }

  const strokes = rawEvent.filter(item => item && typeof item === 'object' && item.type === Element.TYPE_STROKE);
  if (strokes.length !== 1) {
    return null;
  }

  const stroke = strokes[0] as {numInPage?: unknown; pageNum?: unknown};
  if (typeof stroke.numInPage !== 'number' || !Number.isInteger(stroke.numInPage)) {
    return null;
  }

  return {
    numInPage: stroke.numInPage,
    pageNum:
      typeof stroke.pageNum === 'number' && Number.isInteger(stroke.pageNum)
        ? stroke.pageNum
        : null,
  };
}

async function loadPageSize(notePath: string, page: number): Promise<PageSize | null> {
  const response = (await PluginFileAPI.getPageSize(notePath, page)) as {
    success?: boolean;
    result?: {width?: unknown; height?: unknown};
    error?: {message?: string};
  };

  if (!response?.success) {
    throw new Error(response?.error?.message || `Could not read page size for page ${page}.`);
  }

  const width = response.result?.width;
  const height = response.result?.height;
  if (
    typeof width !== 'number' ||
    !Number.isFinite(width) ||
    width <= 0 ||
    typeof height !== 'number' ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    logStrikeAnalysis('pageSizeInvalid', {
      page,
      result: response.result ?? null,
    });
    return null;
  }

  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}

function convertPointsToAndroid(points: Point[], pageSize: PageSize): Point[] {
  return points
    .map(point => PointUtils.emrPoint2Android(point, pageSize))
    .filter(
      point =>
        point &&
        typeof point.x === 'number' &&
        Number.isFinite(point.x) &&
        typeof point.y === 'number' &&
        Number.isFinite(point.y),
    );
}

function convertEmrPointWithMax(
  point: Point,
  pageSize: PageSize,
  maxX: number,
  maxY: number,
): Point | null {
  if (
    !Number.isFinite(maxX) ||
    maxX <= 0 ||
    !Number.isFinite(maxY) ||
    maxY <= 0 ||
    pageSize.width <= 1 ||
    pageSize.height <= 1
  ) {
    return null;
  }

  const mappingTimesX = maxX / (pageSize.height - 1);
  const mappingTimesY = maxY / (pageSize.width - 1);
  if (!Number.isFinite(mappingTimesX) || !Number.isFinite(mappingTimesY) || mappingTimesX <= 0 || mappingTimesY <= 0) {
    return null;
  }

  const srcPoint: Point = {
    x: point.x / mappingTimesX,
    y: point.y / mappingTimesY,
  };

  return {
    x: pageSize.width - 1 - srcPoint.y,
    y: srcPoint.x,
  };
}

function convertPointsToAndroidWithMax(
  points: Point[],
  pageSize: PageSize,
  maxX: number,
  maxY: number,
): Point[] {
  return points
    .map(point => convertEmrPointWithMax(point, pageSize, maxX, maxY))
    .filter(
      (point): point is Point =>
        !!point &&
        typeof point.x === 'number' &&
        Number.isFinite(point.x) &&
        typeof point.y === 'number' &&
        Number.isFinite(point.y),
    );
}

function buildRecognizeRect(rawRecognizeResult: unknown): Rect | null {
  const summary = summarizeRecognizeResult(rawRecognizeResult);
  const rect = (summary?.rect ?? null) as
    | {left?: unknown; top?: unknown; right?: unknown; bottom?: unknown}
    | null;
  if (
    !rect ||
    typeof rect.left !== 'number' ||
    typeof rect.top !== 'number' ||
    typeof rect.right !== 'number' ||
    typeof rect.bottom !== 'number'
  ) {
    return null;
  }

  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  };
}

function summarizeStrokeStats(stats: StrokeStats | null): Record<string, unknown> | null {
  if (!stats) {
    return null;
  }

  return {
    rect: roundRect(stats.rect),
    center: roundPoint(stats.center),
    firstPoint: roundPoint(stats.firstPoint),
    lastPoint: roundPoint(stats.lastPoint),
    width: roundNumber(stats.width),
    height: roundNumber(stats.height),
    angleDeg: roundNumber(stats.angleDeg),
    straightness: roundNumber(stats.straightness),
    pointCount: stats.pointCount,
  };
}

async function measureDetailedTextLayout(
  text: string,
  width: number,
  fontSize: number,
  fontPath?: string,
): Promise<NativeDetailedMeasurement | null> {
  if (!textboxMetricsModule?.measureTextLayoutDetailed) {
    return null;
  }

  try {
    return await textboxMetricsModule.measureTextLayoutDetailed({
      text,
      width,
      fontSize,
      includePad: true,
      ...(fontPath ? {fontPath} : {}),
    });
  } catch (error) {
    logStrikeAnalysis('nativeDetailedMeasurementError', {
      width,
      fontSize,
      fontPath: fontPath || null,
      textPreview: text.slice(0, 80),
      error: String(error),
    });
    return null;
  }
}

function projectYOnStroke(stats: StrokeStats, x: number): number {
  const dx = stats.lastPoint.x - stats.firstPoint.x;
  if (Math.abs(dx) < 0.0001) {
    return stats.center.y;
  }

  const t = (x - stats.firstPoint.x) / dx;
  return stats.firstPoint.y + (stats.lastPoint.y - stats.firstPoint.y) * t;
}

function buildWordCandidates(
  measurement: NativeDetailedMeasurement,
  textRect: Rect,
  stroke: StrokeStats,
): WordCandidate[] {
  return measurement.words.map(word => {
    const absoluteLeft = textRect.left + word.left;
    const absoluteRight = textRect.left + word.right;
    const absoluteTop = textRect.top + word.top;
    const absoluteBottom = textRect.top + word.bottom;
    const absoluteCenterX = textRect.left + word.centerX;
    const absoluteCenterY = textRect.top + word.centerY;
    const overlapLeft = Math.max(absoluteLeft, stroke.rect.left);
    const overlapRight = Math.min(absoluteRight, stroke.rect.right);
    const overlapWidth = Math.max(0, overlapRight - overlapLeft);
    const overlapRatio = word.width > 0 ? overlapWidth / word.width : 0;

    return {
      ...word,
      absoluteLeft,
      absoluteRight,
      absoluteTop,
      absoluteBottom,
      absoluteCenterX,
      absoluteCenterY,
      overlapRatio,
      projectedY: projectYOnStroke(stroke, absoluteCenterX),
    };
  });
}

function formatWordsForMessage(words: WordCandidate[]): string {
  if (words.length === 0) {
    return '(none)';
  }

  return words
    .map(word => `"${word.text}" (${Math.round(word.overlapRatio * 100)}%)`)
    .join(', ');
}

function isMeaningfulWord(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

function normalizeTextAfterDeletion(text: string): string {
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

  return normalizeTextAfterDeletion(nextText);
}

function cloneElementForMutation<T extends Element>(element: T): T {
  return {
    ...element,
    textBox: element.textBox
      ? {
          ...element.textBox,
          textRect: element.textBox.textRect ? cloneRect(element.textBox.textRect) : element.textBox.textRect,
        }
      : element.textBox,
  } as T;
}

async function mutateTextboxText(
  notePath: string,
  page: number,
  textboxElement: TextElement,
  nextText: string,
): Promise<void> {
  const updatedElement = cloneElementForMutation(textboxElement);
  updatedElement.textBox.textContentFull = nextText;
  const response = await PluginFileAPI.modifyElements(notePath, page, [updatedElement as unknown as Object]);
  assertApiSuccess(
    response as {success?: boolean; error?: {message?: string}},
    `Could not modify textbox ${textboxElement.numInPage} on page ${page}.`,
  );
}

async function replacePageElements(notePath: string, page: number, elements: Element[]): Promise<void> {
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

async function deletePageElements(notePath: string, page: number, numsInPage: number[]): Promise<void> {
  const uniqueNums = [...new Set(numsInPage)].filter(num => Number.isInteger(num) && num >= 0);
  const response = await PluginFileAPI.deleteElements(notePath, page, uniqueNums);
  assertApiSuccess(
    response as {success?: boolean; error?: {message?: string}},
    `Could not delete page elements ${uniqueNums.join(', ')} on page ${page}.`,
  );
}

async function saveCurrentNoteForConsistency(reason: string): Promise<void> {
  logStrikeAnalysis('saveCurrentNoteStart', {reason});
  const response = await PluginNoteAPI.saveCurrentNote();
  assertApiSuccess(
    response as {success?: boolean; error?: {message?: string}},
    `Could not save current note before ${reason}.`,
  );
  logStrikeAnalysis('saveCurrentNoteDone', {reason});
}

function buildReplacementPageElements(
  pageElements: Element[],
  textboxNumInPage: number,
  nextText: string,
  strikeNumInPage: number,
): Element[] {
  return pageElements
    .filter(element => element.numInPage !== strikeNumInPage)
    .filter(element => !(nextText.length === 0 && element.numInPage === textboxNumInPage))
    .map(element => {
      const clone = cloneElementForMutation(element);
      if (clone.numInPage === textboxNumInPage && clone.textBox) {
        clone.textBox.textContentFull = nextText;
      }
      return clone;
    });
}

async function analyzePenUpEvent(rawEvent: unknown): Promise<StrikeAnalysisReport | null> {
  logStrikeAnalysis('eventReceived', {
    eventSummary: summarizeEventElements(rawEvent),
    eventShape: summarizeRawEventShape(rawEvent),
  });

  const eventStrokeElement = getEventStrokeElement(rawEvent);
  const strokeRef = extractSingleStrokeReference(rawEvent);
  if (!strokeRef) {
    logStrikeAnalysis('earlyReject', {
      reason: 'Expected exactly one stroke with a valid numInPage in event payload.',
    });
    logStrikeSummary('event ignored: no single usable stroke in pen-up payload');
    return buildReport(
      'Strike Analysis',
      'Early reject: expected exactly one stroke with a valid `numInPage` in the pen-up payload.',
      'Event payload only',
    );
  }

  const notePath = assertApiSuccess(
    (await PluginCommAPI.getCurrentFilePath()) as {
      success?: boolean;
      result?: string;
      error?: {message?: string};
    },
    'Could not determine the current note path for strike analysis.',
  );

  const currentPage = assertApiSuccess(
    (await PluginCommAPI.getCurrentPageNum()) as {
      success?: boolean;
      result?: number;
      error?: {message?: string};
    },
    'Could not determine the current page for strike analysis.',
  );
  const page = strokeRef.pageNum ?? currentPage;

  let strokeElement: Element | null = null;
  let pageElements: Element[] = [];

  try {
    logStrikeAnalysis('contextLookupStart', {
      page,
      numInPage: strokeRef.numInPage,
      source: 'event-only',
    });
    strokeElement = eventStrokeElement;
    logStrikeAnalysis('contextLookupDone', {
      page,
      numInPage: strokeRef.numInPage,
      source: 'event',
      hasElement: !!strokeElement,
    });
    logStrikeSummary(`stroke ${strokeRef.numInPage} on page ${page}: analysis started`);

    if (!strokeElement) {
      logStrikeSummary(`stroke ${strokeRef.numInPage} on page ${page}: unusable event payload`);
      return buildReport(
        'Strike Analysis',
        'Late reject: the pen-up event was received, but the stroke payload was not usable.',
        `Page ${page} · stroke ${strokeRef.numInPage}`,
      );
    }

    if (strokeElement.type !== Element.TYPE_STROKE) {
      logStrikeAnalysis('lateReject', {
        reason: 'Loaded element is not a stroke.',
        type: strokeElement.type,
      });
      return buildReport(
        'Strike Analysis',
        `Late reject: loaded element is not a stroke.\nType: ${String(strokeElement.type)}.`,
        `Page ${page} · stroke ${strokeRef.numInPage}`,
      );
    }

    if (strokeElement.layerNum !== MAIN_LAYER) {
      logStrikeAnalysis('lateReject', {
        reason: 'Stroke is not on the main layer.',
        layerNum: strokeElement.layerNum,
      });
      return buildReport(
        'Strike Analysis',
        `Late reject: stroke is not on the main layer.\nLayer: ${String(strokeElement.layerNum)}.`,
        `Page ${page} · stroke ${strokeRef.numInPage}`,
      );
    }

    const emrPoints = await readStrokePoints(strokeElement);
    const emrStrokeStats = buildStrokeStats(emrPoints);
    if (!emrStrokeStats) {
      logStrikeAnalysis('lateReject', {
        reason: 'Stroke did not provide enough EMR points for analysis.',
        pointCount: emrPoints.length,
      });
      return buildReport(
        'Strike Analysis',
        `Late reject: stroke did not provide enough points for analysis.\nPoint count: ${emrPoints.length}.`,
        `Page ${page} · stroke ${strokeRef.numInPage}`,
      );
    }

    logStrikeAnalysis('pageSizeStart', {
      page,
    });
    const pageSize = await loadPageSize(notePath, page);
    logStrikeAnalysis('pageSizeDone', {
      page,
      pageSize,
    });
    if (!pageSize) {
      return buildReport(
        'Strike Analysis',
        'Late reject: page size was unavailable, so EMR-to-pixel conversion could not run.',
        `Page ${page} · stroke ${strokeRef.numInPage}`,
      );
    }

    const androidPoints = convertPointsToAndroid(emrPoints, pageSize);
    const androidStrokeStats = buildStrokeStats(androidPoints);
    if (!androidStrokeStats) {
      logStrikeAnalysis('lateReject', {
        reason: 'Converted Android stroke did not provide enough points for analysis.',
        pointCount: androidPoints.length,
      });
      return buildReport(
        'Strike Analysis',
        `Late reject: converted stroke did not provide enough points for analysis.\nPoint count: ${androidPoints.length}.`,
        `Page ${page} · stroke ${strokeRef.numInPage}`,
      );
    }

    const recognizeRect = buildRecognizeRect(strokeElement.recognizeResult);
    const elementMaxX =
      typeof strokeElement.maxX === 'number' && Number.isFinite(strokeElement.maxX)
        ? strokeElement.maxX
        : null;
    const elementMaxY =
      typeof strokeElement.maxY === 'number' && Number.isFinite(strokeElement.maxY)
        ? strokeElement.maxY
        : null;
    const elementMaxAndroidStrokeStats =
      elementMaxX !== null && elementMaxY !== null
        ? buildStrokeStats(convertPointsToAndroidWithMax(emrPoints, pageSize, elementMaxX, elementMaxY))
        : null;
    const elementMaxSwappedAndroidStrokeStats =
      elementMaxX !== null && elementMaxY !== null
        ? buildStrokeStats(convertPointsToAndroidWithMax(emrPoints, pageSize, elementMaxY, elementMaxX))
        : null;
    const selectedCoordinateSource = elementMaxAndroidStrokeStats
      ? 'element-max'
      : 'sdk-point-utils';
    const selectedStrokeStats = elementMaxAndroidStrokeStats ?? androidStrokeStats;

    logStrikeAnalysis('strokeCoordinateComparison', {
      page,
      pageSize,
      strokeUuid: strokeElement.uuid,
      selectedCoordinateSource,
      eventDiagnostics: {
        maxX: elementMaxX,
        maxY: elementMaxY,
        recognizeResult: summarizeRecognizeResult(strokeElement.recognizeResult),
      },
      emr: {
        rect: roundRect(emrStrokeStats.rect),
        center: roundPoint(emrStrokeStats.center),
        firstPoint: roundPoint(emrStrokeStats.firstPoint),
        lastPoint: roundPoint(emrStrokeStats.lastPoint),
        width: roundNumber(emrStrokeStats.width),
        height: roundNumber(emrStrokeStats.height),
      },
      android: {
        rect: roundRect(androidStrokeStats.rect),
        center: roundPoint(androidStrokeStats.center),
        firstPoint: roundPoint(androidStrokeStats.firstPoint),
        lastPoint: roundPoint(androidStrokeStats.lastPoint),
        width: roundNumber(androidStrokeStats.width),
        height: roundNumber(androidStrokeStats.height),
      },
      candidates: {
        sdkPointUtils: summarizeStrokeStats(androidStrokeStats),
        elementMax: summarizeStrokeStats(elementMaxAndroidStrokeStats),
        elementMaxSwapped: summarizeStrokeStats(elementMaxSwappedAndroidStrokeStats),
        recognizeRect: recognizeRect ? {rect: roundRect(recognizeRect)} : null,
      },
    });
    logStrikeSummary(
      `stroke ${strokeRef.numInPage} on page ${page}: using ${selectedCoordinateSource} coordinates`,
    );

    logStrikeAnalysis('pageElementsStart', {
      page,
    });
    pageElements = assertApiSuccess(
      (await PluginFileAPI.getElements(page, notePath)) as {
        success?: boolean;
        result?: Element[];
        error?: {message?: string};
      },
      `Could not read page ${page} elements for strike analysis.`,
    );
    logStrikeAnalysis('pageElementsDone', {
      page,
      count: pageElements.length,
    });

    const textboxes = pageElements.filter(isNormalTextElement);
    const centeredTextboxes = textboxes.filter(element =>
      pointInRect(selectedStrokeStats.center, element.textBox.textRect),
    );
    const overlappingTextboxes = textboxes.filter(element =>
      !!intersectionRect(selectedStrokeStats.rect, element.textBox.textRect),
    );

    logStrikeAnalysis('textboxLookup', {
      page,
      coordinateSource: selectedCoordinateSource,
      strokeRectEmr: roundRect(emrStrokeStats.rect),
      strokeCenterEmr: roundPoint(emrStrokeStats.center),
      strokeRectAndroid: roundRect(selectedStrokeStats.rect),
      strokeCenterAndroid: roundPoint(selectedStrokeStats.center),
      strokeRectRecognize: recognizeRect ? roundRect(recognizeRect) : null,
      strokeRectElementMax: elementMaxAndroidStrokeStats
        ? roundRect(elementMaxAndroidStrokeStats.rect)
        : null,
      strokeRectElementMaxSwapped: elementMaxSwappedAndroidStrokeStats
        ? roundRect(elementMaxSwappedAndroidStrokeStats.rect)
        : null,
      textboxes: textboxes.length,
      textboxRects: textboxes.map(element => ({
        uuid: element.uuid,
        numInPage: element.numInPage,
        rect: roundRect(cloneRect(element.textBox.textRect)),
      })),
      centeredTextboxUuids: centeredTextboxes.map(element => element.uuid),
      overlappingTextboxUuids: overlappingTextboxes.map(element => element.uuid),
    });
    logStrikeSummary(
      `stroke ${strokeRef.numInPage} on page ${page}: textbox matches centered=${centeredTextboxes.length}, overlapping=${overlappingTextboxes.length}`,
    );

    if (centeredTextboxes.length !== 1 || overlappingTextboxes.length !== 1) {
      logStrikeAnalysis('earlyReject', {
        reason: 'Stroke is not clearly inside exactly one textbox.',
        centeredTextboxCount: centeredTextboxes.length,
        overlappingTextboxCount: overlappingTextboxes.length,
      });
      return buildReport(
        'Strike Analysis',
        `Early reject: stroke is not clearly inside exactly one textbox.\nCentered matches: ${centeredTextboxes.length}. Overlapping matches: ${overlappingTextboxes.length}.`,
        `Page ${page} · stroke ${strokeRef.numInPage}`,
      );
    }

    const textbox = centeredTextboxes[0];
    const text = textbox.textBox.textContentFull || '';
    logStrikeSummary(
      `stroke ${strokeRef.numInPage} on page ${page}: matched textbox ${textbox.numInPage} "${text
        .slice(0, 40)
        .replace(/\s+/g, ' ')}"`,
    );
    const width = rectWidth(textbox.textBox.textRect);
    const fontSize = textbox.textBox.fontSize || 32;
    const measurement = await measureDetailedTextLayout(
      text,
      width,
      fontSize,
      textbox.textBox.fontPath || undefined,
    );
    logStrikeAnalysis('nativeMeasurementDone', {
      page,
      textboxNumInPage: textbox.numInPage,
      hasMeasurement: !!measurement,
    });

    logStrikeAnalysis('lateStageInput', {
      strokeEmr: {
        pointCount: emrStrokeStats.pointCount,
        rect: roundRect(emrStrokeStats.rect),
        width: emrStrokeStats.width,
        height: emrStrokeStats.height,
        straightness: emrStrokeStats.straightness,
        angleDeg: emrStrokeStats.angleDeg,
        pathLength: emrStrokeStats.pathLength,
      },
      strokeAndroid: {
        pointCount: selectedStrokeStats.pointCount,
        rect: roundRect(selectedStrokeStats.rect),
        width: selectedStrokeStats.width,
        height: selectedStrokeStats.height,
        straightness: selectedStrokeStats.straightness,
        angleDeg: selectedStrokeStats.angleDeg,
        pathLength: selectedStrokeStats.pathLength,
        coordinateSource: selectedCoordinateSource,
      },
      textbox: {
        uuid: textbox.uuid,
        rect: roundRect(cloneRect(textbox.textBox.textRect)),
        textPreview: text.slice(0, 160),
        textLength: text.length,
      },
      measurementSummary: measurement
        ? {
            lineCount: measurement.lineCount,
            wordCount: measurement.words.length,
          }
        : null,
    });

    if (!measurement) {
      return buildReport(
        'Strike Analysis',
        'Late reject: detailed text measurement is not available yet.\nThe stroke is inside one textbox, but word hit-testing could not run.',
        `Page ${page} · textbox ${textbox.numInPage}`,
      );
    }

    if (selectedStrokeStats.width < 30) {
      return buildReport(
        'Strike Analysis',
        `Late reject: stroke is too short for a strike-through.\nWidth: ${Math.round(selectedStrokeStats.width)} px.`,
        `Page ${page} · textbox ${textbox.numInPage}`,
      );
    }

    if (selectedStrokeStats.lastPoint.x <= selectedStrokeStats.firstPoint.x) {
      return buildReport(
        'Strike Analysis',
        'Late reject: stroke does not run left to right.',
        `Page ${page} · textbox ${textbox.numInPage}`,
      );
    }

    if (selectedStrokeStats.height > selectedStrokeStats.width * 0.45) {
      return buildReport(
        'Strike Analysis',
        `Late reject: stroke is too tall relative to its width.\nWidth/height: ${Math.round(selectedStrokeStats.width)}/${Math.round(selectedStrokeStats.height)} px.`,
        `Page ${page} · textbox ${textbox.numInPage}`,
      );
    }

    if (selectedStrokeStats.straightness < 0.82) {
      return buildReport(
        'Strike Analysis',
        `Late reject: stroke is not straight enough.\nStraightness: ${selectedStrokeStats.straightness.toFixed(2)}.`,
        `Page ${page} · textbox ${textbox.numInPage}`,
      );
    }

    if (Math.abs(selectedStrokeStats.angleDeg) > 32) {
      return buildReport(
        'Strike Analysis',
        `Late reject: stroke angle is too steep.\nAngle: ${selectedStrokeStats.angleDeg.toFixed(1)} degrees.`,
        `Page ${page} · textbox ${textbox.numInPage}`,
      );
    }

    const wordCandidates = buildWordCandidates(
      measurement,
      textbox.textBox.textRect,
      selectedStrokeStats,
    );
    const lineWordCandidates = wordCandidates.filter(candidate => {
      const wordHeight = Math.max(1, candidate.absoluteBottom - candidate.absoluteTop);
      const bandTop = candidate.absoluteTop + wordHeight * 0.2;
      const bandBottom = candidate.absoluteBottom - wordHeight * 0.2;
      return candidate.projectedY >= bandTop && candidate.projectedY <= bandBottom;
    });

    const lineIndexes = [...new Set(lineWordCandidates.map(candidate => candidate.lineIndex))];
    logStrikeAnalysis('wordCandidates', {
      lineIndexes,
      wordCandidates: wordCandidates.map(candidate => ({
        text: candidate.text,
        lineIndex: candidate.lineIndex,
        overlapRatio: candidate.overlapRatio,
        projectedY: Math.round(candidate.projectedY * 100) / 100,
        rect: roundRect({
          left: candidate.absoluteLeft,
          top: candidate.absoluteTop,
          right: candidate.absoluteRight,
          bottom: candidate.absoluteBottom,
        }),
        })),
    });
    logStrikeSummary(
      `stroke ${strokeRef.numInPage} on page ${page}: candidate lines=${lineIndexes.length > 0 ? lineIndexes.join(',') : 'none'}`,
    );

    if (lineIndexes.length !== 1) {
      return buildReport(
        'Strike Analysis',
        `Late reject: stroke does not pass cleanly through exactly one rendered line.\nCandidate lines: ${lineIndexes.length > 0 ? lineIndexes.join(', ') : '(none)'}.`,
        `Page ${page} · textbox ${textbox.numInPage}`,
      );
    }

    const deletionCandidates = lineWordCandidates.filter(
      candidate => candidate.overlapRatio >= 0.5 && isMeaningfulWord(candidate.text),
    );

    if (deletionCandidates.length === 0) {
      return buildReport(
        'Strike Analysis',
        'Late reject: no word is covered by more than 50% within the target line.\nWould delete: (none).',
        `Page ${page} · textbox ${textbox.numInPage}`,
      );
    }

    const uniqueByRange = new Map<string, WordCandidate>();
    deletionCandidates.forEach(candidate => {
      uniqueByRange.set(`${candidate.start}-${candidate.end}`, candidate);
    });
    const uniqueCandidates = [...uniqueByRange.values()].sort((left, right) => left.start - right.start);

    logStrikeAnalysis('wouldDelete', {
      page,
      textboxUuid: textbox.uuid,
      textboxNumInPage: textbox.numInPage,
      lineIndex: lineIndexes[0],
      words: uniqueCandidates.map(candidate => ({
        text: candidate.text,
        start: candidate.start,
        end: candidate.end,
        overlapRatio: candidate.overlapRatio,
      })),
    });
    logStrikeSummary(
      `stroke ${strokeRef.numInPage} on page ${page}: would delete ${uniqueCandidates
        .map(candidate => candidate.text)
        .join(', ')}`,
    );

    if (uniqueCandidates.length > 6) {
      return buildReport(
        'Strike Analysis',
        `Late reject: too many words would be deleted at once.\nCandidate count: ${uniqueCandidates.length}.`,
        `Page ${page} Â· textbox ${textbox.numInPage}`,
      );
    }

    const originalText = text;
    const nextText = applyWordDeletionsToText(originalText, uniqueCandidates);
    logStrikeAnalysis('mutationPlan', {
      page,
      strokeNumInPage: strokeRef.numInPage,
      textboxNumInPage: textbox.numInPage,
      originalTextPreview: originalText.slice(0, 160),
      nextTextPreview: nextText.slice(0, 160),
      originalLength: originalText.length,
      nextLength: nextText.length,
      deleteWholeTextbox: nextText.length === 0,
      words: uniqueCandidates.map(candidate => ({
        text: candidate.text,
        start: candidate.start,
        end: candidate.end,
      })),
    });
    logStrikeSummary(
      `stroke ${strokeRef.numInPage} on page ${page}: applying deletion to textbox ${textbox.numInPage}`,
    );

    if (nextText === originalText) {
      return buildReport(
        'Strike Analysis',
        'Late reject: computed deletion did not change the text after normalization.',
        `Page ${page} Â· textbox ${textbox.numInPage}`,
      );
    }

    await saveCurrentNoteForConsistency(
      `strike deletion on page ${page}, textbox ${textbox.numInPage}`,
    );
    logStrikeSummary(
      `stroke ${strokeRef.numInPage} on page ${page}: current note saved before mutation`,
    );

    try {
      const replacementElements = buildReplacementPageElements(
        pageElements,
        textbox.numInPage,
        nextText,
        strokeRef.numInPage,
      );
      logStrikeAnalysis('replaceMutationStart', {
        page,
        textboxNumInPage: textbox.numInPage,
        strokeNumInPage: strokeRef.numInPage,
        replacementCount: replacementElements.length,
        deleteWholeTextbox: nextText.length === 0,
      });
      await replacePageElements(notePath, page, replacementElements);
      setStrikeMutationCooldown(1500);
      logStrikeAnalysis('mutationApplied', {
        page,
        textboxNumInPage: textbox.numInPage,
        strokeNumInPage: strokeRef.numInPage,
        mode:
          nextText.length === 0
            ? 'replace-delete-textbox-and-stroke'
            : 'replace-text-and-stroke',
      });
      logStrikeSummary(
        nextText.length === 0
          ? `stroke ${strokeRef.numInPage} on page ${page}: replaced page elements and removed empty textbox ${textbox.numInPage} with strike stroke`
          : `stroke ${strokeRef.numInPage} on page ${page}: replaced page elements, deleted ${uniqueCandidates.length} word(s), and removed strike stroke`,
      );
      return buildReport(
        'Strike Analysis',
        nextText.length === 0
          ? `Deleted textbox ${textbox.numInPage} after removing all text, and removed the strike stroke.`
          : `Deleted ${uniqueCandidates.length} word(s) on line ${lineIndexes[0] + 1} and removed the strike stroke.\n${formatWordsForMessage(
              uniqueCandidates,
            )}`,
        `Page ${page} Ã‚Â· textbox ${textbox.numInPage}`,
      );
    } catch (replaceError) {
      logStrikeAnalysis('replaceMutationFailed', {
        page,
        textboxNumInPage: textbox.numInPage,
        strokeNumInPage: strokeRef.numInPage,
        error: String(replaceError),
      });
      logStrikeSummary(
        `stroke ${strokeRef.numInPage} on page ${page}: single-write replace failed, falling back to two-step mutation`,
      );
    }

    if (nextText.length === 0) {
      await deletePageElements(notePath, page, [textbox.numInPage, strokeRef.numInPage]);
      setStrikeMutationCooldown(1500);
      logStrikeAnalysis('mutationApplied', {
        page,
        textboxNumInPage: textbox.numInPage,
        strokeNumInPage: strokeRef.numInPage,
        mode: 'delete-textbox-and-stroke',
      });
      logStrikeSummary(
        `stroke ${strokeRef.numInPage} on page ${page}: deleted empty textbox ${textbox.numInPage} and strike stroke`,
      );
      return buildReport(
        'Strike Analysis',
        `Deleted textbox ${textbox.numInPage} after removing all text, and removed the strike stroke.`,
        `Page ${page} Â· textbox ${textbox.numInPage}`,
      );
    }

    await mutateTextboxText(notePath, page, textbox, nextText);
    logStrikeAnalysis('textboxMutationApplied', {
      page,
      textboxNumInPage: textbox.numInPage,
      strokeNumInPage: strokeRef.numInPage,
      nextTextPreview: nextText.slice(0, 160),
    });

    try {
      await deletePageElements(notePath, page, [strokeRef.numInPage]);
      setStrikeMutationCooldown(1500);
      logStrikeAnalysis('mutationApplied', {
        page,
        textboxNumInPage: textbox.numInPage,
        strokeNumInPage: strokeRef.numInPage,
        mode: 'modify-text-and-delete-stroke',
      });
      logStrikeSummary(
        `stroke ${strokeRef.numInPage} on page ${page}: deleted ${uniqueCandidates.length} word(s) and removed strike stroke`,
      );
    } catch (strokeDeleteError) {
      logStrikeAnalysis('strokeDeleteFailed', {
        page,
        textboxNumInPage: textbox.numInPage,
        strokeNumInPage: strokeRef.numInPage,
        error: String(strokeDeleteError),
      });
      logStrikeSummary(
        `stroke ${strokeRef.numInPage} on page ${page}: stroke removal failed, rolling back textbox`,
      );
      try {
        await mutateTextboxText(notePath, page, textbox, originalText);
        logStrikeAnalysis('textboxRollbackApplied', {
          page,
          textboxNumInPage: textbox.numInPage,
          restoredTextPreview: originalText.slice(0, 160),
        });
      } catch (rollbackError) {
        logStrikeAnalysis('textboxRollbackFailed', {
          page,
          textboxNumInPage: textbox.numInPage,
          error: String(rollbackError),
        });
        return buildReport(
          'Strike Analysis',
          `Deletion partially failed: stroke removal failed and textbox rollback also failed.\nStroke error: ${String(
            strokeDeleteError,
          )}\nRollback error: ${String(rollbackError)}`,
          `Page ${page} Â· textbox ${textbox.numInPage}`,
        );
      }

      return buildReport(
        'Strike Analysis',
        `Deletion aborted: strike stroke could not be removed, so textbox text was restored.\nStroke error: ${String(
          strokeDeleteError,
        )}`,
        `Page ${page} Â· textbox ${textbox.numInPage}`,
      );
    }

    return buildReport(
      'Strike Analysis',
      `Deleted ${uniqueCandidates.length} word(s) on line ${lineIndexes[0] + 1} and removed the strike stroke.\n${formatWordsForMessage(
        uniqueCandidates,
      )}`,
      `Page ${page} Â· textbox ${textbox.numInPage}`,
    );

    // eslint-disable-next-line no-unreachable
    return buildReport(
      'Strike Analysis',
      `Would delete ${uniqueCandidates.length} word(s) on line ${lineIndexes[0] + 1}.\n${formatWordsForMessage(uniqueCandidates)}`,
      `Page ${page} · textbox ${textbox.numInPage}`,
    );
  } finally {
    if (strokeElement) {
      await recycleElements([strokeElement]);
    }
    await recycleElements(pageElements);
  }
}

async function runStrikeAnalysisWithTimeout(rawEvent: unknown): Promise<StrikeAnalysisReport | null> {
  return await Promise.race([
    analyzePenUpEvent(rawEvent),
    new Promise<StrikeAnalysisReport>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Strike analysis timed out after ${STRIKE_ANALYSIS_TIMEOUT_MS}ms.`));
      }, STRIKE_ANALYSIS_TIMEOUT_MS);

      void Promise.resolve().then(() => {
        void timer;
      });
    }),
  ]);
}

function consumeQueuedStrikeAnalysis(): void {
  if (isStrikeAnalysisInFlight) {
    return;
  }

  const queuedEvent = queuedRawPenUpEvent;
  if (!queuedEvent) {
    return;
  }

  const queuedUuid = getSingleStrokeUuid(queuedEvent);
  if (queuedUuid && hasRecentlyHandledStrokeUuid(queuedUuid)) {
    queuedRawPenUpEvent = null;
    logStrikeAnalysis('queuedDuplicateDropped', {
      strokeUuid: queuedUuid,
    });
    return;
  }

  queuedRawPenUpEvent = null;
  isStrikeAnalysisInFlight = true;
  if (queuedUuid) {
    markStrokeUuidHandled(queuedUuid);
  }
  logStrikeAnalysis('processingQueuedEvent', {
    strokeUuid: queuedUuid,
  });

  void runStrikeAnalysisWithTimeout(queuedEvent)
    .then(report => {
      if (report) {
        logStrikeAnalysisReport(report);
      }
    })
    .catch(error => {
      logStrikeAnalysis('analysisError', {
        error: String(error),
      });
      logStrikeAnalysisReport(
        buildReport(
          'Strike Analysis',
          `Late reject: analysis stalled before completion.\n${String(error)}`,
          'Queued pen-up event',
        ),
      );
    })
    .finally(() => {
      isStrikeAnalysisInFlight = false;
      consumeQueuedStrikeAnalysis();
    });
}

export function initTextboxStrikeAnalysis(): void {
  if (isStrikeAnalysisInitialized) {
    return;
  }

  isStrikeAnalysisInitialized = true;
  PluginManager.registerEventListener(EventType.PEN_UP, 1, {
    onMsg(rawEvent: unknown) {
      const strokeUuid = getSingleStrokeUuid(rawEvent);
      if (Date.now() < strikeMutationCooldownUntil) {
        logStrikeAnalysis('cooldownSkip', {
          strokeUuid,
          cooldownRemainingMs: strikeMutationCooldownUntil - Date.now(),
        });
        logStrikeSummary('event skipped during post-mutation cooldown');
        return;
      }

      logStrikeAnalysis('listenerTriggered', {
        inFlight: isStrikeAnalysisInFlight,
        strokeUuid,
      });

      if (strokeUuid && hasRecentlyHandledStrokeUuid(strokeUuid)) {
        logStrikeAnalysis('duplicateEventIgnored', {
          strokeUuid,
        });
        return;
      }

      if (isStrikeAnalysisInFlight) {
        queuedRawPenUpEvent = rawEvent;
        logStrikeAnalysis('skipped', {
          reason: 'Previous strike analysis is still running.',
          queuedReplacement: true,
          strokeUuid,
        });
        return;
      }

      isStrikeAnalysisInFlight = true;
      if (strokeUuid) {
        markStrokeUuidHandled(strokeUuid);
      }

      void runStrikeAnalysisWithTimeout(rawEvent)
        .then(report => {
          if (report) {
            logStrikeAnalysisReport(report);
          }
        })
        .catch(error => {
          logStrikeAnalysis('analysisError', {
            error: String(error),
          });
          logStrikeAnalysisReport(
            buildReport(
              'Strike Analysis',
              `Late reject: analysis stalled before completion.\n${String(error)}`,
              'Direct pen-up event',
            ),
          );
        })
        .finally(() => {
          isStrikeAnalysisInFlight = false;
          consumeQueuedStrikeAnalysis();
        });
    },
  });

  logStrikeAnalysis('initialized', {
    uiDisabled: true,
    coordinateMode: 'element-max-primary',
    recentStrokeRetentionMs: RECENT_STROKE_RETENTION_MS,
  });
  logStrikeSummary('initialized');

  void PluginManager.getDeviceType()
    .then(deviceType => {
      logStrikeAnalysis('deviceInfo', {
        deviceType,
        deviceLabel: DEVICE_TYPE_LABELS[deviceType] ?? 'unknown',
      });
      logStrikeSummary(
        `device detected: ${DEVICE_TYPE_LABELS[deviceType] ?? `unknown(${deviceType})`}`,
      );
    })
    .catch(error => {
      logStrikeAnalysis('deviceInfoError', {
        error: String(error),
      });
      logStrikeSummary(`device detection failed: ${String(error)}`);
    });
}
