import {PluginFileAPI, type Element} from 'sn-plugin-lib';
import {buildRecognizeRect, isStraightLineGeometryElement, isSupportedEditMarkerElement} from '../domain/markerStrokes';
import {boundsOf, type MarkStroke, type Point} from '../domain/marks/markStroke';
import {lookBackPointsWanted, type TakenMarks} from '../domain/marks/pass1';
import {LOOK_BACK_WINDOW} from '../domain/penEditPairing';
import {isPenEditDecoration, parsePenEditUserData} from '../domain/penEditTags';
import {readAccessorRange} from './markerStrokeRead';
import type {SdkResponse} from './sdkResult';
import {recycleByUuid} from './sdkElements';

/**
 * The look-back reads of a tag (technical-design-pen-edits.md §3.5): the elements numbered just
 * before the snippet, one `getElement` each, until LOOK_BACK_WINDOW strokes that belong to no
 * tagged text were seen (at most LOOK_BACK_MAX_READS numbers). Only the element's own rect is
 * read (the host's recognize rect, or a straight line's points); points are read afterwards only
 * for the strokes pass 1 asks for (`lookBackPointsWanted`). Never throws; an unreadable number is
 * skipped. `isComplete` ends the reads early, once the window holds a whole mark.
 */

function windowStroke(element: Element): MarkStroke | null {
  if (isStraightLineGeometryElement(element)) {
    const points = (element.geometry?.points ?? []).filter(
      (point): point is Point => typeof point?.x === 'number' && typeof point?.y === 'number',
    );
    const rect = points.length >= 2 ? boundsOf(points) : null;
    return rect ? {id: element.uuid, numInPage: element.numInPage, rect, points: null, straightLine: true} : null;
  }
  const rect = buildRecognizeRect(element.recognizeResult);
  return rect ? {id: element.uuid, numInPage: element.numInPage, rect, points: null, straightLine: false} : null;
}

export async function readLookBackWindow(
  notePath: string,
  page: number,
  numbers: number[],
  isComplete?: (window: MarkStroke[]) => boolean,
): Promise<{
  window: MarkStroke[];
  elements: Map<string, Element>;
  read: number;
  ms: number;
}> {
  const start = Date.now();
  const window: MarkStroke[] = [];
  // The window's elements stay alive so the tag can be written onto the chosen mark; the caller
  // recycles them with `recycleWindow`.
  const elements = new Map<string, Element>();
  let read = 0;
  let counted = 0;
  for (const num of numbers) {
    if (counted >= LOOK_BACK_WINDOW) {
      break;
    }
    let element: Element | null = null;
    try {
      const response = (await PluginFileAPI.getElement(
        notePath,
        page,
        num,
      )) as SdkResponse<Element>;
      element = response?.success && response.result ? response.result : null;
      if (!element) {
        continue;
      }
      read += 1;
      // Our badges and numbers, and strokes tagged as another text's handwriting or mark: none of
      // them is the mark of the text being tagged, and they don't count towards the window.
      if (isPenEditDecoration(element) || parsePenEditUserData(element.userData) !== null) {
        continue;
      }
      if (!isSupportedEditMarkerElement(element)) {
        continue;
      }
      const stroke = windowStroke(element);
      if (stroke) {
        counted += 1;
        window.push(stroke);
        elements.set(element.uuid, element);
        element = null;
        if (isComplete?.(window)) {
          break;
        }
      }
    } catch (error) {
      console.warn(
        '[PenEditPageRead] element not read',
        JSON.stringify({page, num, error: String(error)}),
      );
    } finally {
      if (element) {
        recycleByUuid([element]);
      }
    }
  }
  return {window, elements, read, ms: Date.now() - start};
}

export function recycleWindow(elements: Map<string, Element>): void {
  recycleByUuid([...elements.values()]);
  elements.clear();
}

/**
 * The window with the points pass 1 needs (caret-sized strokes, the two newest that may be a
 * slash), read from the elements kept alive by `readLookBackWindow`. A stroke whose points can't
 * be read keeps none.
 */
export async function withLookBackPoints(
  window: MarkStroke[],
  elements: Map<string, Element>,
  taken: TakenMarks,
): Promise<MarkStroke[]> {
  const wanted = lookBackPointsWanted(window, taken);
  return Promise.all(
    window.map(async stroke => {
      const element = elements.get(stroke.id);
      if (!wanted.has(stroke.id) || !element?.stroke?.points) {
        return stroke;
      }
      try {
        const points = (await readAccessorRange<Point>(element.stroke.points)).filter(
          point => typeof point?.x === 'number' && typeof point?.y === 'number',
        );
        return {...stroke, points};
      } catch (error) {
        console.warn('[PenEditPageRead] mark points not read', String(error));
        return stroke;
      }
    }),
  );
}
