import {PluginCommAPI, PluginFileAPI, type Element} from 'sn-plugin-lib';
import {isStraightLineGeometryElement, isSupportedEditMarkerElement} from '../domain/markerStrokes';
import type {WindowStroke} from '../domain/penEditPairing';
import {isPenEditElement} from '../domain/penEditTags';
import {loadMarkerStrokeStats} from './markerStrokeRead';

/**
 * The look-back reads of a replacement tag (technical-design-pen-edits.md §3.5): only the few
 * elements numbered just before the snippet, one `getElement` each, reduced to what the pairing
 * needs. Never throws; an unreadable number is skipped.
 */

type Response<T> = {success?: boolean; result?: T} | null | undefined;

export async function readLookBackWindow(
  notePath: string,
  page: number,
  numbers: number[],
): Promise<{window: WindowStroke[]; read: number; ms: number}> {
  const start = Date.now();
  const window: WindowStroke[] = [];
  let read = 0;
  for (const num of numbers) {
    let element: Element | null = null;
    try {
      const response = (await PluginFileAPI.getElement(notePath, page, num)) as Response<Element>;
      element = response?.success && response.result ? response.result : null;
      if (!element) {
        continue;
      }
      read += 1;
      if (isPenEditElement(element) || !isSupportedEditMarkerElement(element)) {
        continue;
      }
      const stats = await loadMarkerStrokeStats(element);
      if (stats) {
        window.push({
          uuid: element.uuid,
          numInPage: element.numInPage,
          isStraightLine: isStraightLineGeometryElement(element),
          stats,
        });
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
