/**
 * The NOTE titles the plugin keeps over textboxes, so they show in the note's table of contents
 * (technical-design-linked-files.md §1.5, technical-design-outline-sections.md §4): every linked
 * file's divider gets exactly one title of ours, and so does every heading whose level (from its
 * `#`s) is one of the titled levels. Titles of ours carry the block tag `k: 't'` — with the file's
 * source id over a divider, with the level over a heading. What a page should get is planned here
 * from its elements; `actions/titleSync.ts` carries it out after an import, an Outline apply or on
 * Restore titles. Titles made by the user or another plugin are never touched; a textbox under such
 * a title gets none of ours.
 *
 * A title counts as covering a textbox when their rectangles overlap by at least half of the
 * smaller one: the host's `controlTrailNums` don't reliably name the page's element numbers (Kept
 * GTD found the same), and a textbox moved by the Outline leaves its old title behind, which then
 * no longer covers it and is replaced. A heading whose level changed gets a new title too (the
 * style follows the level). Pure.
 */
import {parseBlockTag} from './blockTag';
import {intersectionRect, rectHeight, rectWidth} from './geometry';
import {headingLevelOf} from './headingText';
import {ELEMENT_TYPE_TITLE, type PageElementData, type Rect} from './textboxModel';

/** A textbox that needs a title: a file's divider (its source id, level 0) or a heading. */
export type TitleWanted = {numInPage: number; rect: Rect; sourceId: string | null; level: number};

export type TitlePlan = {
  insert: TitleWanted[];
  /** Our titles that cover nothing they belong to any more (element numbers). */
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

/** Whether an element is one of our titles (over a file's divider or a heading). */
export function isOwnTitle(element: Pick<PageElementData, 'type' | 'userData'>): boolean {
  return element.type === ELEMENT_TYPE_TITLE && parseBlockTag(element.userData)?.k === 't';
}

/** `titleLevels`: the heading levels that get a title (none: file titles only). */
export function planTitles(elements: PageElementData[], titleLevels: number[] = []): TitlePlan {
  const titles = elements.flatMap(element => {
    if (element.type !== ELEMENT_TYPE_TITLE || !element.title) {
      return [];
    }
    const tag = parseBlockTag(element.userData);
    const own = tag?.k === 't';
    return [{numInPage: element.numInPage, rect: titleRect(element.title), own, sourceId: tag?.s ?? null, level: tag?.h ?? 0}];
  });
  const wanted = elements.flatMap((element): TitleWanted[] => {
    if (!element.textBox) {
      return [];
    }
    const rect = element.textBox.textRect;
    const tag = parseBlockTag(element.userData);
    if (tag?.k === 'f' && tag.s) {
      return [{numInPage: element.numInPage, rect, sourceId: tag.s, level: 0}];
    }
    const level = headingLevelOf(element.textBox.textContentFull ?? '');
    const foreign = titles.some(title => !title.own && covers(title.rect, rect));
    return level > 0 && titleLevels.includes(level) && !foreign
      ? [{numInPage: element.numInPage, rect, sourceId: null, level}]
      : [];
  });
  const kept = new Set<number>();
  const insert: TitleWanted[] = [];
  for (const want of wanted) {
    const title = titles.find(
      item =>
        item.own &&
        !kept.has(item.numInPage) &&
        item.sourceId === want.sourceId &&
        (want.sourceId !== null || item.level === want.level) &&
        covers(item.rect, want.rect),
    );
    if (title) {
      kept.add(title.numInPage);
    } else {
      insert.push(want);
    }
  }
  return {
    insert,
    remove: titles.filter(item => item.own && !kept.has(item.numInPage)).map(item => item.numInPage),
  };
}
