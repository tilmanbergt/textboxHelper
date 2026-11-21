/**
 * The NOTE titles over linked files' dividers (technical-design-linked-files.md §1.5): every
 * divider textbox gets exactly one title of ours (block tag `k: 't'`, same file) covering it, so
 * the file shows in the note's table of contents. What a page should get is planned here from its
 * elements; `actions/fileTitles.ts` carries it out after an import, an Outline apply or on Restore
 * titles. Titles made by the user or another plugin are never touched. Pure.
 *
 * A title counts as covering a divider when their rectangles overlap by at least half of the
 * smaller one: the host's `controlTrailNums` don't reliably name the page's element numbers (Kept
 * GTD found the same), and a divider moved by the Outline leaves its old title behind, which then
 * no longer covers it and is replaced.
 */
import {parseBlockTag} from './blockTag';
import {intersectionRect, rectHeight, rectWidth} from './geometry';
import {ELEMENT_TYPE_TITLE, type PageElementData, type Rect} from './textboxModel';

export type TitlePlan = {
  /** Dividers that need a title: its file, the divider's number and rectangle. */
  insert: {sourceId: string; numInPage: number; rect: Rect}[];
  /** Our titles that cover no divider of their file any more (element numbers). */
  remove: number[];
};

function area(rect: Rect): number {
  return Math.max(0, rectWidth(rect)) * Math.max(0, rectHeight(rect));
}

export function titleRect(title: {X: number; Y: number; width: number; height: number}): Rect {
  return {left: title.X, top: title.Y, right: title.X + title.width, bottom: title.Y + title.height};
}

export function covers(titleArea: Rect, textRect: Rect): boolean {
  const overlap = intersectionRect(titleArea, textRect);
  const smaller = Math.min(area(titleArea), area(textRect));
  return !!overlap && smaller > 0 && area(overlap) >= 0.5 * smaller;
}

/** Whether an element is one of our file titles. */
export function isFileTitle(element: Pick<PageElementData, 'type' | 'userData'>): boolean {
  return element.type === ELEMENT_TYPE_TITLE && parseBlockTag(element.userData)?.k === 't';
}

export function planFileTitles(elements: PageElementData[]): TitlePlan {
  const dividers = elements.flatMap(element => {
    const tag = parseBlockTag(element.userData);
    return element.textBox && tag?.k === 'f' && tag.s
      ? [{sourceId: tag.s, numInPage: element.numInPage, rect: element.textBox.textRect}]
      : [];
  });
  const titles = elements.flatMap(element => {
    const tag = parseBlockTag(element.userData);
    return isFileTitle(element) && tag?.s && element.title
      ? [{sourceId: tag.s, numInPage: element.numInPage, rect: titleRect(element.title)}]
      : [];
  });
  const kept = new Set<number>();
  const insert: TitlePlan['insert'] = [];
  for (const divider of dividers) {
    const title = titles.find(
      item => !kept.has(item.numInPage) && item.sourceId === divider.sourceId && covers(item.rect, divider.rect),
    );
    if (title) {
      kept.add(title.numInPage);
    } else {
      insert.push(divider);
    }
  }
  return {insert, remove: titles.filter(item => !kept.has(item.numInPage)).map(item => item.numInPage)};
}
