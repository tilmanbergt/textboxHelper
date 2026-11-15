import RNFS from 'react-native-fs';
import {PluginCommAPI, PluginFileAPI, type Element, type Rect} from 'sn-plugin-lib';
import {
  intersectionRect,
  rectHeight,
  rectWidth,
} from './domain/geometry';
import {paginateTextIntoTextboxPages} from './domain/textPagination';
import {
  paginateTextboxBlocksIntoPages,
  type TextboxBlockPage,
} from './domain/blockPagination';
import {
  parseTextboxImportBlocks,
  summarizeTextboxImportBlocks,
  type TextboxImportBlockSummary,
} from './domain/importParsing';
import {insertTextboxPages} from './supernote/noteTextInsertion';
import {appendFontWarning} from './domain/fontPaths';
import type {
  TextboxImportLayoutMode,
  TextboxImportParagraphSeparator,
  TextboxImportStructureSettings,
} from './domain/importSettings';
import {
  getFontWarning,
  measureTextboxHeight,
  resetFontWarnings,
} from './supernote/textboxMetrics';

export type TextboxImportSourceFolder = 'inbox' | 'myStyle';

export type TextboxImportInsertMode =
  | 'auto'
  | 'currentPage'
  | 'afterCurrentPage';

export type TextboxImportSettings = {
  sourceFolder: TextboxImportSourceFolder;
  filename: string;
  fontSize: number;
  structure: TextboxImportStructureSettings;
  marginLeft: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  insertMode: TextboxImportInsertMode;
};

export type TextboxImportProgressUpdate = {
  message: string;
};

export type TextboxImportExecutionOptions = {
  onProgress?: (update: TextboxImportProgressUpdate) => void;
};

export type TextboxImportResult = {
  message: string;
  sourcePath: string;
  createdPageCount: number;
  insertedTextboxCount: number;
  characterCount: number;
  wordCount: number;
  effectiveInsertMode: Exclude<TextboxImportInsertMode, 'auto'>;
};

export type TextboxImportPreview = {
  sourcePath: string;
  characterCount: number;
  wordCount: number;
  lineCount: number;
  paragraphCount: number;
  headingCount: number;
  h1Count: number;
  h2Count: number;
  h3Count: number;
  blockCount: number;
  layoutMode: TextboxImportLayoutMode;
  paragraphSeparator: TextboxImportParagraphSeparator;
  expectedTextboxCount: number;
  expectedCreatedPageCount: number;
  currentPageHasImportAreaContent: boolean;
  recommendedInsertMode: Exclude<TextboxImportInsertMode, 'auto'>;
  effectiveInsertMode: Exclude<TextboxImportInsertMode, 'auto'>;
  startPreview: string;
  endPreview: string;
};

type Size = {
  width: number;
  height: number;
};

type ApiResponse<T> = {
  success?: boolean;
  result?: T;
  error?: {message?: string};
};

type CurrentNoteContext = {
  notePath: string;
  currentPage: number;
  pageSize: Size;
  pageElements: Element[];
};

type PlannedTextboxChunk = {
  text: string;
  rect: Rect;
  fontSize: number;
  fontPath?: string;
  bold?: boolean;
};

type PlannedTextboxPage = {
  chunks: PlannedTextboxChunk[];
};

type TextboxImportPlan = {
  pages: PlannedTextboxPage[];
  currentPageHasImportAreaContent: boolean;
  recommendedInsertMode: Exclude<TextboxImportInsertMode, 'auto'>;
  effectiveInsertMode: Exclude<TextboxImportInsertMode, 'auto'>;
  expectedCreatedPageCount: number;
  expectedTextboxCount: number;
  blockSummary: TextboxImportBlockSummary;
};

export const DEFAULT_TEXTBOX_IMPORT_SETTINGS: TextboxImportSettings = {
  sourceFolder: 'inbox',
  filename: 'import.txt',
  fontSize: 36,
  structure: {
    layoutMode: 'continuous',
    paragraphSeparator: 'blankLine',
    detectMarkdownHeadings: true,
    paragraph: {
      fontSize: 36,
      bold: false,
    },
    heading1: {
      fontSize: 52,
      bold: true,
    },
    heading2: {
      fontSize: 46,
      bold: true,
    },
    heading3: {
      fontSize: 40,
      bold: true,
    },
  },
  marginLeft: 100,
  marginTop: 100,
  marginRight: 200,
  marginBottom: 200,
  insertMode: 'auto',
};

