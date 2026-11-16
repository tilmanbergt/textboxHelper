import {paginateTextboxBlocksIntoPages, type TextboxBlockPage} from '../domain/blockPagination';
import {appendFontWarning} from '../domain/fontPaths';
import {
  parseTextboxImportBlocks,
  summarizeTextboxImportBlocks,
  type TextboxImportBlockSummary,
} from '../domain/importParsing';
import {
  buildImportMaxRect,
  buildInsertPages,
  buildPreviewText,
  countCreatedPages,
  countPlannedTextboxes,
  emptyBlockSummaryForContinuousMode,
  getRecommendedInsertMode,
  normalizeImportedText,
  pageHasContentInImportArea,
  resolveEffectiveInsertMode,
  wrapContinuousChunks,
  type PlannedTextboxPage,
  type TextboxImportPlan,
} from '../domain/importPlan';
import {
  resolveTextboxImportPath,
  type TextboxImportInsertMode,
  type TextboxImportLayoutMode,
  type TextboxImportParagraphSeparator,
  type TextboxImportSettings,
} from '../domain/importSettings';
import {countWords} from '../domain/textSplitting';
import {paginateTextIntoTextboxPages} from '../domain/textPagination';
import {readUtf8TextFile} from '../storage/importFile';
import {
  getCurrentNoteContext,
  recycleElements,
  type CurrentNoteContext,
} from '../supernote/noteElements';
import {insertTextboxPages} from '../supernote/noteTextInsertion';
import {getFontWarning, measureTextboxHeight, resetFontWarnings} from '../supernote/textboxMetrics';

/**
 * The text import behind "Import Text File": read the file, plan the textboxes and pages for the
 * current note, show the preview, and insert them. The planning is in `src/domain/importPlan.ts`
 * and the pagination in `src/domain/*Pagination.ts`.
 */

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
  /** The page the import starts from (0-based) and its size in page pixels. */
  currentPage: number;
  pageSize: {width: number; height: number};
  /** The first planned pages with their textboxes, to draw them to scale. */
  pages: PlannedTextboxPage[];
  plannedPageCount: number;
};

/** How many planned pages the preview carries; the counts cover all of them. */
const PREVIEW_PAGE_LIMIT = 3;
const BLANK_TEMPLATE_NAME = 'style_white';

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
    throw new Error('The file is empty.');
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
      currentPage: context.currentPage,
      pageSize: {width: context.pageSize.width, height: context.pageSize.height},
      pages: plan.pages.slice(0, PREVIEW_PAGE_LIMIT),
      plannedPageCount: plan.pages.length,
    };
  } finally {
    await recycleElements(context.pageElements);
  }
}

/**
 * Imports the text file and appends a warning to the message when a font couldn't be read, because
 * then the textboxes were sized with a standard font (`src/domain/fontPaths.ts`).
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
    throw new Error('The file is empty.');
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
