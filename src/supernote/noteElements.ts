import {
  Element,
  PluginCommAPI,
  PluginFileAPI,
  PluginNoteAPI,
  TextBox,
} from 'sn-plugin-lib';
import type {Size} from '../domain/importPlan';
import type {PreparedTextInsert} from '../domain/textboxEditPlan';
import {assertApiSuccess, assertBooleanSuccess} from './sdkResult';

/**
 * Reading and changing the current page through the SDK: note path, page, page size, page and
 * lasso elements, inserting, changing and deleting textboxes and other elements, saving the note,
 * and hiding the lasso box.
 */

export async function getCurrentPageElementsContext(): Promise<{
  notePath: string;
  page: number;
  pageElements: Element[];
}> {
  const fileResponse = await PluginCommAPI.getCurrentFilePath();
  const pageResponse = await PluginCommAPI.getCurrentPageNum();

  const notePath = assertApiSuccess(
    fileResponse as {success?: boolean; result?: string; error?: {message?: string}},
    'Could not determine the current note path.',
  );
  const page = assertApiSuccess(
    pageResponse as {success?: boolean; result?: number; error?: {message?: string}},
    'Could not determine the current page.',
  );

  const pageElementsResponse = await PluginFileAPI.getElements(page, notePath);
  const pageElements = assertApiSuccess(
    pageElementsResponse as {success?: boolean; result?: Element[]; error?: {message?: string}},
    'Could not read page elements.',
  );

  return {
    notePath,
    page,
    pageElements,
  };
}

export async function modifySelectedTextbox(textBox: TextBox): Promise<void> {
  const response = await PluginNoteAPI.modifyLassoText(textBox);
  assertApiSuccess(
    response as {success?: boolean; error?: {message?: string}},
    'modifyLassoText failed',
  );
}

export async function getPageContext(): Promise<{
  notePath: string;
  page: number;
  pageWidth: number;
  pageHeight: number;
  lassoElements: Element[];
  pageElements: Element[];
}> {
  const fileResponse = await PluginCommAPI.getCurrentFilePath();
  const pageResponse = await PluginCommAPI.getCurrentPageNum();

  const notePath = assertApiSuccess(
    fileResponse as {success?: boolean; result?: string; error?: {message?: string}},
    'Could not determine the current note path.',
  );
  const page = assertApiSuccess(
    pageResponse as {success?: boolean; result?: number; error?: {message?: string}},
    'Could not determine the current page.',
  );

  const pageSizeResponse = await PluginFileAPI.getPageSize(notePath, page);
  const pageSize = assertApiSuccess(
    pageSizeResponse as {
      success?: boolean;
      result?: {width: number; height: number};
      error?: {message?: string};
    },
    'Could not determine the current page size.',
  );

  const lassoResponse = await PluginCommAPI.getLassoElements();
  const lassoElements = assertApiSuccess(
    lassoResponse as {success?: boolean; result?: Element[]; error?: {message?: string}},
    'Could not read the current lasso selection.',
  );

  const pageElementsResponse = await PluginFileAPI.getElements(page, notePath);
  const pageElements = assertApiSuccess(
    pageElementsResponse as {success?: boolean; result?: Element[]; error?: {message?: string}},
    'Could not read page elements for layout validation.',
  );

  return {
    notePath,
    page,
    pageWidth: pageSize.width,
    pageHeight: pageSize.height,
    lassoElements,
    pageElements,
  };
}

export async function recycleElements(elements: Element[]): Promise<void> {
  await Promise.all(
    elements.map(element =>
      typeof element.recycle === 'function'
        ? element.recycle().catch(() => undefined)
        : Promise.resolve(undefined),
    ),
  );
}

export async function insertTextboxElement(insert: PreparedTextInsert): Promise<void> {
  const response = await PluginNoteAPI.insertText(insert);
  assertApiSuccess(response as {success?: boolean; error?: {message?: string}}, 'insertText failed');
}

export async function deleteLassoElements(): Promise<void> {
  const deleteResponse = await PluginCommAPI.deleteLassoElements();
  assertApiSuccess(
    deleteResponse as {success?: boolean; error?: {message?: string}},
    'Could not delete the selected textboxes.',
  );
}

/** Hides the lasso box after a change; a failure is only logged, under the caller's tag. */
export async function hideLassoBox(logTag = '[TextboxActions]'): Promise<void> {
  const hideResponse = await PluginCommAPI.setLassoBoxState(2);
  if (!hideResponse?.success) {
    console.log(
      `${logTag} setLassoBoxState failed`,
      JSON.stringify(hideResponse),
    );
  }
}

export async function getLassoElements(): Promise<Element[]> {
  const lassoResponse = await PluginCommAPI.getLassoElements();
  return assertApiSuccess(
    lassoResponse as {success?: boolean; result?: Element[]; error?: {message?: string}},
    'Could not read the current lasso selection.',
  );
}