const PREVIEW_LINE_LIMIT = 5;
const PREVIEW_CHARACTER_LIMIT = 200;
const BLANK_TEMPLATE_NAME = 'style_white';
const MAIN_LAYER = 0;
const TEXT_TYPE_NORMAL = 500;

export function resolveTextboxImportFolder(
  sourceFolder: TextboxImportSourceFolder,
): string {
  if (sourceFolder === 'inbox') {
    return '/storage/emulated/0/Inbox';
  }

  return '/storage/emulated/0/MyStyle/TextboxHelper/inbox';
}

export function resolveTextboxImportPath(
  settings: TextboxImportSettings,
): string {
  const safeFilename = settings.filename.trim();

  if (!safeFilename) {
    throw new Error('Enter a filename before previewing.');
  }

  return `${resolveTextboxImportFolder(settings.sourceFolder)}/${safeFilename}`;
}

function assertApiSuccess<T>(
  response: ApiResponse<T> | null | undefined,
  fallback: string,
): T {
  if (response?.success) {
    return response.result as T;
  }

  throw new Error(response?.error?.message || fallback);
}

function normalizeImportedText(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function countWords(text: string): number {
  const matches = text.match(/\S+/g);
  return matches ? matches.length : 0;
}

function countParagraphs(text: string): number {
  return text
    .split(/\n{2,}/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean).length;
}

function trimToPreviewCharacterLimit(text: string, fromStart: boolean): string {
  if (text.length <= PREVIEW_CHARACTER_LIMIT) {
    return text;
  }

  if (fromStart) {
    return `${text.slice(0, PREVIEW_CHARACTER_LIMIT).trimEnd()}\n…`;
  }

  return `…\n${text.slice(-PREVIEW_CHARACTER_LIMIT).trimStart()}`;
}

function buildPreviewText(text: string, fromStart: boolean): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  const selectedLines = fromStart
    ? lines.slice(0, PREVIEW_LINE_LIMIT)
    : lines.slice(Math.max(0, lines.length - PREVIEW_LINE_LIMIT));

  const selectedText = selectedLines.join('\n').trim();

  if (lines.length <= PREVIEW_LINE_LIMIT) {
    return trimToPreviewCharacterLimit(selectedText, fromStart);
  }

  const shortened = fromStart ? `${selectedText}\n…` : `…\n${selectedText}`;
  return trimToPreviewCharacterLimit(shortened, fromStart);
}

async function readUtf8TextFile(path: string): Promise<string> {
  const exists = await RNFS.exists(path);

  if (!exists) {
    throw new Error(`File not found: ${path}`);
  }

  return RNFS.readFile(path, 'utf8');
}

