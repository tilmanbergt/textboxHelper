import {PluginCommAPI, type Element} from 'sn-plugin-lib';
import type {PageSize, StoredStroke} from '../domain/penEditModel';
import {ELEMENT_TYPE_STROKE} from '../domain/textboxModel';

/**
 * Handwriting recognition from stored strokes (ported from Kept GTD's
 * supernote/strokeRecognition.ts). The strokes are rebuilt as new elements where they were drawn
 * and recognized with the page's real size: with sn-plugin-lib 0.2.x stroke points and the
 * recognition size are both page-size pixels.
 *
 * One recognition at a time: calls are chained, the host recognizer is never asked twice at once.
 */

export type RecognitionResult = {
  text: string;
  /** The host's error, e.g. '117: Recognition failed. Please try again!'; null when it worked. */
  error: string | null;
  ms: number;
};

type Response<T> = {success?: boolean; result?: T; error?: {code?: number; message?: string}} | null | undefined;

type Accessor<T> = {
  size(): Promise<number>;
  add(index: number, value: T): Promise<boolean>;
  setRange(index: number, endIndex: number, values: T[]): Promise<boolean>;
};

let chain: Promise<unknown> = Promise.resolve();

function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(job, job);
  // The caller gets the error from `run`; this tail only keeps the queue going.
  chain = run.catch(() => undefined);
  return run;
}

function errText(response: Response<unknown>, fallback: string): string {
  return response?.error ? `${response.error.code ?? ''}: ${response.error.message ?? ''}` : fallback;
}

/** Fills an empty accessor: one batch setRange first, else one add() per value. */
async function fillAccessor<T>(accessor: Accessor<T>, values: T[]): Promise<boolean> {
  if (values.length === 0) {
    return true;
  }
  try {
    const ok = await accessor.setRange(0, values.length - 1, values);
    if (ok && (await accessor.size()) === values.length) {
      return true;
    }
  } catch {
    // silent: fall through to add()
  }
  let size = 0;
  try {
    size = await accessor.size();
  } catch {
    // silent: an unreadable size counts as empty
    size = 0;
  }
  if (size > values.length) {
    return false;
  }
  for (let index = size; index < values.length; index += 1) {
    if (!(await accessor.add(index, values[index]))) {
      return false;
    }
  }
  return true;
}

function recycle(elements: Element[]): void {
  for (const element of elements) {
    try {
      PluginCommAPI.recycleElement(element.uuid);
    } catch {
      // silent: a failed recycle only keeps a cached element a little longer
    }
  }
}

async function buildStrokes(strokes: StoredStroke[], page: number): Promise<Element[]> {
  const built: Element[] = [];
  try {
    for (const stored of strokes) {
      const created = (await PluginCommAPI.createElement(ELEMENT_TYPE_STROKE)) as Response<Element>;
      if (!created?.success || !created.result) {
        throw new Error('createElement: ' + errText(created, 'failed'));
      }
      const element = created.result;
      built.push(element);
      element.pageNum = page;
      if (stored.layerNum !== null) {
        element.layerNum = stored.layerNum;
      }
      if (stored.thickness !== null) {
        element.thickness = stored.thickness;
      }
      if (!element.stroke?.points) {
        throw new Error('created stroke has no points accessor');
      }
      if (stored.penColor !== null) {
        element.stroke.penColor = stored.penColor;
      }
      if (stored.penType !== null) {
        element.stroke.penType = stored.penType;
      }
      const points: Array<{x: number; y: number}> = [];
      for (let index = 0; index + 1 < stored.points.length; index += 2) {
        points.push({x: stored.points[index], y: stored.points[index + 1]});
      }
      if (!(await fillAccessor(element.stroke.points as unknown as Accessor<{x: number; y: number}>, points))) {
        throw new Error('could not fill stroke points');
      }
      if (element.stroke.pressures && stored.pressures.length > 0) {
        await fillAccessor(element.stroke.pressures as unknown as Accessor<number>, stored.pressures);
      }
    }
  } catch (error) {
    recycle(built);
    throw error;
  }
  return built;
}

/**
 * Recognizes stored strokes. Never throws: a failure comes back as `error`. Without the page size
 * nothing is recognized (error 'no page size').
 */
export function recognizeStrokes(strokes: StoredStroke[], size: PageSize | null, page: number): Promise<RecognitionResult> {
  if (strokes.length === 0) {
    return Promise.resolve({text: '', error: null, ms: 0});
  }
  return serial(async () => {
    const start = Date.now();
    let built: Element[] = [];
    let text = '';
    let error: string | null = null;
    let buildMs = 0;
    try {
      if (!size) {
        throw new Error('no page size');
      }
      built = await buildStrokes(strokes, page);
      buildMs = Date.now() - start;
      const response = (await PluginCommAPI.recognizeElements(built, size)) as Response<string>;
      if (response?.success) {
        text = (response.result ?? '').trim();
      } else {
        error = errText(response, 'recognition failed');
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      recycle(built);
    }
    const ms = Date.now() - start;
    if (error) {
      console.warn('[StrokeRecognition] failed', JSON.stringify({strokes: strokes.length, ms, error}));
    } else {
      console.log('[StrokeRecognition] done', JSON.stringify({strokes: strokes.length, chars: text.length, ms, buildMs}));
    }
    return {text, error, ms};
  });
}

/** Stops a running recognition (when the review closes). Never throws. */
export async function cancelRecognition(): Promise<void> {
  try {
    await PluginCommAPI.cancelRecognize();
  } catch (error) {
    console.warn('[StrokeRecognition] cancel failed', String(error));
  }
}
