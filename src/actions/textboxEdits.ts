import {appendFontWarning} from '../domain/fontPaths';
import {Clipboard} from 'react-native';
import {Element, type Rect, TextBox} from 'sn-plugin-lib';
import {createBackupPayload} from '../domain/backupPayload';
import {cloneRect, rectWidth} from '../domain/geometry';
import {DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION} from '../domain/textboxLayout';
import {DEFAULT_FONT_SIZE} from '../domain/textboxModel';
import {
  cleanupTextboxWhitespace,
  removeLineBreaks,
  splitIntoParagraphCandidates,
  splitIntoSentenceCandidates,
} from '../domain/textSplitting';
import type {TextboxActionKind} from '../domain/textboxActionKinds';
import {
  buildActionPreview,
  buildJoinedTextboxText,
  buildTextInsert,
  buildTextboxLogItems,
  ensureClearlyOrderedColumn,
  ensureLayoutFitsPage,
  ensureNoCollision,
  formatTextboxLogClipboard,
  formatTextboxLogPreviewItem,
  isNormalTextElement,
  sortTextElements,
  type PreparedTextInsert,
  type TextboxActionPreview,
} from '../domain/textboxEditPlan';
import {writeBackupFile} from '../storage/backupFile';
import {
  deleteLassoElements,
  getCurrentPageElementsContext,
  getLassoElements,
  getPageContext,
  hideLassoBox,
  insertTextboxElement,
  modifySelectedTextbox,
  recycleElements,
} from '../supernote/noteElements';
import {
  estimateTextboxHeight as estimateSharedTextboxHeight,
  getFontWarning,
  resetFontWarnings,
} from '../supernote/textboxMetrics';

/**
 * The direct textbox actions behind the toolbar buttons: split, split paragraphs, join, clean
 * spaces, remove line breaks and "Log All Textboxes". Each flow reads the page, builds the preview,
 * and on confirmation writes the backup and changes the note. What changes is planned in
 * `src/domain/textboxEditPlan.ts` and `src/domain/textSplitting.ts`.
 *
 * Textbox sizing and reading-order logic come from the shared helpers so that textbox tools and
 * edit markers stay consistent.
 */

export type TextboxActionResult = {
  message: string;
  backupPath: string;
  clipboardSummary: string;
  insertedCount: number;
  selectedCount: number;
  previewBlocks?: string[];
};

export type TextboxActionProgressUpdate = {
  message: string;
};

type TextElement = Element & {
  textBox: TextBox;
};
type TextboxActionExecutionOptions = {
  onProgress?: (update: TextboxActionProgressUpdate) => void;
};
const TEXTBOX_GAP = 16;

function reportTextboxActionProgress(
  options: TextboxActionExecutionOptions | undefined,
  message: string,
): void {
  options?.onProgress?.({message});
}

async function estimateTextBoxHeightForInsert(
  text: string,
  width: number,
  fontSize: number,
  fontPath?: string,
): Promise<number> {
  return estimateSharedTextboxHeight(
    text,
    width,
    fontSize,
    fontPath,
    DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION,
  );
}

async function buildJoinInsert(elements: TextElement[]): Promise<PreparedTextInsert> {
  const sorted = sortTextElements(elements);
  const topmost = sorted[0].textBox;
  const baseRect = cloneRect(topmost.textRect);
  const combinedText = buildJoinedTextboxText(elements);
  const height = await estimateTextBoxHeightForInsert(
    combinedText,
    rectWidth(baseRect),
    topmost.fontSize || DEFAULT_FONT_SIZE,
    topmost.fontPath || undefined,
  );

  return buildTextInsert(topmost, combinedText, {
    left: baseRect.left,
    top: baseRect.top,
    right: baseRect.right,
    bottom: baseRect.top + height,
  });
}

