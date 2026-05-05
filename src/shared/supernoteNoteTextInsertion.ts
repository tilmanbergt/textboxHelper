import {
  Element,
  PluginCommAPI,
  PluginFileAPI,
  PluginNoteAPI,
  TextBox,
  type Rect,
} from 'sn-plugin-lib';

export type InsertTextboxPage = {
  pageNumber: number;
  text: string;
  rect: Rect;
  fontSize: number;
  fontPath?: string;
  createPage?: boolean;
};

export type InsertTextboxPagesProgressUpdate = {
  message: string;
};

export type InsertTextboxPagesResult = {
  createdPageCount: number;
  insertedTextboxCount: number;
};

const TEXT_TYPE_NORMAL = 500;
const MAIN_LAYER = 0;
const DEFAULT_TEMPLATE_NAME = 'style_white';
const INSERT_PAGE_TIMEOUT_MS = 8000;

function assertApiSuccess<T>(
  response: {success?: boolean; result?: T; error?: {message?: string}} | null | undefined,
  fallback: string,
): T {
  if (response?.success) {
    return response.result as T;
  }

  throw new Error(response?.error?.message || fallback);
}

function assertBooleanSuccess(
  response: {success?: boolean; result?: boolean; error?: {message?: string}} | null | undefined,
  fallback: string,
): void {
  if (!response?.success || response.result !== true) {
    throw new Error(response?.error?.message || fallback);
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);

    promise
      .then(result => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function recycleElements(elements: Element[]): Promise<void> {
  await Promise.all(
    elements.map(element =>
      typeof element.recycle === 'function'
        ? element.recycle().catch(() => undefined)
        : Promise.resolve(undefined),
    ),
  );
}

async function saveCurrentNote(message: string): Promise<void> {
  const result = await PluginNoteAPI.saveCurrentNote();

  assertBooleanSuccess(
    result as {
      success?: boolean;
      result?: boolean;
      error?: {message?: string};
    },
    message,
  );
}

async function createTextboxElement(page: InsertTextboxPage): Promise<Element> {
  const created = await PluginCommAPI.createElement(TEXT_TYPE_NORMAL);
  const element = assertApiSuccess<Element>(
    created as {success?: boolean; result?: Element; error?: {message?: string}},
    'Failed to create textbox element.',
  );

  const textBox = element.textBox ?? new TextBox();

  element.pageNum = page.pageNumber;
  element.layerNum = MAIN_LAYER;

  textBox.fontSize = page.fontSize;
  textBox.fontPath = page.fontPath || null;
  textBox.textContentFull = page.text;
  textBox.textRect = page.rect;
  textBox.textAlign = 0;
  textBox.textBold = 0;
  textBox.textItalics = 0;
  textBox.textFrameWidthType = 0;
  textBox.textFrameStyle = 0;
  textBox.textEditable = 0;
  textBox.textDigestData = null;

  element.textBox = textBox;

  return element;
}

export async function insertTextboxPages(params: {
  notePath: string;
  currentPage: number;
  pages: InsertTextboxPage[];
  templateName?: string;
  onProgress?: (update: InsertTextboxPagesProgressUpdate) => void;
}): Promise<InsertTextboxPagesResult> {
  const templateName = params.templateName ?? DEFAULT_TEMPLATE_NAME;
  const pagesToCreate = params.pages.filter(page => page.createPage !== false);

  params.onProgress?.({message: 'Saving current note before insertion...'});
  await saveCurrentNote('Failed to save the current note before inserting pages.');

  for (const [index, page] of pagesToCreate.entries()) {
    params.onProgress?.({
      message: `Creating page ${index + 1} of ${pagesToCreate.length}...`,
    });

    const result = await withTimeout(
      PluginFileAPI.insertNotePage({
        notePath: params.notePath,
        page: page.pageNumber,
        template: templateName,
      }),
      INSERT_PAGE_TIMEOUT_MS,
      `Timed out while inserting page ${page.pageNumber}.`,
    );

    assertBooleanSuccess(
      result as {success?: boolean; result?: boolean; error?: {message?: string}},
      `Failed to insert page ${page.pageNumber}.`,
    );
  }

  let insertedTextboxCount = 0;

  for (const [index, page] of params.pages.entries()) {
    params.onProgress?.({
      message: `Inserting textbox ${index + 1} of ${params.pages.length}...`,
    });

    let elements: Element[] = [];

    try {
      const element = await createTextboxElement(page);
      elements = [element];

      const result = await PluginFileAPI.insertElements(
        params.notePath,
        page.pageNumber,
        elements,
      );

      assertBooleanSuccess(
        result as {success?: boolean; result?: boolean; error?: {message?: string}},
        `Failed to insert textbox on page ${page.pageNumber}.`,
      );

      insertedTextboxCount += 1;
    } finally {
      await recycleElements(elements);
    }
  }

  params.onProgress?.({message: 'Saving imported textboxes...'});
  await saveCurrentNote('Failed to save the note after inserting textboxes.');

  return {
    createdPageCount: pagesToCreate.length,
    insertedTextboxCount,
  };
}