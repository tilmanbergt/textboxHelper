import {Clipboard} from 'react-native';
import {buildBackupDir, buildBackupPath} from './shared/backupPaths';
import {appendFontWarning} from './shared/fontPaths';
import RNFS from 'react-native-fs';
import {
  Element,
  FileUtils,
  PluginCommAPI,
  PluginFileAPI,
  PluginManager,
  PluginNoteAPI,
  type Rect,
  TextBox,
} from 'sn-plugin-lib';
import {
  cloneRect,
  rectHeight,
  rectWidth,
  sortTextElementsByReadingOrder,
} from './shared/supernoteTextboxGeometry';
import {
  DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION,
  estimateTextboxHeight as estimateSharedTextboxHeight,
  getFontWarning,
  resetFontWarnings,
} from './shared/supernoteTextboxLayout';

/**
 * Textbox tool engine.
 *
 * This module owns the direct textbox transformations that do not depend on handwritten
 * markers: split, join, clean spaces, and remove line breaks. It is also responsible for
 * preview generation and execution planning for those actions.
 *
 * Textbox sizing and reading-order logic should come from the shared Supernote helpers so
 * that textbox tools and edit markers stay consistent.
 */

export type TextboxActionKind = 'split' | 'splitParagraphs' | 'join' | 'clean' | 'unwrap' | 'log';

export type TextboxActionAvailability = Record<TextboxActionKind, boolean>;

export type TextboxActionPreview = {
  selectedCount: number;
  beforeBlocks: string[];
  afterBlocks: string[];
  availableActions: TextboxActionAvailability;
  selectionMessage: string;
  hasOnlyTextboxes: boolean;
};
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
  canCancel: boolean;
};

type TextElement = Element & {
  textBox: TextBox;
};

type PreparedTextInsert = {
  textContentFull: string;
  textRect: Rect;
  fontSize: number;
  fontPath?: string;
  textAlign: number;
  textBold: number;
  textItalics: number;
  textFrameWidthType: number;
  textFrameStyle: number;
  textEditable: number;
};

type TextboxActionExecutionOptions = {
  isCancelled?: () => boolean;
  onProgress?: (update: TextboxActionProgressUpdate) => void;
};

type TextboxLogItem = {
  page: number;
  uuid: string;
  numInPage: number;
  layerNum: number;
  text: string;
  textPreview: string;
  rect: Rect;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontPath: string | null;
  textAlign: number;
  textBold: number;
  textItalics: number;
  textFrameWidthType: number;
  textFrameStyle: number;
  textEditable: number;
  textLength: number;
  wordCount: number;
  newlineCount: number;
};
type BackupPayload = {
  action: TextboxActionKind;
  createdAt: string;
  notePath: string;
  page: number;
  selectedCount: number;
  texts: Array<{
    uuid: string;
    numInPage: number;
    layerNum: number;
    textContentFull: string;
    textRect: Rect;
    fontSize: number;
    fontPath: string | null;
    textAlign: number;
    textBold: number;
    textItalics: number;
    textFrameWidthType: number;
    textFrameStyle: number;
    textEditable: number;
  }>;
};

const TEXT_TYPE_NORMAL = 500;
const MAIN_LAYER = 0;
const ORDER_GAP_RATIO = 0.25;
const MIN_TEXTBOX_WIDTH = 80;
const TEXTBOX_GAP = 16;
const DEFAULT_FONT_SIZE = 32;
const CLIPBOARD_PREVIEW_LIMIT = 3000;
export const TEXTBOX_ACTION_CANCELLED_MESSAGE = 'Action cancelled.';
const COMMON_ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'sr',
  'jr',
  'st',
  'vs',
  'etc',
  'e.g',
  'i.e',
  'u.s',
  'u.k',
  'jan',
  'feb',
  'mar',
  'apr',
  'jun',
  'jul',
  'aug',
  'sep',
  'sept',
  'oct',
  'nov',
  'dec',
]);

function assertApiSuccess<T>(
  response: {success?: boolean; result?: T; error?: {message?: string}} | null | undefined,
  fallback: string,
): T {
  if (response?.success) {
    return response.result as T;
  }

  throw new Error(response?.error?.message || fallback);
}

function normalizeInlineWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function reportTextboxActionProgress(
  options: TextboxActionExecutionOptions | undefined,
  message: string,
  canCancel: boolean,
): void {
  options?.onProgress?.({message, canCancel});
}