async function buildSplitInserts(element: TextElement): Promise<PreparedTextInsert[]> {
  const sourceTextBox = element.textBox;
  const sourceRect = cloneRect(sourceTextBox.textRect);
  const sentences = splitIntoSentenceCandidates(sourceTextBox.textContentFull || '');

  if (sentences.length < 2) {
    throw new Error('Could not find at least two reliable sentence segments to split.');
  }

  const inserts: PreparedTextInsert[] = [];
  let top = sourceRect.top;
  const width = rectWidth(sourceRect);
  const fontSize = sourceTextBox.fontSize || DEFAULT_FONT_SIZE;

  for (const sentence of sentences) {
    const height = await estimateTextBoxHeightForInsert(
      sentence,
      width,
      fontSize,
      sourceTextBox.fontPath || undefined,
    );
    const rect: Rect = {
      left: sourceRect.left,
      top,
      right: sourceRect.right,
      bottom: top + height,
    };

    inserts.push(buildTextInsert(sourceTextBox, sentence, rect));
    top = rect.bottom + TEXTBOX_GAP;
  }

  return inserts;
}
async function buildParagraphSplitInserts(
  element: TextElement,
): Promise<PreparedTextInsert[]> {
   const sourceTextBox = element.textBox;
  const sourceRect = cloneRect(sourceTextBox.textRect);

  const parts = splitIntoParagraphCandidates(
    element.textBox.textContentFull || '',
  );

  if (parts.length < 2) {
    throw new Error(
      'Could not find at least two paragraph segments to split.',
    );
  }

const inserts: PreparedTextInsert[] = [];
  let top = sourceRect.top;
  const width = rectWidth(sourceRect);
  const fontSize = sourceTextBox.fontSize || DEFAULT_FONT_SIZE;

  for (const part of parts) {
    const height = await estimateTextBoxHeightForInsert(
      part,
      width,
      fontSize,
      sourceTextBox.fontPath || undefined,
    );
    const rect: Rect = {
      left: sourceRect.left,
      top,
      right: sourceRect.right,
      bottom: top + height,
    };

    inserts.push(buildTextInsert(sourceTextBox, part, rect));
    top = rect.bottom + TEXTBOX_GAP;
  }

  return inserts;
}
async function insertTextBoxes(
  inserts: PreparedTextInsert[],
  options?: TextboxActionExecutionOptions,
): Promise<void> {
  for (let index = 0; index < inserts.length; index += 1) {
    const insert = inserts[index];
    await insertTextboxElement(insert);
    reportTextboxActionProgress(options, `Created ${index + 1} out of ${inserts.length} textboxes.`);
  }
}

/** Reads the lasso selection once and builds every action's preview for it. */
export async function getTextboxActionPreview(): Promise<TextboxActionPreview> {
  let lassoElements: Element[] = [];
  try {
    lassoElements = await getLassoElements();
    return buildActionPreview(lassoElements);
  } finally {
    await recycleElements(lassoElements);
  }
}

/**
 * Runs a textbox action and appends a warning to its message when a textbox font couldn't be read,
 * because then the new textboxes were sized with a standard font (`src/domain/fontPaths.ts`).
 */
export async function performTextboxAction(
  action: TextboxActionKind,
  options?: TextboxActionExecutionOptions,
): Promise<TextboxActionResult> {
  resetFontWarnings();
  const result = await runTextboxAction(action, options);
  return {...result, message: appendFontWarning(result.message, getFontWarning())};
}

