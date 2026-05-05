import RNFS from 'react-native-fs';
import {PluginCommAPI, PluginFileAPI, type Element, type Rect} from 'sn-plugin-lib';
import {
  intersectionRect,
  rectHeight,
  rectWidth,
} from './shared/supernoteTextboxGeometry';
import {paginateTextIntoTextboxPages} from './shared/supernoteTextPagination';
import {insertTextboxPages} from './shared/supernoteNoteTextInsertion';

export type TextboxImportSourceFolder = 'inbox' | 'myStyle';

export type TextboxImportInsertMode =
  | 'auto'
  | 'currentPage'
  | 'afterCurrentPage';

export type TextboxImportSettings = {
  sourceFolder: TextboxImportSourceFolder;
  filename: string;
  fontSize: number;
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

export const DEFAULT_TEXTBOX_IMPORT_SETTINGS: TextboxImportSettings = {
  sourceFolder: 'inbox',
  filename: 'import.txt',
  fontSize: 36,
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
  chunkCount: number;
  effectiveInsertMode: Exclude<TextboxImportInsertMode, 'auto'>;
}): number {
  if (params.effectiveInsertMode === 'currentPage') {
    return Math.max(0, params.chunkCount - 1);
  }

  return params.chunkCount;
}

function buildInsertPages(params: {
  chunks: Array<{text: string; rect: Rect}>;
  currentPage: number;
  fontSize: number;
  effectiveInsertMode: Exclude<TextboxImportInsertMode, 'auto'>;
}) {
  const startsOnCurrentPage = params.effectiveInsertMode === 'currentPage';

  return params.chunks.map((chunk, index) => ({
    pageNumber: startsOnCurrentPage
      ? params.currentPage + index
      : params.currentPage + 1 + index,
    text: chunk.text,
    rect: chunk.rect,
    fontSize: params.fontSize,
    createPage: startsOnCurrentPage ? index > 0 : true,
  }));
}

async function buildImportPlan(params: {
  text: string;
  settings: TextboxImportSettings;
  context: CurrentNoteContext;
}) {
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

  const chunks = await paginateTextIntoTextboxPages({
    text: params.text,
    maxRect,
    fontSize: params.settings.fontSize,
    addExplicitEmptyLineHeight: false,
  });

  if (chunks.length === 0) {
    throw new Error('No import pages were planned.');
  }

  return {
    chunks,
    currentPageHasImportAreaContent,
    recommendedInsertMode,
    effectiveInsertMode,
    expectedCreatedPageCount: countCreatedPages({
      chunkCount: chunks.length,
      effectiveInsertMode,
    }),
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
      paragraphCount: countParagraphs(text),
      expectedTextboxCount: plan.chunks.length,
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

export async function performTextboxImport(
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
      chunks: plan.chunks,
      currentPage: context.currentPage,
      fontSize: settings.fontSize,
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