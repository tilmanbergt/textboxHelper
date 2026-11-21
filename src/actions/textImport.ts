import {paginateTextboxBlocksIntoPages, type TextboxBlockPage} from '../domain/blockPagination';
import {formatBlockTag, newBlockId} from '../domain/blockTag';
import {fingerprint} from '../domain/fingerprint';
import {appendFontWarning, NOTE_SYSTEM_FONT_PATH} from '../domain/fontPaths';
import {
  parseTextboxImportBlocks,
  sourceImportBlocks,
  summarizeTextboxImportBlocks,
  type TextboxImportBlock,
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
  isLinkedImport,
  resolveTextboxImportPath,
  type TextboxImportInsertMode,
  type TextboxImportLayoutMode,
  type TextboxImportParagraphSeparator,
  type TextboxImportSettings,
} from '../domain/importSettings';
import {parseSourceBlocks, type ParsedSource, type SourceSummary} from '../domain/sourceBlocks';
import {newSourceId, sourceFileName, type SourceRecord} from '../domain/sourceRecord';
import {countWords} from '../domain/textSplitting';
import {paginateTextIntoTextboxPages} from '../domain/textPagination';
import {readUtf8TextFile} from '../storage/importFile';
import {writeSourceRecord} from '../storage/sourceStore';
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
 *
 * A linked import (technical-design-source-link.md §3) places one textbox per block of the file
 * (`domain/sourceBlocks.ts`), tags each with its block and writes the file's record before the
 * textboxes, so changes can be written back to the file later.
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
  /** The linked file's record id, when the import was linked. */
  sourceId: string | null;
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
  /** A linked import: what the file contains (technical-design-source-link.md §3). */
  source: SourceSummary | null;
};

/** How many planned pages the preview carries; the counts cover all of them. */
const PREVIEW_PAGE_LIMIT = 3;
const BLANK_TEMPLATE_NAME = 'style_white';

async function buildImportPlan(params: {
  text: string;
  settings: TextboxImportSettings;
  context: CurrentNoteContext;
  /** A linked import's blocks, used instead of parsing the text again. */
  linkedBlocks?: TextboxImportBlock[];
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
    const blocks =
      params.linkedBlocks ??
      parseTextboxImportBlocks({
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
      fontPath: NOTE_SYSTEM_FONT_PATH,
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
      fontPath: NOTE_SYSTEM_FONT_PATH,
      addExplicitEmptyLineHeight: false,
      measureHeight: measureTextboxHeight,
    });

    pages = wrapContinuousChunks({
      chunks,
      fontSize: params.settings.fontSize,
      fontPath: NOTE_SYSTEM_FONT_PATH,
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

type ImportText = {
  /** The file as read (a linked import's record keeps it exactly). */
  raw: string;
  /** Cleaned up for the counts, the preview text and an unlinked import. */
  text: string;
  linked: ParsedSource | null;
  linkedBlocks?: TextboxImportBlock[];
};

async function readImportText(settings: TextboxImportSettings, sourcePath: string): Promise<ImportText> {
  const raw = await readUtf8TextFile(sourcePath);
  const text = normalizeImportedText(raw);
  if (!text) {
    throw new Error('The file is empty.');
  }
  if (!isLinkedImport(settings)) {
    return {raw, text, linked: null};
  }
  const linked = parseSourceBlocks(raw);
  if (linked.blocks.length === 0) {
    throw new Error('The file has no text outside its frontmatter.');
  }
  return {raw, text, linked, linkedBlocks: sourceImportBlocks(linked.blocks, settings.structure)};
}

export async function getTextboxImportPreview(
  settings: TextboxImportSettings,
): Promise<TextboxImportPreview> {
  const sourcePath = resolveTextboxImportPath(settings);
  const {text, linked, linkedBlocks} = await readImportText(settings, sourcePath);

  const context = await getCurrentNoteContext();

  try {
    const plan = await buildImportPlan({
      text,
      settings,
      context,
      linkedBlocks,
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
      source: linked?.summary ?? null,
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
  const {raw, text, linked, linkedBlocks} = await readImportText(settings, sourcePath);

  options?.onProgress?.({message: 'Reading current note context...'});
  const context = await getCurrentNoteContext();

  try {
    options?.onProgress?.({message: 'Planning import pages...'});
    const plan = await buildImportPlan({
      text,
      settings,
      context,
      linkedBlocks,
    });

    // The record goes first: an import that stops halfway still leaves a usable link.
    const record = linked
      ? await linkImport({raw, linked, plan, sourcePath, notePath: context.notePath})
      : null;

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

    const linkedNote = record
      ? ` ${linked?.summary.protectedCount ? `${linked.summary.protectedCount} kept as is · ` : ''}Linked to ${sourceFileName(record)}.`
      : '';
    return {
      message: `Imported ${insertResult.insertedTextboxCount} textbox(es) and created ${insertResult.createdPageCount} new page(s).${linkedNote}`,
      sourceId: record?.sourceId ?? null,
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

/**
 * Writes the record of a linked import and gives every planned textbox its block tag (the block,
 * the piece of a block cut to fit the pages, and the placeholder kind).
 */
async function linkImport(params: {
  raw: string;
  linked: ParsedSource;
  plan: TextboxImportPlan;
  sourcePath: string;
  notePath: string;
}): Promise<SourceRecord> {
  const now = new Date();
  const record: SourceRecord = {
    version: 1,
    sourceId: newSourceId(now),
    filePath: params.sourcePath,
    notePath: params.notePath,
    importedAt: now.toISOString(),
    original: params.raw,
    eol: params.linked.eol,
    frontmatterEnd: params.linked.frontmatterEnd,
    blocks: params.linked.blocks,
    removedProtected: [],
    lastWrittenAt: null,
    lastWrittenText: null,
    fileFingerprint: fingerprint(params.raw),
  };
  for (const page of params.plan.pages) {
    for (const chunk of page.chunks) {
      if (chunk.sourceIndex === undefined) {
        continue;
      }
      chunk.userData = formatBlockTag({
        v: 1,
        id: newBlockId(now),
        s: record.sourceId,
        i: chunk.sourceIndex,
        ...(chunk.piece ? {p: chunk.piece} : {}),
        ...(chunk.placeholder ? {k: 'x' as const} : {}),
      });
    }
  }
  await writeSourceRecord(record);
  console.log(
    '[TextImport] linked',
    JSON.stringify({sourceId: record.sourceId, blocks: record.blocks.length, chars: params.raw.length}),
  );
  return record;
}
