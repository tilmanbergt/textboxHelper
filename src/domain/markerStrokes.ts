import {rectCenter, rectHeight, rectOverlapHeight, rectWidth} from './geometry';
import {buildPageWordCandidates} from './hitTesting';
import type {
  EditMarkerCalibration,
  MarkerDeleteCandidate,
  MarkerStrokeAnalysis,
  StrokeStats,
  WordCandidate,
} from './markerTypes';
import type {NativeDetailedMeasurement} from './textboxLayout';
import {ELEMENT_TYPE_GEO, ELEMENT_TYPE_STROKE, MAIN_LAYER, type PageElementData, type Rect} from './textboxModel';

/**
 * Reading edit-marker strokes: which elements can be markers, stroke statistics and bounds, the
 * words a delete stroke covers, and the two vertical strokes that turn a delete into a replace.
 */

export const MAX_DELETE_WORDS_PER_MARKER = 100;

export const MIN_MARKER_WIDTH = 30;

export const MAX_MARKER_HEIGHT_RATIO = 0.55;

const FALLBACK_MARKER_HEIGHT = 4;

const REPLACE_MODIFIER_MIN_HEIGHT = 18;

const REPLACE_MODIFIER_PAIR_MAX_GAP = 56;

const REPLACE_MODIFIER_MAX_CENTER_DISTANCE = 48;

function isMainLayerStrokeElement(element: PageElementData): boolean {
  return element.type === ELEMENT_TYPE_STROKE && element.layerNum === MAIN_LAYER;
}

export function isStraightLineGeometryElement(element: PageElementData): boolean {
  return (
    element.type === ELEMENT_TYPE_GEO &&
    element.layerNum === MAIN_LAYER &&
    element.geometry?.type === 'straightLine' &&
    Array.isArray(element.geometry?.points) &&
    element.geometry.points.length >= 2
  );
}

export function isSupportedEditMarkerElement(element: PageElementData): boolean {
  return isMainLayerStrokeElement(element) || isStraightLineGeometryElement(element);
}

function getCandidateTextStart(candidate: MarkerDeleteCandidate): number {
  return candidate.words[0]?.start ?? Number.MAX_SAFE_INTEGER;
}

export function orderTextboxMarkerCandidates<Candidate extends MarkerDeleteCandidate>(
  candidates: Candidate[],
): Candidate[] {
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

export function isMeaningfulWord(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

function projectYOnStroke(stats: StrokeStats, x: number): number {
  void x;
  return stats.center.y;
}

export function buildWordCandidates(
  measurement: NativeDetailedMeasurement,
  textRect: Rect,
  stroke: StrokeStats,
  calibration: EditMarkerCalibration,
): WordCandidate[] {
  return buildPageWordCandidates(
    measurement,
    textRect,
    calibration,
    stroke.rect,
    absoluteCenterX => projectYOnStroke(stroke, absoluteCenterX),
  );
}

export function buildStrokeStats(points: Array<{x: number; y: number}>): StrokeStats | null {
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

export function inflateStrokeStatsBounds(
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

export function buildRecognizeRect(rawRecognizeResult: unknown): Rect | null {
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

export function buildStrokeStatsFromRect(rect: Rect): StrokeStats | null {
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

export function findBestReplaceModifierPair<Analysis extends MarkerStrokeAnalysis>(
  candidate: MarkerDeleteCandidate,
  strokeAnalyses: Analysis[],
): Analysis[] {
  const matchingModifiers = strokeAnalyses.filter(strokeAnalysis =>
    isPotentialReplaceModifier(candidate, strokeAnalysis),
  );

  if (matchingModifiers.length < 2) {
    return [];
  }

  let bestPair: Analysis[] = [];
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
