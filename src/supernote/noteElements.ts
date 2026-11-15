import {
  Element,
  PluginCommAPI,
  PluginFileAPI,
  PluginNoteAPI,
  TextBox,
} from 'sn-plugin-lib';
import type {PreparedTextInsert} from '../domain/textboxEditPlan';
import {assertApiSuccess} from './sdkResult';

/**
 * Reading and changing the current page through the SDK: note path, page, page size, page and
 * lasso elements, inserting, changing and deleting textboxes, and hiding the lasso box.
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

/** Hides the lasso box after a change; a failure is only logged. */
export async function hideLassoBox(): Promise<void> {
  const hideResponse = await PluginCommAPI.setLassoBoxState(2);
  if (!hideResponse?.success) {
    console.log(
      '[TextboxActions] setLassoBoxState failed',
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
