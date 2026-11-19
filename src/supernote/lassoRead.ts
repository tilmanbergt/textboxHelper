import {PluginCommAPI, PluginFileAPI, type Element} from 'sn-plugin-lib';
import type {PageSize, StoredStroke} from '../domain/penEditModel';
import {buildRecognizeRect} from '../domain/markerStrokes';
import {ELEMENT_TYPE_STROKE, MAIN_LAYER, type Rect} from '../domain/textboxModel';
import {readAccessorRange} from './markerStrokeRead';

/**
 * One read of the current lasso for a pen-edit tag (ported from Kept GTD's
 * supernote/lassoRead.ts): path, page, the picture, rect, the handwritten strokes with their
 * points, and the page size. The picture comes first: on a cold plugin start the host can drop
 * the lasso while the slower reads run (error 904). Never throws; whatever couldn't be read is
 * empty and named in `errors`.
 */

export type LassoSnapshot = {
  path: string | null;
  page: number | null;
  rect: Rect | null;
  pageSize: PageSize | null;
  /** Path of the picture written, or null. */
  picture: string | null;
  strokes: StoredStroke[];
  /** Each stroke's recognize rect (or its points' bounds), in the order of `strokes`. */
  strokeRects: Rect[];
  strokeNums: number[];
  /**
   * The stroke elements themselves, kept only with `keepStrokeElements` (to write the tag onto
   * them); the caller recycles them.
   */
  strokeElements: Element[];
  elementCount: number;
  errors: string[];
  timingsMs: Record<string, number>;
};

type Response<T> = {success?: boolean; result?: T; error?: {code?: number; message?: string}} | null | undefined;

function errText(response: Response<unknown>, fallback: string): string {
  return response?.error ? `${response.error.code ?? ''}: ${response.error.message ?? ''}` : fallback;
}

async function timed<T>(timings: Record<string, number>, name: string, call: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    return await call();
  } finally {
    timings[name] = Date.now() - start;
  }
}

async function readStroke(element: Element): Promise<StoredStroke | null> {
  if (!element.stroke?.points) {
    return null;
  }
  const points = await readAccessorRange<{x: number; y: number}>(element.stroke.points);
  const pressures = await readAccessorRange<number>(element.stroke.pressures);
  const flat: number[] = [];
  for (const point of points) {
    if (typeof point?.x === 'number' && typeof point?.y === 'number') {
      flat.push(Math.round(point.x), Math.round(point.y));
    }
  }
  return {
    thickness: element.thickness ?? null,
    penColor: element.stroke.penColor ?? null,
    penType: element.stroke.penType ?? null,
    layerNum: element.layerNum ?? null,
    points: flat,
    pressures: pressures.filter(v => typeof v === 'number').map(v => Math.round(v * 1000) / 1000),
  };
}

/** Writes a picture of the active lasso to `target` (PNG). Must run while the lasso is there. */
export async function saveLassoPicture(target: string): Promise<string | null> {
  try {
    const response = (await PluginCommAPI.generateLassoPreview(target)) as Response<{imagePath?: string}>;
    if (!response?.success) {
      console.warn('[LassoRead] picture failed', errText(response, 'failed'));
      return null;
    }
    return response.result?.imagePath || target;
  } catch (error) {
    console.warn('[LassoRead] picture threw', String(error));
    return null;
  }
}

function pointBounds(flat: number[]): Rect | null {
  if (flat.length < 2) {
    return null;
  }
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let index = 0; index + 1 < flat.length; index += 2) {
    left = Math.min(left, flat[index]);
    right = Math.max(right, flat[index]);
    top = Math.min(top, flat[index + 1]);
    bottom = Math.max(bottom, flat[index + 1]);
  }
  return {left, top, right, bottom};
}

