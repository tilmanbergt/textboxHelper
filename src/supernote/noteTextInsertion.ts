import {
  Element,
  PluginCommAPI,
  PluginFileAPI,
  PluginNoteAPI,
  TextBox,
  type Rect,
} from 'sn-plugin-lib';
import {assertApiSuccess, assertBooleanSuccess, withTimeout} from './sdkResult';

export type TextboxInsertInstruction = {
  pageNumber: number;
  text: string;
  rect: Rect;
  fontSize: number;
  fontPath?: string;
  bold?: boolean;
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

/* -----------------------------
   helpers
----------------------------- */

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
      message: `Creating page ${index + 1} of ${pagesToCreate.length}…`,
    });

    const result = await withTimeout(
      PluginFileAPI.insertNotePage({
        notePath: params.notePath,
        page: page.pageNumber,
        template: templateName,
      }),
      INSERT_PAGE_TIMEOUT_MS,
      `Timeout creating page ${page.pageNumber + 1}`,
    );

    console.log('[NoteTextInsertion] insertNotePage', JSON.stringify({page: page.pageNumber, result}));
    assertBooleanSuccess(result as any, `Could not create page ${page.pageNumber + 1}.`);
  }

  /* -----------------------------
     textbox + heading insertion
  ----------------------------- */
  let insertedCount = 0;

  for (const [index, instruction] of params.pages.entries()) {
    params.onProgress?.({
      message: `Inserting textbox ${index + 1} of ${params.pages.length} (page ${instruction.pageNumber + 1})…`,
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

      console.log(
        '[NoteTextInsertion] insertElements',
        JSON.stringify({index, page: instruction.pageNumber, chars: instruction.text.length, result}),
      );
      assertBooleanSuccess(
        result as any,
        `Could not insert textbox ${index + 1} of ${params.pages.length} on page ${instruction.pageNumber + 1}.`,
      );

      insertedCount += 1;
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

/** A new textbox for `insertTextboxesIntoFile`: its text, place and the style it copies. */
export type StyledTextboxInsert = {
  text: string;
  rect: Rect;
  style: {
    fontSize: number;
    fontPath: string | null;
    textAlign: number;
    textBold: number;
    textItalics: number;
    textFrameWidthType: number;
    textFrameStyle: number;
    textEditable: number;
  };
};

/**
 * Writes new textboxes into the note file (`PluginFileAPI.insertElements`), like the other edit
 * steps that write the file. Inserting through the open note instead (`insertText`) was lost when
 * NOTE reloaded the changed file.
 */
export async function insertTextboxesIntoFile(notePath: string, page: number, inserts: StyledTextboxInsert[]): Promise<void> {
  for (const insert of inserts) {
    let elements: Element[] = [];
    try {
      const created = await PluginCommAPI.createElement(TEXT_TYPE_NORMAL);
      const element = assertApiSuccess<Element>(created as any, 'Failed to create textbox element.');
      elements = [element];
      const textBox = element.textBox ?? new TextBox();
      element.pageNum = page;
      element.layerNum = MAIN_LAYER;
      textBox.fontSize = insert.style.fontSize;
      textBox.fontPath = insert.style.fontPath;
      textBox.textContentFull = insert.text;
      textBox.textRect = insert.rect;
      textBox.textAlign = insert.style.textAlign;
      textBox.textBold = insert.style.textBold;
      textBox.textItalics = insert.style.textItalics;
      textBox.textFrameWidthType = insert.style.textFrameWidthType;
      textBox.textFrameStyle = insert.style.textFrameStyle;
      textBox.textEditable = insert.style.textEditable;
      textBox.textDigestData = null;
      element.textBox = textBox;
      const result = await PluginFileAPI.insertElements(notePath, page, elements);
      console.log('[NoteTextInsertion] new paragraph', JSON.stringify({page, chars: insert.text.length, result}));
      assertBooleanSuccess(result as any, 'Could not put the new paragraph into the note.');
    } finally {
      await recycleElements(elements);
    }
  }
}
