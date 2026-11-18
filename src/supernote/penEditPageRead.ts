import {PluginCommAPI, PluginFileAPI, type Element} from 'sn-plugin-lib';
import {buildRecognizeRect, buildStrokeStats, isStraightLineGeometryElement, isSupportedEditMarkerElement} from '../domain/markerStrokes';
import {LOOK_BACK_WINDOW, strokeStatsFromRect, type WindowStroke} from '../domain/penEditPairing';
import {isPenEditElement} from '../domain/penEditTags';

/**
 * The look-back reads of a replacement tag (technical-design-pen-edits.md §3.5): the elements
 * numbered just before the snippet, one `getElement` each, until LOOK_BACK_WINDOW elements that
 * aren't Textbox Tools' own were seen. Only the element's own rect is used (the host's recognize
 * rect, or a straight line's points): no stroke points are read. Never throws; an unreadable
 * number is skipped.
 */

type Response<T> = {success?: boolean; result?: T} | null | undefined;

function windowStroke(element: Element): WindowStroke | null {
  if (isStraightLineGeometryElement(element)) {
    const stats = buildStrokeStats(element.geometry?.points ?? []);
    return stats ? {uuid: element.uuid, numInPage: element.numInPage, isStraightLine: true, stats} : null;
  }
  const rect = buildRecognizeRect(element.recognizeResult);
  const stats = rect ? strokeStatsFromRect(rect) : null;
  return stats ? {uuid: element.uuid, numInPage: element.numInPage, isStraightLine: false, stats} : null;
}

export async function readLookBackWindow(
  notePath: string,
  page: number,
  numbers: number[],
): Promise<{window: WindowStroke[]; read: number; ms: number}> {
  const start = Date.now();
  const window: WindowStroke[] = [];
  let read = 0;
  let counted = 0;
  for (const num of numbers) {
    if (counted >= LOOK_BACK_WINDOW) {
      break;
    }
    let element: Element | null = null;
    try {
      const response = (await PluginFileAPI.getElement(notePath, page, num)) as Response<Element>;
      element = response?.success && response.result ? response.result : null;
      if (!element) {
        continue;
      }
      read += 1;
      if (isPenEditElement(element)) {
        continue;
      }
      counted += 1;
      if (!isSupportedEditMarkerElement(element)) {
        continue;
      }
      const stroke = windowStroke(element);
      if (stroke) {
        window.push(stroke);
      }
    } catch (error) {
      console.warn('[PenEditPageRead] element not read', JSON.stringify({page, num, error: String(error)}));
    } finally {
      if (element) {
        try {
          PluginCommAPI.recycleElement(element.uuid);
        } catch {
          // silent: a failed recycle only keeps a cached element a little longer
        }
      }
    }
  }
  return {window, read, ms: Date.now() - start};
}