function buildImportMaxRect(
  pageSize: Size,
  settings: TextboxImportSettings,
): Rect {
  const rect: Rect = {
    left: settings.marginLeft,
    top: settings.marginTop,
    right: pageSize.width - settings.marginRight,
    bottom: pageSize.height - settings.marginBottom,
  };

  if (rectWidth(rect) <= 0 || rectHeight(rect) <= 0) {
    throw new Error('Import margins leave no usable textbox area.');
  }

  return rect;
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

async function getCurrentNoteContext(): Promise<CurrentNoteContext> {
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

function getElementObstacleRect(element: Element): Rect | null {
  if (element.layerNum !== MAIN_LAYER) {
    return null;
  }

  if (element.type === TEXT_TYPE_NORMAL && element.textBox?.textRect) {
    return element.textBox.textRect;
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
    return element.picture.rect;
  }

  return null;
}

function pageHasContentInImportArea(
  pageElements: Element[],
  importRect: Rect,
): boolean {
  return pageElements.some(element => {
    const obstacleRect = getElementObstacleRect(element);
    return obstacleRect ? intersectionRect(obstacleRect, importRect) !== null : false;
  });
}

function getRecommendedInsertMode(
  currentPageHasImportAreaContent: boolean,
): Exclude<TextboxImportInsertMode, 'auto'> {
  return currentPageHasImportAreaContent ? 'afterCurrentPage' : 'currentPage';
}

function resolveEffectiveInsertMode(params: {
  selectedInsertMode: TextboxImportInsertMode;
  recommendedInsertMode: Exclude<TextboxImportInsertMode, 'auto'>;
}): Exclude<TextboxImportInsertMode, 'auto'> {
  if (params.selectedInsertMode === 'auto') {
    return params.recommendedInsertMode;
  }

  return params.selectedInsertMode;
}

function countCreatedPages(params: {
  plannedPageCount: number;
  effectiveInsertMode: Exclude<TextboxImportInsertMode, 'auto'>;
}): number {
  if (params.effectiveInsertMode === 'currentPage') {
    return Math.max(0, params.plannedPageCount - 1);
  }

  return params.plannedPageCount;
}

function countPlannedTextboxes(pages: PlannedTextboxPage[]): number {
  return pages.reduce((total, page) => total + page.chunks.length, 0);
}

function wrapContinuousChunks(params: {
  chunks: Array<{text: string; rect: Rect}>;
  fontSize: number;
}): PlannedTextboxPage[] {
  return params.chunks.map(chunk => ({
    chunks: [
      {
        text: chunk.text,
        rect: chunk.rect,
        fontSize: params.fontSize,
        bold: false,
      },
    ],
  }));
}

function buildInsertPages(params: {
  pages: PlannedTextboxPage[];
  currentPage: number;
  effectiveInsertMode: Exclude<TextboxImportInsertMode, 'auto'>;
}) {
  const startsOnCurrentPage = params.effectiveInsertMode === 'currentPage';

  return params.pages.flatMap((page, pageIndex) => {
    const pageNumber = startsOnCurrentPage
      ? params.currentPage + pageIndex
      : params.currentPage + 1 + pageIndex;

    const shouldCreatePlannedPage = startsOnCurrentPage ? pageIndex > 0 : true;

    return page.chunks.map((chunk, chunkIndex) => ({
      pageNumber,
      text: chunk.text,
      rect: chunk.rect,
      fontSize: chunk.fontSize,
      fontPath: chunk.fontPath,
      bold: chunk.bold,
      createPage: shouldCreatePlannedPage && chunkIndex === 0,
    }));
  });
}

function emptyBlockSummaryForContinuousMode(text: string): TextboxImportBlockSummary {
  return {
    blockCount: countParagraphs(text),
    paragraphCount: countParagraphs(text),
    headingCount: 0,
    h1Count: 0,
    h2Count: 0,
    h3Count: 0,
  };
}

async function buildImportPlan(params: {
  text: string;
  settings: TextboxImportSettings;
  context: CurrentNoteContext;
}): Promise<TextboxImportPlan> {
  const maxRect = buildImportMaxRect(params.context.pageSize, params.settings);
  const currentPageHasImportAreaContent = pageHasContentInImportArea(
    params.context.pageElements,
    maxRect,
  );
  const recommendedInsertMode = getRecommendedInsertMode(
    currentPageHasImportAreaContent,
  );
  const effectiveInsertMode = resolveEffectiveInsertMode({
    selectedInsertMode: params.settings.insertMode,
    recommendedInsertMode,
  });

  let pages: PlannedTextboxPage[];
  let blockSummary: TextboxImportBlockSummary;

  if (params.settings.structure.layoutMode === 'paragraphTextboxes') {
    const blocks = parseTextboxImportBlocks({
      text: params.text,
      structure: params.settings.structure,
    });

    if (blocks.length === 0) {
      throw new Error('No import blocks were planned.');
    }

    blockSummary = summarizeTextboxImportBlocks(blocks);

    const blockPages: TextboxBlockPage[] = await paginateTextboxBlocksIntoPages({
      blocks,
      maxRect,
      addExplicitEmptyLineHeight: false,
      measureHeight: measureTextboxHeight,
    });

    pages = blockPages.map(page => ({
      chunks: page.chunks,
    }));
  } else {
    const chunks = await paginateTextIntoTextboxPages({
      text: params.text,
      maxRect,
      fontSize: params.settings.fontSize,
      addExplicitEmptyLineHeight: false,
      measureHeight: measureTextboxHeight,
    });

    pages = wrapContinuousChunks({
      chunks,
      fontSize: params.settings.fontSize,
    });

    blockSummary = emptyBlockSummaryForContinuousMode(params.text);
  }

  if (pages.length === 0 || countPlannedTextboxes(pages) === 0) {
    throw new Error('No import pages were planned.');
  }

  return {
    pages,
    currentPageHasImportAreaContent,
    recommendedInsertMode,
    effectiveInsertMode,
    expectedCreatedPageCount: countCreatedPages({
      plannedPageCount: pages.length,
      effectiveInsertMode,
    }),
    expectedTextboxCount: countPlannedTextboxes(pages),
    blockSummary,
  };
}

export async function getTextboxImportPreview(
  settings: TextboxImportSettings,
): Promise<TextboxImportPreview> {
  const sourcePath = resolveTextboxImportPath(settings);
  const rawText = await readUtf8TextFile(sourcePath);
  const text = normalizeImportedText(rawText);

  if (!text) {
    throw new Error(`File is empty after cleanup: ${sourcePath}`);
  }

  const context = await getCurrentNoteContext();

  try {
    const plan = await buildImportPlan({
      text,
      settings,
      context,
    });

    return {
      sourcePath,
      characterCount: text.length,
      wordCount: countWords(text),
      lineCount: text.split('\n').length,
      paragraphCount: plan.blockSummary.paragraphCount,
      headingCount: plan.blockSummary.headingCount,
      h1Count: plan.blockSummary.h1Count,
      h2Count: plan.blockSummary.h2Count,
      h3Count: plan.blockSummary.h3Count,
      blockCount: plan.blockSummary.blockCount,
      layoutMode: settings.structure.layoutMode,
      paragraphSeparator: settings.structure.paragraphSeparator,
      expectedTextboxCount: plan.expectedTextboxCount,
      expectedCreatedPageCount: plan.expectedCreatedPageCount,
      currentPageHasImportAreaContent: plan.currentPageHasImportAreaContent,
      recommendedInsertMode: plan.recommendedInsertMode,
      effectiveInsertMode: plan.effectiveInsertMode,
      startPreview: buildPreviewText(text, true),
      endPreview: buildPreviewText(text, false),
    };
  } finally {
    await recycleElements(context.pageElements);
  }
}

/**
 * Imports the text file and appends a warning to the message when a font couldn't be read, because
 * then the textboxes were sized with a standard font (`src/shared/fontPaths.ts`).
 */
export async function performTextboxImport(
  settings: TextboxImportSettings,
  options?: TextboxImportExecutionOptions,
): Promise<TextboxImportResult> {
  resetFontWarnings();
  const result = await runTextboxImport(settings, options);
  return {...result, message: appendFontWarning(result.message, getFontWarning())};
}

async function runTextboxImport(
  settings: TextboxImportSettings,
  options?: TextboxImportExecutionOptions,
): Promise<TextboxImportResult> {
  const sourcePath = resolveTextboxImportPath(settings);

  options?.onProgress?.({message: 'Reading import file...'});
  const rawText = await readUtf8TextFile(sourcePath);
  const text = normalizeImportedText(rawText);

  if (!text) {
    throw new Error(`File is empty after cleanup: ${sourcePath}`);
  }

  options?.onProgress?.({message: 'Reading current note context...'});
  const context = await getCurrentNoteContext();

  try {
    options?.onProgress?.({message: 'Planning import pages...'});
    const plan = await buildImportPlan({
      text,
      settings,
      context,
    });

    const pages = buildInsertPages({
      pages: plan.pages,
      currentPage: context.currentPage,
      effectiveInsertMode: plan.effectiveInsertMode,
    });

    options?.onProgress?.({
      message:
        plan.effectiveInsertMode === 'currentPage'
          ? `Inserting on current page plus ${plan.expectedCreatedPageCount} new page(s)...`
          : `Creating ${plan.expectedCreatedPageCount} new page(s)...`,
    });

    const insertResult = await insertTextboxPages({
      notePath: context.notePath,
      currentPage: context.currentPage,
      pages,
      templateName: BLANK_TEMPLATE_NAME,
      onProgress: update => {
        options?.onProgress?.(update);
      },
    });

    return {
      message: `Imported ${insertResult.insertedTextboxCount} textbox(es) and created ${insertResult.createdPageCount} new page(s).`,
      sourcePath,
      createdPageCount: insertResult.createdPageCount,
      insertedTextboxCount: insertResult.insertedTextboxCount,
      characterCount: text.length,
      wordCount: countWords(text),
      effectiveInsertMode: plan.effectiveInsertMode,
    };
  } finally {
    await recycleElements(context.pageElements);
  }
}