function throwIfTextboxActionCancelled(
  options: TextboxActionExecutionOptions | undefined,
): void {
  if (options?.isCancelled?.()) {
    throw new Error(TEXTBOX_ACTION_CANCELLED_MESSAGE);
  }
}

function cleanupTextboxWhitespace(text: string): string {
  const normalizedLineEndings = text.replace(/\r\n?/g, '\n');
  const cleanedLines = normalizedLineEndings.split('\n').map(line =>
    line
      .replace(/[\t\f\v\u00A0 ]+/g, ' ')
      .replace(/\s+([,.;:!?%)\]}])/g, '$1')
      .replace(/([([{])\s+/g, '$1')
      .trim(),
  );

  return cleanedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function removeLineBreaks(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/[ \t\f\v\u00A0]+/g, ' ')
    .trim();
}

function normalizeJoinBoundary(previous: string, next: string): string {
  const left = previous.replace(/\s+$/g, '');
  const right = next.replace(/^\s+/g, '');

  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  if (/\s$/.test(previous) || /^\s/.test(next)) {
    return `${left} ${right}`.trim();
  }

  if (/[.?!:;]$/.test(left) || /[\p{L}\p{N}]$/u.test(left)) {
    return `${left} ${right}`;
  }

  return `${left}${right}`;
}

function countRealWords(text: string): number {
  const matches = text.match(/[^\W\d_]{2,}/gu);
  return matches ? matches.length : 0;
}

function countWords(text: string): number {
  const matches = text.match(/\S+/g);
  return matches ? matches.length : 0;
}

function pushSentenceCandidate(
  candidates: string[],
  text: string,
): void {
  const normalized = normalizeInlineWhitespace(text);
  if (!normalized) {
    return;
  }

  candidates.push(normalized);
}

function isSentenceBoundary(text: string, index: number): boolean {
  const char = text[index];

  if (!'.!?'.includes(char)) {
    return false;
  }

  if (char === '.' && /\d/.test(text[index - 1] || '') && /\d/.test(text[index + 1] || '')) {
    return false;
  }

  if (char === '.' && text[index + 1] === '.') {
    return false;
  }

  const prefix = text.slice(0, index);
  const tokenMatch = prefix.match(/([A-Za-z][A-Za-z.]{0,15})$/);
  if (char === '.' && tokenMatch) {
    const token = tokenMatch[1].replace(/\.+$/g, '').toLowerCase();
    if (COMMON_ABBREVIATIONS.has(token)) {
      return false;
    }
  }

  let lookaheadIndex = index + 1;
  while (
    lookaheadIndex < text.length &&
    /[\s"'`)\]}Â»]/.test(text[lookaheadIndex] || '')
  ) {
    if (text[lookaheadIndex] === '\n') {
      return true;
    }
    lookaheadIndex += 1;
  }

  if (lookaheadIndex >= text.length) {
    return true;
  }

  const nextChar = text[lookaheadIndex];
  if (/[\p{Lu}\d]/u.test(nextChar)) {
    return true;
  }

  if (char === '!' || char === '?') {
    return true;
  }

  return false;
}

function mergeTinyFragmentsForward(fragments: string[]): string[] {
  const merged: string[] = [];
  let carry = '';

  for (const fragment of fragments) {
    const normalized = normalizeInlineWhitespace(fragment);
    if (!normalized) {
      continue;
    }

    if (countRealWords(normalized) < 2) {
      carry = carry ? `${carry} ${normalized}` : normalized;
      continue;
    }

    if (carry) {
      merged.push(normalizeInlineWhitespace(`${carry} ${normalized}`));
      carry = '';
      continue;
    }

    merged.push(normalized);
  }

  if (carry) {
    if (merged.length > 0) {
      merged[merged.length - 1] = normalizeInlineWhitespace(
        `${merged[merged.length - 1]} ${carry}`,
      );
    } else {
      merged.push(carry);
    }
  }

  return merged;
}



function splitIntoSentenceCandidates(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const candidates: string[] = [];

  for (const paragraph of normalized.split(/\n+/)) {
    const trimmedParagraph = paragraph.trim();
    if (!trimmedParagraph) {
      continue;
    }

    let cursor = 0;
    for (let index = 0; index < trimmedParagraph.length; index += 1) {
      if (!isSentenceBoundary(trimmedParagraph, index)) {
        continue;
      }

      pushSentenceCandidate(candidates, trimmedParagraph.slice(cursor, index + 1));
      cursor = index + 1;
    }

    if (cursor < trimmedParagraph.length) {
      pushSentenceCandidate(candidates, trimmedParagraph.slice(cursor));
    }
  }

  return mergeTinyFragmentsForward(candidates);
}

function countSentences(text: string): number {
  return splitIntoSentenceCandidates(text).length;
}
function splitIntoParagraphCandidates(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim();

  if (!normalized) {
    return [];
  }

  const paragraphs: string[] = [];

  // First: hard split on blank lines
  const blocks = normalized.split(/\n{2,}/);

  for (const block of blocks) {
    const trimmedBlock = block.trim();

    if (!trimmedBlock) {
      continue;
    }

    // Then inspect single line breaks inside the block
    const lines = trimmedBlock.split('\n');

    let currentParagraph = lines[0]?.trim() || '';

    for (let i = 1; i < lines.length; i += 1) {
      const nextLine = lines[i].trim();


      if (countSentences(currentParagraph) > 1) {

        paragraphs.push(currentParagraph);
        currentParagraph = nextLine;
      } else {
        currentParagraph = normalizeInlineWhitespace(
          `${currentParagraph} ${nextLine}`,
        );
      }
    }

    if (currentParagraph) {
      paragraphs.push(currentParagraph);
    }
  }

  return paragraphs;
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

function buildTextInsert(base: TextBox, textContentFull: string, textRect: Rect): PreparedTextInsert {
  return {
    textContentFull,
    textRect,
    fontSize: base.fontSize || DEFAULT_FONT_SIZE,
    ...(base.fontPath ? {fontPath: base.fontPath} : {}),
    textAlign: base.textAlign ?? 0,
    textBold: base.textBold ?? 0,
    textItalics: base.textItalics ?? 0,
    textFrameWidthType: base.textFrameWidthType ?? 0,
    textFrameStyle: base.textFrameStyle ?? 0,
    textEditable: base.textEditable ?? 0,
  };
}

function isNormalTextElement(element: Element): element is TextElement {
  return (
    element.type === TEXT_TYPE_NORMAL &&
    element.layerNum === MAIN_LAYER &&
    !!element.textBox?.textContentFull &&
    !!element.textBox?.textRect
  );
}

function sortTextElements(elements: TextElement[]): TextElement[] {
  return sortTextElementsByReadingOrder(elements);
}

function ensureClearlyOrderedColumn(elements: TextElement[]): void {
  const sorted = sortTextElements(elements);

  for (let index = 0; index < sorted.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < sorted.length; compareIndex += 1) {
      const upperRect = sorted[index].textBox.textRect;
      const lowerRect = sorted[compareIndex].textBox.textRect;
      const threshold =
        Math.min(rectHeight(upperRect), rectHeight(lowerRect)) * ORDER_GAP_RATIO;

      const topClearlyAbove = upperRect.top + threshold < lowerRect.top;
      const bottomClearlyAbove = upperRect.bottom + threshold < lowerRect.bottom;

      if (!topClearlyAbove || !bottomClearlyAbove) {
        throw new Error(
          'Selection is not clearly ordered from top to bottom in one loose column.',
        );
      }
    }
  }
}

function buildClipboardSummary(payload: BackupPayload): string {
  const lines = [
    `textboxHelper ${payload.action} backup`,
    `Created: ${payload.createdAt}`,
    `Note: ${payload.notePath}`,
    `Page: ${payload.page}`,
    '',
  ];

  payload.texts.forEach((text, index) => {
    lines.push(`#${index + 1}`);
    lines.push(text.textContentFull);
    lines.push('');
  });

  return lines.join('\n').slice(0, CLIPBOARD_PREVIEW_LIMIT);
}

async function writeBackupFile(payload: BackupPayload): Promise<{
  backupPath: string;
  clipboardSummary: string;
}> {
  const pluginDir = await PluginManager.getPluginDirPath();
  if (!pluginDir) {
    throw new Error('Could not find the plugin folder for the backup. Nothing was changed.');
  }
  const backupDir = buildBackupDir(pluginDir);
  await RNFS.mkdir(backupDir);

  const backupPath = buildBackupPath(pluginDir, payload.action, payload.createdAt);
  await RNFS.writeFile(backupPath, JSON.stringify(payload, null, 2), 'utf8');

  const clipboardSummary = buildClipboardSummary(payload);
  Clipboard.setString(clipboardSummary);

  return {backupPath, clipboardSummary};
}

function createBackupPayload(
  action: TextboxActionKind,
  notePath: string,
  page: number,
  elements: TextElement[],
): BackupPayload {
  return {
    action,
    createdAt: new Date().toISOString(),
    notePath,
    page,
    selectedCount: elements.length,
    texts: elements.map(element => ({
      uuid: element.uuid,
      numInPage: element.numInPage,
      layerNum: element.layerNum,
      textContentFull: element.textBox.textContentFull || '',
      textRect: cloneRect(element.textBox.textRect),
      fontSize: element.textBox.fontSize || DEFAULT_FONT_SIZE,
      fontPath: element.textBox.fontPath,
      textAlign: element.textBox.textAlign ?? 0,
      textBold: element.textBox.textBold ?? 0,
      textItalics: element.textBox.textItalics ?? 0,
      textFrameWidthType: element.textBox.textFrameWidthType ?? 0,
      textFrameStyle: element.textBox.textFrameStyle ?? 0,
      textEditable: element.textBox.textEditable ?? 0,
    })),
  };
}

function getObstacleRect(element: Element): Rect | null {
  if (element.layerNum !== MAIN_LAYER) {
    return null;
  }

  if (element.type === TEXT_TYPE_NORMAL && element.textBox?.textRect) {
    return cloneRect(element.textBox.textRect);
  }

  if (element.title) {
    return {
      left: element.title.X,
      top: element.title.Y,
      right: element.title.X + element.title.width,
      bottom: element.title.Y + element.title.height,
    };
  }

  if (element.link) {
    return {
      left: element.link.X,
      top: element.link.Y,
      right: element.link.X + element.link.width,
      bottom: element.link.Y + element.link.height,
    };
  }

  if (element.picture?.rect) {
    return cloneRect(element.picture.rect);
  }

  return null;
}

function rectsOverlap(left: Rect, right: Rect): boolean {
  return !(
    left.right <= right.left ||
    left.left >= right.right ||
    left.bottom <= right.top ||
    left.top >= right.bottom
  );
}

function intersectionRect(left: Rect, right: Rect): Rect | null {
  const rect: Rect = {
    left: Math.max(left.left, right.left),
    top: Math.max(left.top, right.top),
    right: Math.min(left.right, right.right),
    bottom: Math.min(left.bottom, right.bottom),
  };

  if (rect.right <= rect.left || rect.bottom <= rect.top) {
    return null;
  }

  return rect;
}

function ensureLayoutFitsPage(
  newRects: Rect[],
  pageWidth: number,
  pageHeight: number,
): void {
  for (const rect of newRects) {
    if (rect.left < 0 || rect.top < 0 || rect.right > pageWidth || rect.bottom > pageHeight) {
      throw new Error('Result would not fit on the current page.');
    }

    if (rectWidth(rect) < MIN_TEXTBOX_WIDTH) {
      throw new Error('Textbox width is too small for a stable split/join result.');
    }
  }
}

function ensureNoCollision(
  newRects: Rect[],
  pageElements: Element[],
  selectedElements: TextElement[],
): void {
  const originalSelectionRect = {
    left: Math.min(...selectedElements.map(element => element.textBox.textRect.left)),
    top: Math.min(...selectedElements.map(element => element.textBox.textRect.top)),
    right: Math.max(...selectedElements.map(element => element.textBox.textRect.right)),
    bottom: Math.max(...selectedElements.map(element => element.textBox.textRect.bottom)),
  };
  const selectedUuids = new Set(selectedElements.map(element => element.uuid));

  for (const pageElement of pageElements) {
    if (selectedUuids.has(pageElement.uuid)) {
      continue;
    }

    const obstacleRect = getObstacleRect(pageElement);
    if (!obstacleRect) {
      continue;
    }

    for (const newRect of newRects) {
      const overlapWithNewRect = intersectionRect(newRect, obstacleRect);
      if (!overlapWithNewRect) {
        continue;
      }

      const overlapInsideOriginal = intersectionRect(
        overlapWithNewRect,
        originalSelectionRect,
      );

      if (
        overlapInsideOriginal &&
        overlapInsideOriginal.left === overlapWithNewRect.left &&
        overlapInsideOriginal.top === overlapWithNewRect.top &&
        overlapInsideOriginal.right === overlapWithNewRect.right &&
        overlapInsideOriginal.bottom === overlapWithNewRect.bottom
      ) {
        continue;
      }

      console.log(
        '[TextboxActions] collision',
        JSON.stringify({
          obstacleUuid: pageElement.uuid,
          obstacleType: pageElement.type,
          obstacleRect,
          originalSelectionRect,
          newRect,
          overlapWithNewRect,
          overlapInsideOriginal,
        }),
      );

      if (rectsOverlap(newRect, obstacleRect)) {
        throw new Error(
          'Not enough free space around the selection. Please create more room and try again.',
        );
      }
    }
  }
}

function buildJoinedTextboxText(elements: TextElement[]): string {
  const sorted = sortTextElements(elements);
  let combinedText = '';
  for (const element of sorted) {
    combinedText = normalizeJoinBoundary(
      combinedText,
      element.textBox.textContentFull || '',
    );
  }

  return combinedText;
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

function createEmptyAvailability(): TextboxActionAvailability {
  return {
    split: false,
    join: false,
    clean: false,
    unwrap: false,
    splitParagraphs: false,
    log: true,
  };
}

function getTextboxText(element: TextElement): string {
  return element.textBox.textContentFull || '';
}

function computeActionOutputs(textElements: TextElement[]): {
  beforeBlocks: string[];
  splitBlocks: string[];
  joinBlocks: string[];
  cleanBlocks: string[];
  unwrapBlocks: string[];
  logBlocks: string[];
  availableActions: TextboxActionAvailability;
} {
  const sortedTextElements = sortTextElements(textElements);
  const beforeBlocks = sortedTextElements.map(getTextboxText);
  const availableActions = createEmptyAvailability();

  let splitBlocks: string[] = [];
  let joinBlocks: string[] = [];
  let cleanBlocks: string[] = [];
  let unwrapBlocks: string[] = [];
  const logBlocks = ['Execute to log every textbox on this page.'];

  if (sortedTextElements.length === 1) {
    const sourceText = getTextboxText(sortedTextElements[0]);
    splitBlocks = splitIntoSentenceCandidates(sourceText);
    availableActions.split = true;

    cleanBlocks = [cleanupTextboxWhitespace(sourceText)];
    availableActions.clean = true;

    unwrapBlocks = [removeLineBreaks(sourceText)];
    availableActions.unwrap = true;
  }

  if (sortedTextElements.length >= 2) {
    try {
      ensureClearlyOrderedColumn(sortedTextElements);
      joinBlocks = [buildJoinedTextboxText(sortedTextElements)];
      availableActions.join = true;
    } catch {
      availableActions.join = false;
    }
  }

  return {
    beforeBlocks,
    splitBlocks,
    joinBlocks,
    cleanBlocks,
    unwrapBlocks,
    logBlocks,
    availableActions,
  };
}

function buildActionPreview(
  lassoElements: Element[],
  action: TextboxActionKind | null,
): TextboxActionPreview {
  const textElements = lassoElements.filter(isNormalTextElement);
  const selectedCount = textElements.length;
  const selectionMessage =
    selectedCount === 1 ? '1 textbox selected' : `${selectedCount} textboxes selected`;

  if (lassoElements.length === 0) {
    return {
      selectedCount: 0,
      beforeBlocks: [],
      afterBlocks: [],
      availableActions: createEmptyAvailability(),
      selectionMessage: '0 textboxes selected',
      hasOnlyTextboxes: true,
    };
  }

  if (textElements.length !== lassoElements.length) {
    return {
      selectedCount,
      beforeBlocks: sortTextElements(textElements).map(getTextboxText),
      afterBlocks: [],
      availableActions: createEmptyAvailability(),
      selectionMessage,
      hasOnlyTextboxes: false,
    };
  }

  const outputs = computeActionOutputs(textElements);
  let afterBlocks: string[] = [];

  if (action === 'split' && outputs.availableActions.split) {
    afterBlocks =
      outputs.splitBlocks.length >= 2 ? outputs.splitBlocks : outputs.beforeBlocks;
  } else if (action === 'join' && outputs.availableActions.join) {
    afterBlocks = outputs.joinBlocks;
  } else if (action === 'clean' && outputs.availableActions.clean) {
    afterBlocks = outputs.cleanBlocks.length > 0 ? outputs.cleanBlocks : outputs.beforeBlocks;
  } else if (action === 'unwrap' && outputs.availableActions.unwrap) {
    afterBlocks = outputs.unwrapBlocks.length > 0 ? outputs.unwrapBlocks : outputs.beforeBlocks;
  } else if (action === 'log' && outputs.availableActions.log) {
    afterBlocks = outputs.logBlocks;
  }

  return {
    selectedCount,
    beforeBlocks: outputs.beforeBlocks,
    afterBlocks,
    availableActions: outputs.availableActions,
    selectionMessage,
    hasOnlyTextboxes: true,
  };
}

async function getCurrentPageElementsContext(): Promise<{
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
    const response = await PluginNoteAPI.insertText(insert);
    assertApiSuccess(response as {success?: boolean; error?: {message?: string}}, 'insertText failed');
    reportTextboxActionProgress(
      options,
      `Created ${index + 1} out of ${inserts.length} textboxes.`,
      false,
    );
  }
}

async function modifySelectedTextbox(textBox: TextBox): Promise<void> {
  const response = await PluginNoteAPI.modifyLassoText(textBox);
  assertApiSuccess(
    response as {success?: boolean; error?: {message?: string}},
    'modifyLassoText failed',
  );
}

async function getPageContext(): Promise<{
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

export async function getTextboxActionPreview(
  action: TextboxActionKind | null,
): Promise<TextboxActionPreview> {
  let lassoElements: Element[] = [];
  let pageElements: Element[] = [];

  try {
    if (action === 'log') {
      const context = await getCurrentPageElementsContext();
      pageElements = context.pageElements;
      const textboxes = buildTextboxLogItems(context.page, pageElements);

      return {
        selectedCount: textboxes.length,
        beforeBlocks: [],
        afterBlocks: [
          textboxes.length > 0
            ? `Execute to log ${textboxes.length} textboxes on this page.`
            : 'No normal main-layer textboxes found on this page.',
        ],
        availableActions: {
          ...createEmptyAvailability(),
          log: true,
        },
        selectionMessage:
          textboxes.length === 1
            ? '1 textbox on current page'
            : `${textboxes.length} textboxes on current page`,
        hasOnlyTextboxes: true,
      };
    }

    const lassoResponse = await PluginCommAPI.getLassoElements();
    lassoElements = assertApiSuccess(
      lassoResponse as {success?: boolean; result?: Element[]; error?: {message?: string}},
      'Could not read the current lasso selection.',
    );

    return buildActionPreview(lassoElements, action);
  } finally {
    await recycleElements(lassoElements);
    await recycleElements(pageElements);
  }
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

/**
 * Runs a textbox action and appends a warning to its message when a textbox font couldn't be read,
 * because then the new textboxes were sized with a standard font (`src/shared/fontPaths.ts`).
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
      reportTextboxActionProgress(options, 'Logging all textboxes on this page...', false);
      return await logAllCurrentPageTextboxes();
    }

    reportTextboxActionProgress(options, 'Checking selection...', true);
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

    throwIfTextboxActionCancelled(options);
    reportTextboxActionProgress(options, 'Creating backup...', true);
    const backupPayload = createBackupPayload(
      action,
      context.notePath,
      context.page,
      textElements,
    );
    const {backupPath, clipboardSummary} = await writeBackupFile(backupPayload);
    throwIfTextboxActionCancelled(options);

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

      reportTextboxActionProgress(options, 'Applying change...', false);
      await modifySelectedTextbox({
        ...sourceTextBox,
        textContentFull: cleanedText,
      });

      const hideResponse = await PluginCommAPI.setLassoBoxState(2);
      if (!hideResponse?.success) {
        console.log(
          '[TextboxActions] setLassoBoxState failed',
          JSON.stringify(hideResponse),
        );
      }

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

      reportTextboxActionProgress(options, 'Applying change...', false);
      await modifySelectedTextbox({
        ...sourceTextBox,
        textContentFull: unwrappedText,
      });

      const hideResponse = await PluginCommAPI.setLassoBoxState(2);
      if (!hideResponse?.success) {
        console.log(
          '[TextboxActions] setLassoBoxState failed',
          JSON.stringify(hideResponse),
        );
      }

      return {
        message: 'Removed line breaks in one textbox.',
        backupPath,
        clipboardSummary,
        insertedCount: 1,
        selectedCount: textElements.length,
      };
    }

    reportTextboxActionProgress(options, 'Preparing textboxes...', true);

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
    throwIfTextboxActionCancelled(options);

    reportTextboxActionProgress(options, 'Applying change...', false);
    const deleteResponse = await PluginCommAPI.deleteLassoElements();
    assertApiSuccess(
      deleteResponse as {success?: boolean; error?: {message?: string}},
      'Could not delete the selected textboxes.',
    );

    await insertTextBoxes(inserts, action === 'split' ? options : undefined);

    const hideResponse = await PluginCommAPI.setLassoBoxState(2);
    if (!hideResponse?.success) {
      console.log(
        '[TextboxActions] setLassoBoxState failed',
        JSON.stringify(hideResponse),
      );
    }

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

function buildTextboxLogItems(page: number, pageElements: Element[]): TextboxLogItem[] {
  return sortTextElements(pageElements.filter(isNormalTextElement)).map(element => {
    const text = element.textBox.textContentFull || '';
    const rect = cloneRect(element.textBox.textRect);
    const width = rectWidth(rect);
    const height = rectHeight(rect);

    return {
      page,
      uuid: element.uuid,
      numInPage: element.numInPage,
      layerNum: element.layerNum,
      text,
      textPreview: text.slice(0, 160),
      rect,
      x: rect.left,
      y: rect.top,
      width,
      height,
      fontSize: element.textBox.fontSize || DEFAULT_FONT_SIZE,
      fontPath: element.textBox.fontPath || null,
      textAlign: element.textBox.textAlign ?? 0,
      textBold: element.textBox.textBold ?? 0,
      textItalics: element.textBox.textItalics ?? 0,
      textFrameWidthType: element.textBox.textFrameWidthType ?? 0,
      textFrameStyle: element.textBox.textFrameStyle ?? 0,
      textEditable: element.textBox.textEditable ?? 0,
      textLength: text.length,
      wordCount: countWords(text),
      newlineCount: (text.match(/\n/g) || []).length,
    };
  });
}

function formatTextboxLogPreviewItem(item: TextboxLogItem): string {
  const shortText = item.text.replace(/\s+/g, ' ').trim().slice(0, 70) || '(empty)';
  return [
    `#${item.numInPage} "${shortText}"`,
    `x=${item.x}, y=${item.y}, w=${item.width}, h=${item.height}`,
    `fontSize=${item.fontSize}, font=${item.fontPath || '(default)'}`,
  ].join('\n');
}

function formatTextboxLogClipboard(items: TextboxLogItem[], notePath: string, page: number): string {
  const lines = [
    'textboxHelper textbox coordinate log',
    `Created: ${new Date().toISOString()}`,
    `Note: ${notePath}`,
    `Page: ${page}`,
    `Textboxes: ${items.length}`,
    '',
  ];

  items.forEach(item => {
    lines.push(`#${item.numInPage} ${item.uuid}`);
    lines.push(`Text: ${item.text}`);
    lines.push(
      `Rect: left=${item.rect.left}, top=${item.rect.top}, right=${item.rect.right}, bottom=${item.rect.bottom}, width=${item.width}, height=${item.height}`,
    );
    lines.push(
      `Font: size=${item.fontSize}, path=${item.fontPath || '(default)'}, align=${item.textAlign}, bold=${item.textBold}, italics=${item.textItalics}`,
    );
    lines.push(
      `Frame: widthType=${item.textFrameWidthType}, style=${item.textFrameStyle}, editable=${item.textEditable}`,
    );
    lines.push(`Text metrics: length=${item.textLength}, words=${item.wordCount}, newlines=${item.newlineCount}`);
    lines.push('');
  });

  return lines.join('\n').slice(0, CLIPBOARD_PREVIEW_LIMIT);
}

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

/**
 * Writes a JSON file into EXPORT through a temporary file in the app's document folder (the host
 * only lets plugins copy into EXPORT). Used by "Save Diagnostics" in the edit-marker review.
 */
export async function writeJsonExportFile(fileName: string, payload: unknown): Promise<string> {
  const exportDir = await FileUtils.getExportPath();
  await FileUtils.makeDir(exportDir);

  const tempPath = `${RNFS.DocumentDirectoryPath}/${fileName}`;
  const exportPath = `${exportDir}/${fileName}`;

  await RNFS.writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf8');
  const copied = await FileUtils.copyFile(tempPath, exportPath);
  if (!copied) {
    throw new Error('Could not copy the JSON export into EXPORT.');
  }

  return exportPath;
}