export async function readLasso(
  options: {picturePath?: string; keepStrokeElements?: boolean} = {},
): Promise<LassoSnapshot> {
  const timings: Record<string, number> = {};
  const errors: string[] = [];
  const snap: LassoSnapshot = {
    path: null,
    page: null,
    rect: null,
    pageSize: null,
    picture: null,
    strokes: [],
    strokeRects: [],
    strokeNums: [],
    strokeElements: [],
    elementCount: 0,
    errors,
    timingsMs: timings,
  };
  let elements: Element[] = [];
  try {
    const pathResponse = (await timed(timings, 'path', () => PluginCommAPI.getCurrentFilePath())) as Response<string>;
    snap.path = pathResponse?.success && pathResponse.result ? pathResponse.result : null;
    if (!snap.path) {
      errors.push('getCurrentFilePath: ' + errText(pathResponse, 'no path'));
    }

    const pageResponse = (await timed(timings, 'page', () => PluginCommAPI.getCurrentPageNum())) as Response<number>;
    snap.page = pageResponse?.success && typeof pageResponse.result === 'number' ? pageResponse.result : null;
    if (snap.page === null) {
      errors.push('getCurrentPageNum: ' + errText(pageResponse, 'no page'));
    }

    if (options.picturePath) {
      const picturePath = options.picturePath;
      snap.picture = await timed(timings, 'picture', () => saveLassoPicture(picturePath));
    }

    const rectResponse = (await timed(timings, 'rect', () => PluginCommAPI.getLassoRect())) as unknown as Response<Rect>;
    snap.rect = rectResponse?.success && rectResponse.result ? rectResponse.result : null;
    if (!snap.rect) {
      errors.push('getLassoRect: ' + errText(rectResponse, 'no rect'));
    }

    const elementsResponse = (await timed(timings, 'elements', () => PluginCommAPI.getLassoElements())) as Response<Element[]>;
    elements = elementsResponse?.success && Array.isArray(elementsResponse.result) ? elementsResponse.result : [];
    if (!elementsResponse?.success) {
      errors.push('getLassoElements: ' + errText(elementsResponse, 'failed'));
    }
    snap.elementCount = elements.length;

    if (snap.path && snap.page !== null) {
      const path = snap.path;
      const page = snap.page;
      try {
        const sizeResponse = (await timed(timings, 'pageSize', () => PluginFileAPI.getPageSize(path, page))) as Response<PageSize>;
        snap.pageSize = sizeResponse?.success && sizeResponse.result ? sizeResponse.result : null;
      } catch (error) {
        errors.push('getPageSize: ' + String(error));
      }
    }

    const strokesStart = Date.now();
    for (const element of elements) {
      if (element.type !== ELEMENT_TYPE_STROKE || element.layerNum !== MAIN_LAYER) {
        continue;
      }
      try {
        const stroke = await readStroke(element);
        if (stroke && stroke.points.length > 0) {
          snap.strokes.push(stroke);
          snap.strokeRects.push(buildRecognizeRect(element.recognizeResult) ?? pointBounds(stroke.points) ?? {left: 0, top: 0, right: 0, bottom: 0});
          snap.strokeNums.push(element.numInPage);
          if (options.keepStrokeElements) {
            snap.strokeElements.push(element);
          }
        }
      } catch (error) {
        errors.push('stroke: ' + String(error));
      }
    }
    timings.strokes = Date.now() - strokesStart;
  } catch (error) {
    errors.push(String(error));
  } finally {
    const kept = new Set(snap.strokeElements);
    for (const element of elements) {
      if (kept.has(element)) {
        continue;
      }
      try {
        PluginCommAPI.recycleElement(element.uuid);
      } catch {
        // silent: a failed recycle only keeps a cached element a little longer
      }
    }
  }
  console.log(
    '[LassoRead] done',
    JSON.stringify({
      elements: snap.elementCount,
      strokes: snap.strokes.length,
      page: snap.page,
      pageSize: snap.pageSize,
      picture: !!snap.picture,
      timings,
      errors,
    }),
  );
  return snap;
}
