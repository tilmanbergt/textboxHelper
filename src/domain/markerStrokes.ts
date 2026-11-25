import {rectHeight, rectWidth} from './geometry';
import type {StrokeStats} from './markerTypes';
import {ELEMENT_TYPE_GEO, ELEMENT_TYPE_STROKE, MAIN_LAYER, type PageElementData, type Rect} from './textboxModel';

/**
 * Reading edit-marker strokes: which page elements can be marks, and their stroke statistics and
 * bounds. What the strokes are is pass 1's (`marks/`).
 */

const FALLBACK_MARKER_HEIGHT = 4;

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
