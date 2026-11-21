import {PluginCommAPI, PluginFileAPI, type Element} from 'sn-plugin-lib';
import type {Rect} from '../domain/textboxModel';
import {ELEMENT_TYPE_TITLE} from '../domain/textboxModel';
import {assertApiSuccess, assertBooleanSuccess, type SdkResponse} from './sdkResult';
import {recycleByUuid} from './sdkElements';

/**
 * NOTE title elements (headings) written by the plugin (technical-design-linked-files.md §1.5),
 * the way Kept GTD writes them and Ratta describes it: an element of type 100 whose `title`
 * carries the covered textbox's rectangle, its number in `controlTrailNums` and the style, inserted
 * on the page through the file API. The style and the covered element live on `element.title`,
 * not on the element itself (host facts §3).
 */

export type TitleInsert = {
  /** `numInPage` of the textbox the title covers. */
  textBoxNum: number;
  rect: Rect;
  /** 1 black, 2 light grey, 3 dark grey, 4 shadow (0 would remove the title). */
  style: number;
  userData: string;
};

async function buildTitleElement(page: number, insert: TitleInsert): Promise<Element> {
  const created = (await PluginCommAPI.createElement(ELEMENT_TYPE_TITLE)) as SdkResponse<Element>;
  const element = assertApiSuccess(created, 'Could not create a title element.');
  element.pageNum = page;
  element.layerNum = 0;
  element.userData = insert.userData;
  element.title = {
    X: insert.rect.left,
    Y: insert.rect.top,
    width: insert.rect.right - insert.rect.left,
    height: insert.rect.bottom - insert.rect.top,
    page,
    style: insert.style,
    controlTrailNums: [insert.textBoxNum],
  };
  return element;
}

/** Inserts titles on one page of the note file in one call. */
export async function insertTitles(notePath: string, page: number, inserts: TitleInsert[]): Promise<void> {
  if (inserts.length === 0) {
    return;
  }
  const elements: Element[] = [];
  try {
    for (const insert of inserts) {
      elements.push(await buildTitleElement(page, insert));
    }
    const result = await PluginFileAPI.insertElements(notePath, page, elements);
    console.log('[NoteTitles] insertElements', JSON.stringify({page, count: elements.length, result}));
    assertBooleanSuccess(result as SdkResponse<boolean>, `Could not add the file titles on page ${page + 1}.`);
  } finally {
    recycleByUuid(elements);
  }
}