/** A page of the open note as read for the Manuscript card. */
export type PageContext = {
  notePath: string;
  page: number;
  pageElements: Element[];
};

export async function readPageContext(notePath: string, page: number): Promise<PageContext> {
  const pageElements = await readPageElements(notePath, page, `Could not read page ${page + 1}.`);
  return {notePath, page, pageElements};
}

/** The open note: its path, the page shown, and how many pages it has. */
export type NoteInfo = {notePath: string; currentPage: number; pageCount: number};

/** Shows `page` (0-based) of the open note in NOTE, under the plugin view. */
export async function jumpToNotePage(page: number): Promise<void> {
  assertBooleanSuccess(
    (await PluginCommAPI.jumpToPage(page)) as {success?: boolean; result?: boolean; error?: {message?: string}},
    `Could not go to page ${page + 1}.`,
  );
}

/** How many pages a note has. */
export async function readNotePageCount(notePath: string): Promise<number> {
  return assertApiSuccess(
    (await PluginFileAPI.getNoteTotalPageNum(notePath)) as {success?: boolean; result?: number; error?: {message?: string}},
    'Could not determine the note page count.',
  );
}

export async function readNoteInfo(): Promise<NoteInfo> {
  const notePath = assertApiSuccess(
    (await PluginCommAPI.getCurrentFilePath()) as {success?: boolean; result?: string; error?: {message?: string}},
    'Could not determine the current note path.',
  );
  const currentPage = assertApiSuccess(
    (await PluginCommAPI.getCurrentPageNum()) as {success?: boolean; result?: number; error?: {message?: string}},
    'Could not determine the current page.',
  );
  const pageCount = await readNotePageCount(notePath);
  return {notePath, currentPage, pageCount};
}

export async function saveCurrentNoteForConsistency(reason: string): Promise<void> {
  const response = await PluginNoteAPI.saveCurrentNote();
  assertApiSuccess(
    response as {success?: boolean; error?: {message?: string}},
    `Could not save the current note before ${reason}.`,
  );
}

export async function modifyPageElements(
  notePath: string,
  page: number,
  elements: Element[],
): Promise<void> {
  if (elements.length === 0) {
    return;
  }

  const response = await PluginFileAPI.modifyElements(
    notePath,
    page,
    elements as unknown as Object[],
  );
  assertApiSuccess(
    response as {success?: boolean; error?: {message?: string}},
    `Could not modify page ${page} elements.`,
  );
}

export async function deletePageElements(
  notePath: string,
  page: number,
  numsInPage: number[],
): Promise<void> {
  const uniqueNums = [...new Set(numsInPage)].filter(num => Number.isInteger(num) && num >= 0);
  if (uniqueNums.length === 0) {
    return;
  }

  const response = await PluginFileAPI.deleteElements(notePath, page, uniqueNums);
  assertApiSuccess(
    response as {success?: boolean; error?: {message?: string}},
    `Could not delete page ${page} elements ${uniqueNums.join(', ')}.`,
  );
}

export async function readPageSizeForDiagnostics(
  notePath: string,
  page: number,
): Promise<{width: number; height: number} | string> {
  try {
    const response = (await PluginFileAPI.getPageSize(notePath, page)) as {
      success?: boolean;
      result?: {width: number; height: number};
      error?: {message?: string};
    };
    return response?.success && response.result
      ? response.result
      : `unavailable: ${response?.error?.message || 'no result'}`;
  } catch (error) {
    return `unavailable: ${String(error)}`;
  }
}

export async function readPageElements(
  notePath: string,
  page: number,
  failureMessage: string,
): Promise<Element[]> {
  const pageElementsResponse = await PluginFileAPI.getElements(page, notePath);
  return assertApiSuccess(
    pageElementsResponse as {success?: boolean; result?: Element[]; error?: {message?: string}},
    failureMessage,
  );
}

type ApiResponse<T> = {
  success?: boolean;
  result?: T;
  error?: {message?: string};
};

export type CurrentNoteContext = {
  notePath: string;
  currentPage: number;
  pageSize: Size;
  pageElements: Element[];
};

export async function getCurrentNoteContext(): Promise<CurrentNoteContext> {
  const notePath = assertApiSuccess<string>(
    (await PluginCommAPI.getCurrentFilePath()) as ApiResponse<string>,
    'Could not determine the current note path.',
  );

  const currentPage = assertApiSuccess<number>(
    (await PluginCommAPI.getCurrentPageNum()) as ApiResponse<number>,
    'Could not determine the current page.',
  );

  const pageSize = assertApiSuccess<Size>(
    (await PluginFileAPI.getPageSize(notePath, currentPage)) as ApiResponse<Size>,
    'Could not read the current page size.',
  );

  const pageElements = assertApiSuccess<Element[]>(
    (await PluginFileAPI.getElements(currentPage, notePath)) as ApiResponse<Element[]>,
    'Could not read current page elements.',
  );

  return {
    notePath,
    currentPage,
    pageSize,
    pageElements,
  };
}
