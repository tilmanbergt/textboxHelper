import {
  Element,
  PluginCommAPI,
  PluginFileAPI,
  PluginNoteAPI,
  TextBox,
  type Rect,
} from 'sn-plugin-lib';

export type TextboxInsertInstruction = {
  pageNumber: number;
  text: string;
  rect: Rect;
  fontSize: number;
  fontPath?: string;
  bold?: boolean;
  createPage?: boolean;
  isHeading?: boolean;
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

/* -----------------------------
   helpers
----------------------------- */

function assertApiSuccess<T>(
  response: { success?: boolean; result?: T; error?: { message?: string } } | null | undefined,
  fallback: string,
): T {
  if (response?.success) return response.result as T;
  throw new Error(response?.error?.message || fallback);
}

function assertBooleanSuccess(
  response: { success?: boolean; result?: boolean; error?: { message?: string } } | null | undefined,
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
      .then(r => {
        clearTimeout(timer);
        resolve(r);
      })
      .catch(e => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

async function recycleElements(elements: Element[]): Promise<void> {
  await Promise.all(
    elements.map(el =>
      typeof el.recycle === 'function'
        ? el.recycle().catch(() => undefined)
        : Promise.resolve(),
    ),
  );
}

async function saveCurrentNote(message: string): Promise<void> {
  const result = await PluginNoteAPI.saveCurrentNote();

  assertBooleanSuccess(
    result as any,
    message,
  );
}

/* -----------------------------
   element creation
----------------------------- */

async function createTextboxElement(instruction: TextboxInsertInstruction): Promise<Element> {
  const created = await PluginCommAPI.createElement(TEXT_TYPE_NORMAL);

  const element = assertApiSuccess<Element>(
    created as any,
    'Failed to create textbox element.',
  );

  const textBox = element.textBox ?? new TextBox();

  element.pageNum = instruction.pageNumber;
  element.layerNum = MAIN_LAYER;

  textBox.fontSize = instruction.fontSize;
  textBox.fontPath = instruction.fontPath || null;
  textBox.textContentFull = instruction.text;
  textBox.textRect = instruction.rect;
  textBox.textAlign = 0;
  textBox.textBold = instruction.bold ? 1 : 0;
  textBox.textItalics = 0;
  textBox.textFrameWidthType = 0;
  textBox.textFrameStyle = 0;
  textBox.textEditable = 0;
  textBox.textDigestData = null;

  element.textBox = textBox;

  return element;
}

/* -----------------------------
   main API
----------------------------- */

export async function insertTextboxPages(params: {
  notePath: string;
  currentPage: number;
  pages: TextboxInsertInstruction[];
  templateName?: string;
  onProgress?: (update: InsertTextboxPagesProgressUpdate) => void;
}): Promise<InsertTextboxPagesResult> {
  const templateName = params.templateName ?? DEFAULT_TEMPLATE_NAME;

  const pagesToCreate = params.pages.filter(p => p.createPage !== false);

  params.onProgress?.({ message: 'Saving current note...' });
  await saveCurrentNote('Failed to save note before insertion.');

  /* -----------------------------
     page creation
  ----------------------------- */
  for (const [index, page] of pagesToCreate.entries()) {
    params.onProgress?.({
      message: `Creating page ${index + 1} / ${pagesToCreate.length}...`,
    });

    const result = await withTimeout(
      PluginFileAPI.insertNotePage({
        notePath: params.notePath,
        page: page.pageNumber,
        template: templateName,
      }),
      INSERT_PAGE_TIMEOUT_MS,
      `Timeout creating page ${page.pageNumber}`,
    );

    assertBooleanSuccess(result as any, `Failed page ${page.pageNumber}`);
  }

  /* -----------------------------
     textbox + heading insertion
  ----------------------------- */
  let insertedCount = 0;

  for (const [index, instruction] of params.pages.entries()) {
    params.onProgress?.({
      message: `Inserting textbox ${index + 1} / ${params.pages.length}...`,
    });

    let elements: Element[] = [];

    try {
      const element = await createTextboxElement(instruction);
      elements = [element];

      const result = await PluginFileAPI.insertElements(
        params.notePath,
        instruction.pageNumber,
        elements,
      );

      assertBooleanSuccess(result as any, `Failed textbox insert`);

      insertedCount += 1;

      /* -----------------------------
         heading → title conversion
      ----------------------------- */
      if (instruction.isHeading === true) {
        const titleRes = await PluginCommAPI.createElement(100);

        const titleElement = assertApiSuccess<Element>(
          titleRes as any,
          'Failed to create title element',
        );

        const textBoxIndex = element.numInPage;

        titleElement.pageNum = instruction.pageNumber;
        titleElement.layerNum = 0;
        titleElement.style = 0;
        titleElement.controlTrailNums = [textBoxIndex];

        await PluginFileAPI.insertElements(
          params.notePath,
          instruction.pageNumber,
          [titleElement],
        );
      }

    } finally {
      await recycleElements(elements);
    }
  }

  /* -----------------------------
     final save
  ----------------------------- */
  params.onProgress?.({ message: 'Saving final note...' });
  await saveCurrentNote('Failed final save.');

  return {
    createdPageCount: pagesToCreate.length,
    insertedTextboxCount: insertedCount,
  };
}