import {Clipboard} from 'react-native';
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
  estimateTextboxHeightFallback,
  measureTextLayout as measureSharedTextLayout,
  type NativeTextMeasurement,
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

export type TextboxActionKind = 'split' | 'join' | 'clean' | 'unwrap';

export type TextboxActionAvailability = Record<TextboxActionKind, boolean>;

export type TextboxActionPreview = {
  selectedCount: number;
  beforeBlocks: string[];
  afterBlocks: string[];
  availableActions: TextboxActionAvailability;
  selectionMessage: string;
  hasOnlyTextboxes: boolean;
};

export type TextboxLabResult = {
  message: string;
  insertedCount: number;
};

export type TextboxActionResult = {
  message: string;
  backupPath: string;
  clipboardSummary: string;
  insertedCount: number;
  selectedCount: number;
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

type LabInsertPlan = {
  label: string;
  requestedHeight: number;
  steppingHeight: number;
  probeRect: Rect;
  insert: PreparedTextInsert;
};

type LabPagePlan = {
  relativePageIndex: number;
  inserts: LabInsertPlan[];
};

type LabInsertSummary = {
  attemptedCount: number;
  insertedCount: number;
  failures: Array<{
    label: string;
    requestedHeight: number;
    rect: Rect;
    page: number;
    error: string;
  }>;
};

type LabRunState = {
  notePath: string;
  sourcePage: number;
  pages: number[];
  labels: string[];
  runKind: 'variants' | 'edge';
};

type ExportedTextboxScanItem = {
  page: number;
  uuid: string;
  numInPage: number;
  layerNum: number;
  rect: Rect;
  width: number;
  height: number;
  fontSize: number;
  fontPath: string | null;
  textFrameWidthType: number;
  textFrameStyle: number;
  textAlign: number;
  textLength: number;
  newlineCount: number;
  wordCount: number;
  textPreview: string;
  nativeMeasurement: null | {
    layoutHeight: number;
    lineCount: number;
    maxLineWidth: number;
  };
  heightDeltaFromNative: number | null;
  heightRatioToNative: number | null;
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
const MIN_BOX_HEIGHT = 48;
const MIN_TEXTBOX_WIDTH = 80;
const TEXTBOX_GAP = 16;
const DEFAULT_FONT_SIZE = 32;
const CLIPBOARD_PREVIEW_LIMIT = 3000;
const LAB_VARIANT_GAP = 20;
const LAB_EDGE_STEP_MIN_HEIGHT = 56;
const LAB_BLANK_TEMPLATE = 'style_white';
const LAB_TEMPLATE_CANDIDATES = ['style_white', 'style_blank'];
const LAB_PAGE_TOP = 48;
const LAB_PAGE_BOTTOM_MARGIN = 72;
const LAB_MOVE_DELTA_X = -3;
const LAB_MOVE_DELTA_Y = 96;
const LAB_EXPORT_FILE_PREFIX = 'textboxhelper-textbox-scan';
export const TEXTBOX_ACTION_CANCELLED_MESSAGE = 'Action cancelled.';

let lastLabRunState: LabRunState | null = null;

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

function buildTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function logTextboxLab(message: string, payload?: unknown): void {
  if (payload === undefined) {
    console.log(`[TextboxLab] ${message}`);
    return;
  }

  try {
    console.log(`[TextboxLab] ${message}`, JSON.stringify(payload));
  } catch {
    console.log(`[TextboxLab] ${message}`, String(payload));
  }
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

async function measureTextLayout(
  text: string,
  width: number,
  fontSize: number,
  fontPath?: string,
): Promise<NativeTextMeasurement | null> {
  try {
    return await measureSharedTextLayout(
      text,
      width,
      fontSize,
      fontPath,
      DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION,
    );
  } catch (error) {
    console.log(
      '[TextboxLab] nativeMeasurementError',
      JSON.stringify({
        width,
        fontSize,
        fontPath: fontPath || null,
        textPreview: text.slice(0, 80),
        error: String(error),
      }),
    );
    return null;
  }
}

function clearNativeElementCache(): void {
  try {
    PluginCommAPI.clearElementCache();
  } catch (error) {
    logTextboxLab('clearElementCacheError', {error: String(error)});
  }
}

async function logLabMeasurements(
  logLabel: string,
  source: TextElement,
  plans: LabInsertPlan[],
): Promise<void> {
  const sourceTextBox = source.textBox;
  const sourceWidth = rectWidth(sourceTextBox.textRect);
  const sourceFontSize = sourceTextBox.fontSize || DEFAULT_FONT_SIZE;
  const sourceText = sourceTextBox.textContentFull || '';

  const sourceMeasurement = await measureTextLayout(
    sourceText,
    sourceWidth,
    sourceFontSize,
    sourceTextBox.fontPath || undefined,
  );

  const plannedMeasurements = await Promise.all(
    plans.map(async plan => {
      const width = rectWidth(plan.insert.textRect);
      const measurement = await measureTextLayout(
        plan.insert.textContentFull,
        width,
        plan.insert.fontSize,
        plan.insert.fontPath,
      );

      return {
        label: plan.label,
        requestedHeight: plan.requestedHeight,
        steppingHeight: plan.steppingHeight,
        rect: plan.insert.textRect,
        frameWidthType: plan.insert.textFrameWidthType,
        textPreview: plan.insert.textContentFull.slice(0, 80),
        nativeMeasurement: measurement
          ? {
              layoutHeight: measurement.layoutHeight,
              lineCount: measurement.lineCount,
              maxLineWidth: measurement.maxLineWidth,
              heightDelta: plan.requestedHeight - measurement.layoutHeight,
            }
          : null,
      };
    }),
  );

  console.log(
    '[TextboxLab] nativeMeasurements',
    JSON.stringify({
      label: logLabel,
      sourceUuid: source.uuid,
      sourceRect: sourceTextBox.textRect,
      sourceFontSize,
      sourceMeasurement: sourceMeasurement
        ? {
            layoutHeight: sourceMeasurement.layoutHeight,
            lineCount: sourceMeasurement.lineCount,
            maxLineWidth: sourceMeasurement.maxLineWidth,
          }
        : null,
      plannedMeasurements,
    }),
  );
}

async function saveCurrentNoteForFileOps(): Promise<void> {
  const response = await PluginNoteAPI.saveCurrentNote();
  assertApiSuccess(
    response as {success?: boolean; error?: {message?: string}},
    'Could not save the current note before file operations.',
  );
}

async function resolveLabBlankTemplate(): Promise<string> {
  const rawTemplates = await PluginCommAPI.getNoteSystemTemplates();
  const templates = Array.isArray(rawTemplates) ? rawTemplates : [];
  const templateNames = templates
    .map(template =>
      template && typeof template === 'object' && 'name' in template
        ? String((template as {name?: unknown}).name || '')
        : '',
    )
    .filter(Boolean);

  for (const candidate of LAB_TEMPLATE_CANDIDATES) {
    if (templateNames.includes(candidate)) {
      console.log(
        '[TextboxLab] resolvedBlankTemplate',
        JSON.stringify({
          chosenTemplate: candidate,
          availableTemplates: templateNames,
        }),
      );
      return candidate;
    }
  }

  console.log(
    '[TextboxLab] resolvedBlankTemplate',
    JSON.stringify({
      chosenTemplate: LAB_BLANK_TEMPLATE,
      availableTemplates: templateNames,
      fallback: true,
    }),
  );
  return LAB_BLANK_TEMPLATE;
}

function createRectWithHeight(baseRect: Rect, top: number, height: number): Rect {
  return {
    left: baseRect.left,
    top,
    right: baseRect.right,
    bottom: top + height,
  };
}

function paginateLabPlans(
  source: TextElement,
  plans: LabInsertPlan[],
  pageHeight: number,
): LabPagePlan[] {
  const sourceRect = cloneRect(source.textBox.textRect);
  const pageBottomLimit = Math.max(LAB_PAGE_TOP + MIN_BOX_HEIGHT, pageHeight - LAB_PAGE_BOTTOM_MARGIN);
  const pagePlans: LabPagePlan[] = [];
  let relativePageIndex = 0;
  let top = LAB_PAGE_TOP;
  let currentPagePlans: LabInsertPlan[] = [];

  const pushCurrentPage = () => {
    if (currentPagePlans.length === 0) {
      return;
    }

    pagePlans.push({
      relativePageIndex,
      inserts: currentPagePlans,
    });
    relativePageIndex += 1;
    currentPagePlans = [];
    top = LAB_PAGE_TOP;
  };

  for (const plan of plans) {
    const requiredBottom = top + plan.steppingHeight;
    if (requiredBottom > pageBottomLimit && currentPagePlans.length > 0) {
      pushCurrentPage();
    }

    const adjustedInsertRect = createRectWithHeight(
      sourceRect,
      top,
      plan.requestedHeight,
    );
    const adjustedProbeRect = createRectWithHeight(
      sourceRect,
      top,
      plan.steppingHeight,
    );

    currentPagePlans.push({
      ...plan,
      probeRect: adjustedProbeRect,
      insert: {
        ...plan.insert,
        textRect: adjustedInsertRect,
      },
    });
    top = adjustedProbeRect.bottom + LAB_VARIANT_GAP;
  }

  pushCurrentPage();

  console.log(
    '[TextboxLab] pagedLabPlan',
    JSON.stringify({
      pageCount: pagePlans.length,
      pages: pagePlans.map(pagePlan => ({
        relativePageIndex: pagePlan.relativePageIndex,
        labels: pagePlan.inserts.map(insert => insert.label),
        rects: pagePlan.inserts.map(insert => ({
          label: insert.label,
          rect: insert.insert.textRect,
          probeRect: insert.probeRect,
        })),
      })),
    }),
  );

  return pagePlans;
}

async function insertBlankLabPages(
  notePath: string,
  afterPage: number,
  pageCount: number,
): Promise<number[]> {
  if (pageCount <= 0) {
    return [];
  }

  await saveCurrentNoteForFileOps();
  const templateName = await resolveLabBlankTemplate();

  const createdPages: number[] = [];
  let insertionAnchor = afterPage;

  for (let index = 0; index < pageCount; index += 1) {
    const insertResponse = await PluginFileAPI.insertNotePage({
      notePath,
      page: insertionAnchor,
      template: templateName,
    });
    assertApiSuccess(
      insertResponse as {success?: boolean; error?: {message?: string}},
      'Could not create a blank lab page.',
    );
    const newPage = insertionAnchor + 1;
    createdPages.push(newPage);
    insertionAnchor = newPage;
  }

  console.log(
    '[TextboxLab] createdLabPages',
    JSON.stringify({
      notePath,
      afterPage,
      pageCount,
      createdPages,
      template: templateName,
    }),
  );

  return createdPages;
}

async function createTextElementForPage(
  pageNumber: number,
  insert: PreparedTextInsert,
): Promise<Element> {
  const created = await PluginCommAPI.createElement(TEXT_TYPE_NORMAL);
  const element = assertApiSuccess(
    created as {success?: boolean; result?: Element; error?: {message?: string}},
    'Failed to create a text element for the lab page.',
  );
  const textBox = element.textBox ?? new TextBox();

  element.pageNum = pageNumber;
  element.layerNum = MAIN_LAYER;
  textBox.fontSize = insert.fontSize;
  textBox.fontPath = insert.fontPath || null;
  textBox.textContentFull = insert.textContentFull;
  textBox.textRect = cloneRect(insert.textRect);
  textBox.textAlign = insert.textAlign;
  textBox.textBold = insert.textBold;
  textBox.textItalics = insert.textItalics;
  textBox.textFrameWidthType = insert.textFrameWidthType;
  textBox.textFrameStyle = insert.textFrameStyle;
  textBox.textEditable = insert.textEditable;
  textBox.textDigestData = null;
  element.textBox = textBox;

  return element;
}

async function insertLabPlansIntoPages(
  notePath: string,
  pagePlans: LabPagePlan[],
  createdPages: number[],
): Promise<LabInsertSummary> {
  await saveCurrentNoteForFileOps();

  const failures: LabInsertSummary['failures'] = [];
  let insertedCount = 0;

  for (const pagePlan of pagePlans) {
    const targetPage = createdPages[pagePlan.relativePageIndex];

    for (const plan of pagePlan.inserts) {
      let element: Element | null = null;

      try {
        element = await createTextElementForPage(targetPage, plan.insert);
        const response = await PluginFileAPI.insertElements(notePath, targetPage, [element]);
        assertApiSuccess(
          response as {success?: boolean; error?: {message?: string}},
          'insertElements failed for a lab textbox.',
        );
        insertedCount += 1;
        console.log(
          '[TextboxLab] insertAttemptSuccess',
          JSON.stringify({
            label: plan.label,
            requestedHeight: plan.requestedHeight,
            rect: plan.insert.textRect,
            page: targetPage,
          }),
        );
      } catch (error) {
        const failure = {
          label: plan.label,
          requestedHeight: plan.requestedHeight,
          rect: cloneRect(plan.insert.textRect),
          page: targetPage,
          error: String(error),
        };
        failures.push(failure);
        console.log('[TextboxLab] insertAttemptFailure', JSON.stringify(failure));
      } finally {
        if (element) {
          await recycleElements([element]);
        }
      }
    }
  }

  return {
    attemptedCount: pagePlans.reduce((sum, pagePlan) => sum + pagePlan.inserts.length, 0),
    insertedCount,
    failures,
  };
}

async function readPageElementsForLog(notePath: string, page: number): Promise<Element[]> {
  return assertApiSuccess(
    (await PluginFileAPI.getElements(page, notePath)) as {
      success?: boolean;
      result?: Element[];
      error?: {message?: string};
    },
    `Could not read page ${page} elements.`,
  );
}

async function logPagesTextboxDump(
  logLabel: string,
  notePath: string,
  pages: number[],
  extra?: Record<string, unknown>,
): Promise<void> {
  const dumpPages: Array<{
    page: number;
    textboxCount: number;
    textboxes: ReturnType<typeof getPageTextboxesForLog>;
  }> = [];

  for (const page of pages) {
    const pageElements = await readPageElementsForLog(notePath, page);
    try {
      const textboxes = getPageTextboxesForLog(pageElements);
      dumpPages.push({
        page,
        textboxCount: textboxes.length,
        textboxes,
      });
    } finally {
      await recycleElements(pageElements);
    }
  }

  console.log(
    logLabel,
    JSON.stringify({
      notePath,
      pages: dumpPages,
      ...(extra || {}),
    }),
  );
}

function rememberLabRun(
  notePath: string,
  sourcePage: number,
  createdPages: number[],
  plans: LabInsertPlan[],
  runKind: LabRunState['runKind'],
): void {
  lastLabRunState = {
    notePath,
    sourcePage,
    pages: createdPages,
    labels: plans.map(plan => plan.label),
    runKind,
  };
}

function findLabTextboxesOnPage(
  elements: Element[],
  labels: string[],
): TextElement[] {
  const labelPrefixes = labels.map(label => `${label}:`);
  return sortTextElements(
    elements
      .filter(isNormalTextElement)
      .filter(element =>
        labelPrefixes.some(prefix =>
          (element.textBox.textContentFull || '').startsWith(prefix),
        ),
      ),
  );
}

function translateRectWithinPage(
  rect: Rect,
  deltaX: number,
  deltaY: number,
  pageWidth: number,
  pageHeight: number,
): Rect {
  const width = rectWidth(rect);
  const height = rectHeight(rect);
  const nextLeft = Math.max(0, Math.min(rect.left + deltaX, pageWidth - width));
  const nextTop = Math.max(0, Math.min(rect.top + deltaY, pageHeight - height));

  return {
    left: nextLeft,
    top: nextTop,
    right: nextLeft + width,
    bottom: nextTop + height,
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
  const backupDir = `${pluginDir}\\textbox-action-backups`;
  await RNFS.mkdir(backupDir);

  const safeTimestamp = payload.createdAt.replace(/[:.]/g, '-');
  const backupPath = `${backupDir}\\${payload.action}-${safeTimestamp}.json`;
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
  availableActions: TextboxActionAvailability;
} {
  const sortedTextElements = sortTextElements(textElements);
  const beforeBlocks = sortedTextElements.map(getTextboxText);
  const availableActions = createEmptyAvailability();

  let splitBlocks: string[] = [];
  let joinBlocks: string[] = [];
  let cleanBlocks: string[] = [];
  let unwrapBlocks: string[] = [];

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

async function insertTextBoxes(inserts: PreparedTextInsert[]): Promise<void> {
  for (const insert of inserts) {
    const response = await PluginNoteAPI.insertText(insert);
    assertApiSuccess(response as {success?: boolean; error?: {message?: string}}, 'insertText failed');
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

  try {
    const lassoResponse = await PluginCommAPI.getLassoElements();
    lassoElements = assertApiSuccess(
      lassoResponse as {success?: boolean; result?: Element[]; error?: {message?: string}},
      'Could not read the current lasso selection.',
    );

    return buildActionPreview(lassoElements, action);
  } finally {
    await recycleElements(lassoElements);
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

export async function performTextboxAction(
  action: TextboxActionKind,
  options?: TextboxActionExecutionOptions,
): Promise<TextboxActionResult> {
  let lassoElements: Element[] = [];
  let pageElements: Element[] = [];

  try {
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
    const inserts =
      action === 'split'
        ? await buildSplitInserts(textElements[0])
        : [await buildJoinInsert(textElements)];
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

    await insertTextBoxes(inserts);

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

// Archived Textbox Lab implementation.
// Retired from the toolbar and app UI, but intentionally kept here for future investigation work.
function createLabVariantPlans(source: TextElement): LabInsertPlan[] {
  const sourceTextBox = source.textBox;
  const sourceRect = cloneRect(sourceTextBox.textRect);
  const sourceText = sourceTextBox.textContentFull || '';
  const fontSize = sourceTextBox.fontSize || DEFAULT_FONT_SIZE;
  const width = rectWidth(sourceRect);
  const estimatedHeight = estimateTextboxHeightFallback(sourceText, width, fontSize);
  const runStamp = String(Date.now()).slice(-5);

  const variants = [
    {label: `L${runStamp}-01 h75 f0`, factor: 0.75, frameWidthType: 0},
    {label: `L${runStamp}-02 h90 f0`, factor: 0.9, frameWidthType: 0},
    {label: `L${runStamp}-03 h100 f0`, factor: 1, frameWidthType: 0},
    {label: `L${runStamp}-04 h115 f0`, factor: 1.15, frameWidthType: 0},
    {label: `L${runStamp}-05 h135 f0`, factor: 1.35, frameWidthType: 0},
    {label: `L${runStamp}-06 h100 f1`, factor: 1, frameWidthType: 1},
  ];

  const plans: LabInsertPlan[] = [];
  let top = sourceRect.bottom + LAB_VARIANT_GAP;

  for (const variant of variants) {
    const variantHeight = Math.max(MIN_BOX_HEIGHT, Math.round(estimatedHeight * variant.factor));
    const prefixedText = `${variant.label}: ${sourceText}`;
    const textRect: Rect = {
      left: sourceRect.left,
      top,
      right: sourceRect.right,
      bottom: top + variantHeight,
    };

    plans.push({
      label: variant.label,
      requestedHeight: variantHeight,
      steppingHeight: variantHeight,
      probeRect: cloneRect(textRect),
      insert: {
        ...buildTextInsert(sourceTextBox, prefixedText, textRect),
        textFrameWidthType: variant.frameWidthType,
      },
    });
    top = textRect.bottom + LAB_VARIANT_GAP;
  }

  console.log(
    '[TextboxLab] plannedVariants',
    JSON.stringify({
      sourceUuid: source.uuid,
      sourceRect,
      estimatedHeight,
      width,
      fontSize,
      variants: plans.map(plan => ({
        label: plan.label,
        text: plan.insert.textContentFull.slice(0, 48),
        rect: plan.insert.textRect,
        frameWidthType: plan.insert.textFrameWidthType,
        requestedHeight: plan.requestedHeight,
      })),
    }),
  );

  return plans;
}

function createLabEdgeVariantPlans(source: TextElement): LabInsertPlan[] {
  const sourceTextBox = source.textBox;
  const sourceRect = cloneRect(sourceTextBox.textRect);
  const sourceText = sourceTextBox.textContentFull || '';
  const fontSize = sourceTextBox.fontSize || DEFAULT_FONT_SIZE;
  const width = rectWidth(sourceRect);
  const estimatedHeight = estimateTextboxHeightFallback(sourceText, width, fontSize);
  const runStamp = String(Date.now()).slice(-5);

  const variants = [
    {label: `E${runStamp}-01 h-1`, requestedHeight: -1, frameWidthType: 0},
    {label: `E${runStamp}-02 h0`, requestedHeight: 0, frameWidthType: 0},
    {label: `E${runStamp}-03 h1`, requestedHeight: 1, frameWidthType: 0},
    {label: `E${runStamp}-04 h2`, requestedHeight: 2, frameWidthType: 0},
    {label: `E${runStamp}-05 h8`, requestedHeight: 8, frameWidthType: 0},
    {label: `E${runStamp}-06 h24`, requestedHeight: 24, frameWidthType: 0},
    {label: `E${runStamp}-07 h36`, requestedHeight: 36, frameWidthType: 0},
    {label: `E${runStamp}-08 h48`, requestedHeight: 48, frameWidthType: 0},
  ];

  const plans: LabInsertPlan[] = [];
  let top = sourceRect.bottom + LAB_VARIANT_GAP;

  for (const variant of variants) {
    const probeHeight = Math.max(
      LAB_EDGE_STEP_MIN_HEIGHT,
      Math.abs(variant.requestedHeight),
      Math.ceil(fontSize * 1.25),
    );
    const prefixedText = `${variant.label}: ${sourceText}`;
    const textRect: Rect = {
      left: sourceRect.left,
      top,
      right: sourceRect.right,
      bottom: top + variant.requestedHeight,
    };
    const probeRect: Rect = {
      left: sourceRect.left,
      top,
      right: sourceRect.right,
      bottom: top + probeHeight,
    };

    plans.push({
      label: variant.label,
      requestedHeight: variant.requestedHeight,
      steppingHeight: probeHeight,
      probeRect,
      insert: {
        ...buildTextInsert(sourceTextBox, prefixedText, textRect),
        textFrameWidthType: variant.frameWidthType,
      },
    });

    top = probeRect.bottom + LAB_VARIANT_GAP;
  }

  console.log(
    '[TextboxLab] plannedEdgeVariants',
    JSON.stringify({
      sourceUuid: source.uuid,
      sourceRect,
      estimatedHeight,
      width,
      fontSize,
      variants: plans.map(plan => ({
        label: plan.label,
        requestedHeight: plan.requestedHeight,
        steppingHeight: plan.steppingHeight,
        rect: plan.insert.textRect,
        probeRect: plan.probeRect,
      })),
    }),
  );

  return plans;
}

function getPageTextboxesForLog(pageElements: Element[]): Array<{
  uuid: string;
  numInPage: number;
  layerNum: number;
  rect: Rect;
  fontSize: number;
  textFrameWidthType: number;
  textAlign: number;
  textLength: number;
  textPreview: string;
}> {
  return sortTextElements(pageElements.filter(isNormalTextElement)).map(element => ({
    uuid: element.uuid,
    numInPage: element.numInPage,
    layerNum: element.layerNum,
    rect: cloneRect(element.textBox.textRect),
    fontSize: element.textBox.fontSize || DEFAULT_FONT_SIZE,
    textFrameWidthType: element.textBox.textFrameWidthType ?? 0,
    textAlign: element.textBox.textAlign ?? 0,
    textLength: (element.textBox.textContentFull || '').length,
    textPreview: (element.textBox.textContentFull || '').slice(0, 160),
  }));
}

function getQuantile(sortedValues: number[], quantile: number): number | null {
  if (sortedValues.length === 0) {
    return null;
  }

  if (sortedValues.length === 1) {
    return sortedValues[0];
  }

  const index = (sortedValues.length - 1) * quantile;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const weight = index - lowerIndex;

  if (lowerIndex === upperIndex) {
    return sortedValues[lowerIndex];
  }

  return (
    sortedValues[lowerIndex] * (1 - weight) + sortedValues[upperIndex] * weight
  );
}

function summarizeNumericSeries(values: number[]): {
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  p75: number | null;
  p90: number | null;
} {
  if (values.length === 0) {
    return {
      count: 0,
      min: null,
      max: null,
      mean: null,
      median: null,
      p75: null,
      p90: null,
    };
  }

  const sorted = [...values].sort((left, right) => left - right);
  const sum = sorted.reduce((total, value) => total + value, 0);

  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
    median: getQuantile(sorted, 0.5),
    p75: getQuantile(sorted, 0.75),
    p90: getQuantile(sorted, 0.9),
  };
}

function groupScanItemsByFontSize(items: ExportedTextboxScanItem[]): Array<{
  fontSize: number;
  count: number;
  heightStats: ReturnType<typeof summarizeNumericSeries>;
  nativeHeightStats: ReturnType<typeof summarizeNumericSeries>;
  deltaStats: ReturnType<typeof summarizeNumericSeries>;
  ratioStats: ReturnType<typeof summarizeNumericSeries>;
}> {
  const buckets = new Map<number, ExportedTextboxScanItem[]>();

  for (const item of items) {
    const bucket = buckets.get(item.fontSize) || [];
    bucket.push(item);
    buckets.set(item.fontSize, bucket);
  }

  return [...buckets.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([fontSize, bucket]) => ({
      fontSize,
      count: bucket.length,
      heightStats: summarizeNumericSeries(bucket.map(item => item.height)),
      nativeHeightStats: summarizeNumericSeries(
        bucket
          .map(item => item.nativeMeasurement?.layoutHeight ?? null)
          .filter((value): value is number => value !== null),
      ),
      deltaStats: summarizeNumericSeries(
        bucket
          .map(item => item.heightDeltaFromNative)
          .filter((value): value is number => value !== null),
      ),
      ratioStats: summarizeNumericSeries(
        bucket
          .map(item => item.heightRatioToNative)
          .filter((value): value is number => value !== null),
      ),
    }));
}

async function writeJsonExportFile(fileName: string, payload: unknown): Promise<string> {
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

async function scanTextboxPages(
  notePath: string,
  pages: number[],
): Promise<ExportedTextboxScanItem[]> {
  const items: ExportedTextboxScanItem[] = [];

  for (const page of pages) {
    logTextboxLab('scanProgress', {
      phase: 'page-start',
      notePath,
      page,
      processedPages: items.length,
    });

    const elementNums = assertApiSuccess(
      (await PluginFileAPI.getElementNumList(notePath, page)) as {
        success?: boolean;
        result?: number[];
        error?: {message?: string};
      },
      `Could not read element numbers for page ${page}.`,
    );

    logTextboxLab('scanProgress', {
      phase: 'page-element-nums',
      page,
      textboxCandidates: elementNums.length,
    });

    for (const numInPage of elementNums) {
      let element: Element | null = null;

      try {
        element = assertApiSuccess(
          (await PluginFileAPI.getElement(notePath, page, numInPage)) as {
            success?: boolean;
            result?: Element;
            error?: {message?: string};
          },
          `Could not read textbox ${numInPage} on page ${page}.`,
        );

        if (!isNormalTextElement(element)) {
          continue;
        }

        const textBox = element.textBox;
        const text = textBox.textContentFull || '';
        const width = rectWidth(textBox.textRect);
        const height = rectHeight(textBox.textRect);
        const fontSize = textBox.fontSize || DEFAULT_FONT_SIZE;
        const nativeMeasurement = await measureTextLayout(
          text,
          width,
          fontSize,
          textBox.fontPath || undefined,
        );
        const nativeHeight = nativeMeasurement?.layoutHeight ?? null;

        items.push({
          page,
          uuid: element.uuid,
          numInPage: element.numInPage,
          layerNum: element.layerNum,
          rect: cloneRect(textBox.textRect),
          width,
          height,
          fontSize,
          fontPath: textBox.fontPath || null,
          textFrameWidthType: textBox.textFrameWidthType ?? 0,
          textFrameStyle: textBox.textFrameStyle ?? 0,
          textAlign: textBox.textAlign ?? 0,
          textLength: text.length,
          newlineCount: (text.match(/\n/g) || []).length,
          wordCount: countWords(text),
          textPreview: text.slice(0, 160),
          nativeMeasurement: nativeMeasurement
            ? {
                layoutHeight: nativeMeasurement.layoutHeight,
                lineCount: nativeMeasurement.lineCount,
                maxLineWidth: nativeMeasurement.maxLineWidth,
              }
            : null,
          heightDeltaFromNative:
            nativeHeight === null ? null : height - nativeHeight,
          heightRatioToNative:
            nativeHeight === null || nativeHeight <= 0 ? null : height / nativeHeight,
        });
      } finally {
        if (element) {
          await recycleElements([element]);
        }
        clearNativeElementCache();
      }
    }

    logTextboxLab('scanProgress', {
      phase: 'page-complete',
      page,
      textboxCount: items.filter(item => item.page === page).length,
      accumulatedTextboxes: items.length,
    });
    clearNativeElementCache();
  }

  return items;
}

async function exportTextboxScanForPages(
  mode: 'current-page' | 'whole-note' | 'page-range',
  pages: number[],
): Promise<TextboxLabResult> {
  const notePath = assertApiSuccess(
    (await PluginCommAPI.getCurrentFilePath()) as {
      success?: boolean;
      result?: string;
      error?: {message?: string};
    },
    'Could not determine the current note path.',
  );

  const items = await scanTextboxPages(notePath, pages);
  const payload = {
    createdAt: new Date().toISOString(),
    notePath,
    mode,
    pages,
    scannedPages: pages.length,
    textboxCount: items.length,
    summary: {
      distinctFontPaths: [...new Set(items.map(item => item.fontPath).filter(Boolean))].sort(),
      fontSizes: [...new Set(items.map(item => item.fontSize))].sort((a, b) => a - b),
      widthStats: summarizeNumericSeries(items.map(item => item.width)),
      heightStats: summarizeNumericSeries(items.map(item => item.height)),
      textLengthStats: summarizeNumericSeries(items.map(item => item.textLength)),
      wordCountStats: summarizeNumericSeries(items.map(item => item.wordCount)),
      nativeHeightStats: summarizeNumericSeries(
        items
          .map(item => item.nativeMeasurement?.layoutHeight ?? null)
          .filter((value): value is number => value !== null),
      ),
      heightDeltaStats: summarizeNumericSeries(
        items
          .map(item => item.heightDeltaFromNative)
          .filter((value): value is number => value !== null),
      ),
      heightRatioStats: summarizeNumericSeries(
        items
          .map(item => item.heightRatioToNative)
          .filter((value): value is number => value !== null),
      ),
      byFontSize: groupScanItemsByFontSize(items),
    },
    items,
  };

  const fileName = `${LAB_EXPORT_FILE_PREFIX}-${mode}-${buildTimestamp()}.json`;
  const exportPath = await writeJsonExportFile(fileName, payload);

  logTextboxLab('textboxScanExport', {
    mode,
    notePath,
    pages,
    textboxCount: items.length,
    exportPath,
    fileName,
  });

  return {
    message: `Scanned ${items.length} textboxes across ${pages.length} page(s) and exported the JSON to ${exportPath}.`,
    insertedCount: 0,
  };
}

export async function logCurrentPageTextboxes(): Promise<TextboxLabResult> {
  let pageElements: Element[] = [];

  try {
    const notePath = assertApiSuccess(
      (await PluginCommAPI.getCurrentFilePath()) as {
        success?: boolean;
        result?: string;
        error?: {message?: string};
      },
      'Could not determine the current note path.',
    );
    const page = assertApiSuccess(
      (await PluginCommAPI.getCurrentPageNum()) as {
        success?: boolean;
        result?: number;
        error?: {message?: string};
      },
      'Could not determine the current page.',
    );

    pageElements = assertApiSuccess(
      (await PluginFileAPI.getElements(page, notePath)) as {
        success?: boolean;
        result?: Element[];
        error?: {message?: string};
      },
      'Could not read page elements.',
    );

    const textboxes = getPageTextboxesForLog(pageElements);
    console.log(
      '[TextboxLab] pageTextboxDump',
      JSON.stringify({
        notePath,
        page,
        textboxCount: textboxes.length,
        textboxes,
      }),
    );

    return {
      message: `Logged ${textboxes.length} textboxes from the current page.`,
      insertedCount: 0,
    };
  } finally {
    await recycleElements(pageElements);
  }
}

export async function exportWholeNoteTextboxScan(): Promise<TextboxLabResult> {
  const totalPages = assertApiSuccess(
    (await PluginFileAPI.getNoteTotalPageNum(
      assertApiSuccess(
        (await PluginCommAPI.getCurrentFilePath()) as {
          success?: boolean;
          result?: string;
          error?: {message?: string};
        },
        'Could not determine the current note path.',
      ),
    )) as {
      success?: boolean;
      result?: number;
      error?: {message?: string};
    },
    'Could not determine the total page count.',
  );
  return exportTextboxScanForPages(
    'whole-note',
    Array.from({length: totalPages}, (_, index) => index),
  );
}

export async function exportCurrentPageTextboxScan(): Promise<TextboxLabResult> {
  const page = assertApiSuccess(
    (await PluginCommAPI.getCurrentPageNum()) as {
      success?: boolean;
      result?: number;
      error?: {message?: string};
    },
    'Could not determine the current page.',
  );

  return exportTextboxScanForPages('current-page', [page]);
}

export async function generateTextboxLabVariants(): Promise<TextboxLabResult> {
  let lassoElements: Element[] = [];
  let pageElements: Element[] = [];

  try {
    const context = await getPageContext();
    lassoElements = context.lassoElements;
    pageElements = context.pageElements;

    if (lassoElements.length === 0) {
      throw new Error('Select exactly one source textbox first.');
    }

    const textElements = lassoElements.filter(isNormalTextElement);
    if (textElements.length !== lassoElements.length) {
      throw new Error('Textbox Lab only supports normal main-layer textboxes.');
    }

    if (textElements.length !== 1) {
      throw new Error('Textbox Lab currently requires exactly one selected source textbox.');
    }

    const plans = createLabVariantPlans(textElements[0]);
    const pagePlans = paginateLabPlans(textElements[0], plans, context.pageHeight);
    await logLabMeasurements('plannedVariantMeasurements', textElements[0], plans);
    const createdPages = await insertBlankLabPages(
      context.notePath,
      context.page,
      pagePlans.length,
    );
    const insertSummary = await insertLabPlansIntoPages(
      context.notePath,
      pagePlans,
      createdPages,
    );
    rememberLabRun(context.notePath, context.page, createdPages, plans, 'variants');

    await logPagesTextboxDump(
      '[TextboxLab] afterPagedInsertTextboxDump',
      context.notePath,
      createdPages,
      {
        sourcePage: context.page,
        insertedCount: insertSummary.insertedCount,
        attemptedCount: insertSummary.attemptedCount,
        failures: insertSummary.failures,
      },
    );

    return {
      message: `Created ${createdPages.length} blank lab page(s), inserted ${insertSummary.insertedCount} textbox variants, and logged the lab pages.`,
      insertedCount: insertSummary.insertedCount,
    };
  } finally {
    await recycleElements(lassoElements);
    await recycleElements(pageElements);
  }
}

export async function generateTextboxLabEdgeVariants(): Promise<TextboxLabResult> {
  let lassoElements: Element[] = [];
  let pageElements: Element[] = [];

  try {
    const context = await getPageContext();
    lassoElements = context.lassoElements;
    pageElements = context.pageElements;

    if (lassoElements.length === 0) {
      throw new Error('Select exactly one source textbox first.');
    }

    const textElements = lassoElements.filter(isNormalTextElement);
    if (textElements.length !== lassoElements.length) {
      throw new Error('Textbox Lab only supports normal main-layer textboxes.');
    }

    if (textElements.length !== 1) {
      throw new Error('Textbox Lab edge experiments require exactly one selected source textbox.');
    }

    const plans = createLabEdgeVariantPlans(textElements[0]);
    const pagePlans = paginateLabPlans(textElements[0], plans, context.pageHeight);
    await logLabMeasurements('plannedEdgeMeasurements', textElements[0], plans);
    const createdPages = await insertBlankLabPages(
      context.notePath,
      context.page,
      pagePlans.length,
    );
    const insertSummary = await insertLabPlansIntoPages(
      context.notePath,
      pagePlans,
      createdPages,
    );
    rememberLabRun(context.notePath, context.page, createdPages, plans, 'edge');

    await logPagesTextboxDump(
      '[TextboxLab] afterEdgeInsertTextboxDump',
      context.notePath,
      createdPages,
      {
        sourcePage: context.page,
        attemptedCount: insertSummary.attemptedCount,
        insertedCount: insertSummary.insertedCount,
        failures: insertSummary.failures,
      },
    );

    return {
      message: `Created ${createdPages.length} blank lab page(s), attempted ${insertSummary.attemptedCount} edge-case variants, and inserted ${insertSummary.insertedCount}.`,
      insertedCount: insertSummary.insertedCount,
    };
  } finally {
    await recycleElements(lassoElements);
    await recycleElements(pageElements);
  }
}

export async function moveLatestTextboxLabVariants(): Promise<TextboxLabResult> {
  if (!lastLabRunState) {
    throw new Error('No recent Textbox Lab run is available to move yet.');
  }

  await saveCurrentNoteForFileOps();
  await logPagesTextboxDump(
    '[TextboxLab] beforeMoveTextboxDump',
    lastLabRunState.notePath,
    lastLabRunState.pages,
    {
      sourcePage: lastLabRunState.sourcePage,
      runKind: lastLabRunState.runKind,
      labels: lastLabRunState.labels,
    },
  );

  let movedCount = 0;

  for (const page of lastLabRunState.pages) {
    const pageSize = assertApiSuccess(
      (await PluginFileAPI.getPageSize(lastLabRunState.notePath, page)) as {
        success?: boolean;
        result?: {width: number; height: number};
        error?: {message?: string};
      },
      `Could not read page size for lab page ${page}.`,
    );
    const pageElements = await readPageElementsForLog(lastLabRunState.notePath, page);

    try {
      const matchingTextboxes = findLabTextboxesOnPage(pageElements, lastLabRunState.labels);
      if (matchingTextboxes.length === 0) {
        continue;
      }

      for (const textboxElement of matchingTextboxes) {
        textboxElement.textBox.textRect = translateRectWithinPage(
          textboxElement.textBox.textRect,
          LAB_MOVE_DELTA_X,
          LAB_MOVE_DELTA_Y,
          pageSize.width,
          pageSize.height,
        );
      }

      console.log(
        '[TextboxLab] moveVariantPlan',
        JSON.stringify({
          page,
          moveDelta: {x: LAB_MOVE_DELTA_X, y: LAB_MOVE_DELTA_Y},
          labels: matchingTextboxes.map(element =>
            (element.textBox.textContentFull || '').slice(0, 32),
          ),
          targetRects: matchingTextboxes.map(element => ({
            uuid: element.uuid,
            rect: element.textBox.textRect,
          })),
        }),
      );

      const response = await PluginFileAPI.modifyElements(
        lastLabRunState.notePath,
        page,
        matchingTextboxes as unknown as Object[],
      );
      assertApiSuccess(
        response as {success?: boolean; error?: {message?: string}},
        `Could not move lab textboxes on page ${page}.`,
      );
      movedCount += matchingTextboxes.length;
    } finally {
      await recycleElements(pageElements);
    }
  }

  await logPagesTextboxDump(
    '[TextboxLab] afterMoveTextboxDump',
    lastLabRunState.notePath,
    lastLabRunState.pages,
    {
      sourcePage: lastLabRunState.sourcePage,
      movedCount,
      runKind: lastLabRunState.runKind,
    },
  );

  return {
    message: `Moved ${movedCount} lab textbox variants and logged the before/after page state.`,
    insertedCount: movedCount,
  };
}