async function runTextboxAction(
  action: TextboxActionKind,
  options?: TextboxActionExecutionOptions,
): Promise<TextboxActionResult> {
  let lassoElements: Element[] = [];
  let pageElements: Element[] = [];

  try {
    if (action === 'log') {
      reportTextboxActionProgress(options, 'Logging all textboxes on this page...');
      return await logAllCurrentPageTextboxes();
    }

    reportTextboxActionProgress(options, 'Checking selection...');
    const context = await getPageContext();
    lassoElements = context.lassoElements;
    pageElements = context.pageElements;

    if (lassoElements.length === 0) {
      throw new Error('Select one or more main-layer textboxes first.');
    }

    const textElements = lassoElements.filter(isNormalTextElement);
    if (textElements.length !== lassoElements.length) {
      throw new Error('Only normal main-layer textboxes are supported right now.');
    }

    if (action === 'split' && textElements.length !== 1) {
      throw new Error('Split works with exactly one selected textbox.');
    }
    if (action === 'splitParagraphs' && textElements.length !== 1) {
      throw new Error('Split works with exactly one selected textbox.');
    }

    if (action === 'join' && textElements.length < 2) {
      throw new Error('Join works with at least two selected textboxes.');
    }

    if (action === 'clean' && textElements.length !== 1) {
      throw new Error('Clean Spaces works with exactly one selected textbox.');
    }

    if (action === 'unwrap' && textElements.length !== 1) {
      throw new Error('Remove Line Breaks works with exactly one selected textbox.');
    }

    if (action === 'join') {
      ensureClearlyOrderedColumn(textElements);
    }

    reportTextboxActionProgress(options, 'Creating backup...');
    const backupPayload = createBackupPayload(
      action,
      context.notePath,
      context.page,
      textElements,
    );
    const {backupPath, clipboardSummary} = await writeBackupFile(backupPayload);

    if (action === 'clean') {
      const sourceTextBox = textElements[0].textBox;
      const originalText = sourceTextBox.textContentFull || '';
      const cleanedText = cleanupTextboxWhitespace(originalText);

      if (!cleanedText) {
        throw new Error('Cleanup would remove all text, so it was not applied.');
      }

      if (cleanedText === originalText) {
        throw new Error('No unnecessary spaces were found in the selected textbox.');
      }

      reportTextboxActionProgress(options, 'Applying change...');
      await modifySelectedTextbox({
        ...sourceTextBox,
        textContentFull: cleanedText,
      });

      await hideLassoBox();

      return {
        message: 'Cleaned unnecessary spaces in one textbox.',
        backupPath,
        clipboardSummary,
        insertedCount: 1,
        selectedCount: textElements.length,
      };
    }

    if (action === 'unwrap') {
      const sourceTextBox = textElements[0].textBox;
      const originalText = sourceTextBox.textContentFull || '';
      const unwrappedText = removeLineBreaks(originalText);

      if (!unwrappedText) {
        throw new Error('Remove Line Breaks would remove all text, so it was not applied.');
      }

      if (unwrappedText === originalText) {
        throw new Error('No line breaks were found in the selected textbox.');
      }

      reportTextboxActionProgress(options, 'Applying change...');
      await modifySelectedTextbox({
        ...sourceTextBox,
        textContentFull: unwrappedText,
      });

      await hideLassoBox();

      return {
        message: 'Removed line breaks in one textbox.',
        backupPath,
        clipboardSummary,
        insertedCount: 1,
        selectedCount: textElements.length,
      };
    }

    reportTextboxActionProgress(options, 'Preparing textboxes...');

    let inserts: PreparedTextInsert[];

    if (action === 'split') {
      inserts = await buildSplitInserts(textElements[0]);
    }
    else if (action === 'splitParagraphs') {
      inserts = await buildParagraphSplitInserts(textElements[0]);
    }
    else if (action === 'join') {
      inserts = [await buildJoinInsert(textElements)];
    } else {
      throw new Error(`Unsupported textbox action: ${action}`);
    }


    const newRects = inserts.map(insert => cloneRect(insert.textRect));

    ensureLayoutFitsPage(newRects, context.pageWidth, context.pageHeight);
    ensureNoCollision(newRects, pageElements, textElements);

    reportTextboxActionProgress(options, 'Applying change...');
    await deleteLassoElements();

    await insertTextBoxes(inserts, action === 'split' ? options : undefined);

    await hideLassoBox();

    return {
      message:
        action === 'split'
          ? `Split one textbox into ${inserts.length} textboxes.`
          : `Joined ${textElements.length} textboxes into one.`,
      backupPath,
      clipboardSummary,
      insertedCount: inserts.length,
      selectedCount: textElements.length,
    };
  } finally {
    await recycleElements(lassoElements);
    await recycleElements(pageElements);
  }
}

// "Log All Textboxes": every textbox of the current page with its rectangle and font size,
// logged and summarized on the clipboard, to check sizes and positions against the device.

async function logAllCurrentPageTextboxes(): Promise<TextboxActionResult> {
  let pageElements: Element[] = [];

  try {
    const context = await getCurrentPageElementsContext();
    pageElements = context.pageElements;
    const items = buildTextboxLogItems(context.page, pageElements);

    console.log(
      '[TextboxActions] allTextboxesDump',
      JSON.stringify({
        notePath: context.notePath,
        page: context.page,
        textboxCount: items.length,
        textboxes: items,
      }),
    );

    const clipboardSummary = formatTextboxLogClipboard(
      items,
      context.notePath,
      context.page,
    );
    Clipboard.setString(clipboardSummary);

    return {
      message: `Logged ${items.length} textboxes on page ${context.page}.`,
      backupPath: '',
      clipboardSummary,
      insertedCount: 0,
      selectedCount: items.length,
      previewBlocks:
        items.length > 0
          ? items.map(formatTextboxLogPreviewItem)
          : ['No normal main-layer textboxes found on this page.'],
    };
  } finally {
    await recycleElements(pageElements);
  }
}
