import type {Element} from 'sn-plugin-lib';
import {
  buildRecognizeRect,
  buildStrokeStats,
  buildStrokeStatsFromRect,
  inflateStrokeStatsBounds,
  isStraightLineGeometryElement,
} from '../domain/markerStrokes';
import {roundNumber, roundRect} from '../domain/markerText';
import type {StrokeStats} from '../domain/markerTypes';
import {logEditMarker} from '../utils/editMarkerLog';

/**
 * Reading a marker's stroke from the SDK: its sample points, recognition points or outline, and
 * the statistics recognition works with. Every source is logged for "Save Diagnostics".
 */

type RecognPointLike = {
  X?: unknown;
  Y?: unknown;
};

export async function readAccessorRange<T>(
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
  } catch (error) {
    logEditMarker('accessorReadFailed', {message: String(error)});
    return [];
  }
}

/**
 * Diagnostics only: the stroke's raw sample points (`Stroke.points`), logged next to the source
 * that recognition uses below. With sn-plugin-lib 0.2.x the raw points are page pixels
 * (`docs/dev/supernote-host-facts.md`), so the two can be compared directly.
 */
async function logRawStrokePoints(element: Element): Promise<void> {
  if (!element.stroke) {
    return;
  }
  const rawPoints = (await readAccessorRange<{x?: unknown; y?: unknown}>(element.stroke.points))
    .map(point =>
      typeof point?.x === 'number' && typeof point?.y === 'number'
        ? {x: point.x, y: point.y}
        : null,
    )
    .filter((point): point is {x: number; y: number} => !!point);
  const rawStats = buildStrokeStats(rawPoints);
  logEditMarker('markerRawStrokePoints', {
    markerUuid: element.uuid,
    markerNumInPage: element.numInPage,
    pointCount: rawPoints.length,
    stats: rawStats
      ? {
          rect: roundRect(rawStats.rect),
          width: roundNumber(rawStats.width),
          height: roundNumber(rawStats.height),
          straightness: roundNumber(rawStats.straightness),
          angleDeg: roundNumber(rawStats.angleDeg),
          firstPoint: {x: roundNumber(rawStats.firstPoint.x), y: roundNumber(rawStats.firstPoint.y)},
          lastPoint: {x: roundNumber(rawStats.lastPoint.x), y: roundNumber(rawStats.lastPoint.y)},
        }
      : null,
  });
}

export async function loadMarkerStrokeStats(element: Element): Promise<StrokeStats | null> {
  await logRawStrokePoints(element);
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
      rect: roundRect(recognPointStats.rect),
      straightness: roundNumber(recognPointStats.straightness),
      angleDeg: roundNumber(recognPointStats.angleDeg),
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
      rect: roundRect(contourStats.rect),
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
