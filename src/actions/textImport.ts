import {paginateTextboxBlocksIntoPages, type TextboxBlockPage} from '../domain/blockPagination';
import {appendFontWarning, NOTE_SYSTEM_FONT_PATH} from '../domain/fontPaths';
import {
  parseTextboxImportBlocks,
  sourceImportBlocks,
  summarizeTextboxImportBlocks,
  type TextboxImportBlock,
  type TextboxImportBlockSummary,
} from '../domain/importParsing';
import {
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
import {addSummaries, parseSourceBlocks, type SourceSummary} from '../domain/sourceBlocks';
import type {NoteLinks} from '../domain/noteLinks';
import {dividerText} from '../domain/sourceRecord';
import {countWords} from '../domain/textSplitting';
import {paginateTextIntoTextboxPages} from '../domain/textPagination';
import {readUtf8TextFile} from '../storage/importFile';
import {readNoteLinks} from '../storage/sourceStore';
import {
  getCurrentNoteContext,
  readNoteInfo,
  recycleElements,
  type CurrentNoteContext,
} from '../supernote/noteElements';
import {insertTextboxPages} from '../supernote/noteTextInsertion';
import {getSettings} from '../storage/settingsFile';
import {textArea} from '../domain/pageLayout';
import {
  addTitles,
  checkNotLinkedYet,
  linkedName,
  linkImport,
  writeFirstIndex,
  type FolderImport,
  type ImportFile,
} from './importLinking';
import {folderName} from './folderLink';
import {getFontWarning, measureTextboxHeight, resetFontWarnings} from '../supernote/textboxMetrics';

/**
 * The text import behind "Import Text File": read the file, plan the textboxes and pages for the
 * current note, show the preview, and insert them. The planning is in `src/domain/importPlan.ts`
 * and the pagination in `src/domain/*Pagination.ts`.
 *
 * A linked import (technical-design-source-link.md §3) places one textbox per block of the file
 * (`domain/sourceBlocks.ts`), tags each with its block and writes the file's record before the
 * textboxes, so changes can be written back to the file later. Each linked file starts with a
 * divider (its name under a NOTE title, technical-design-linked-files.md §2); a note that has
 * linked files gets more files only linked and after its last page.
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
  /** Every linked file of the import (a folder: all of them). */
  sourceIds: string[];
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
  /** Adding to a note with linked files: how many it has and the page the file goes after. */
  addingTo: {fileCount: number; afterPage: number} | null;
  /** How many files are imported (a folder: its chosen files). */
  fileCount: number;
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
  const layout = getSettings().layout;
  const maxRect = textArea(params.context.pageSize, layout);
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
      blockGap: layout.blockGap,
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
  /** Cleaned up for the counts, the preview text and an unlinked import. */
  text: string;
  /** A linked import's files with their blocks; empty for an unlinked import. */
  files: ImportFile[];
  linkedBlocks?: TextboxImportBlock[];
};

/**
 * Where an import goes (technical-design-linked-files.md §2.2): a note with linked files gets more
 * files only linked and only after its last page; otherwise the settings decide.
 */

/**
 * What is imported: the settings' file, a folder's files, or files added to a note's links from
 * the Manuscript card (`adding`: the new files of its folder, or one more file).
 */
type ImportRequest = {
  settings: TextboxImportSettings;
  folder?: FolderImport;
  addPaths?: string[];
};

function requestPaths(request: ImportRequest): string[] {
  if (request.addPaths) {
    return request.addPaths;
  }
  if (request.folder) {
    const {path, names} = request.folder;
    return names.map(name => `${path}/${name}`);
  }
  return [resolveTextboxImportPath(request.settings)];
}

type ImportTarget = {
  links: NoteLinks | null;
  linked: boolean;
  /** Set when adding to a linked note: the note's last page, the import goes after it. */
  lastPage: number | null;
};

async function importTarget(request: ImportRequest, notePath: string): Promise<ImportTarget> {
  const links = await readNoteLinks(notePath);
  if (!links) {
    if (request.folder && request.folder.names.length === 0) {
      throw new Error('Choose at least one file of the folder.');
    }
    return {links: null, linked: !!request.folder || isLinkedImport(request.settings), lastPage: null};
  }
  if (request.folder) {
    throw new Error('This note has linked files already: bind a folder to a note without them.');
  }
  if (links.mode === 'folder' && !request.addPaths) {
    throw new Error(
      `This note is bound to the folder ${folderName(links.folder?.path ?? '')}: add its new files from Manuscript → Settings → Files.`,
    );
  }
  const {pageCount} = await readNoteInfo();
  return {links, linked: true, lastPage: pageCount - 1};
}

/**
 * The settings a linked import uses: linked, in paragraph boxes; into a note that has linked files
 * already, after its last page.
 */
function effectiveSettings(settings: TextboxImportSettings, target: ImportTarget): TextboxImportSettings {
  if (!target.linked) {
    return settings;
  }
  const linked = {
    ...settings,
    linkToFile: true,
    structure: {...settings.structure, layoutMode: 'paragraphTextboxes' as const},
  };
  return target.lastPage === null ? linked : {...linked, insertMode: 'afterCurrentPage'};
}

/** The note context with the last page as the current one, when adding to a linked note. */
function targetContext(context: CurrentNoteContext, target: ImportTarget): CurrentNoteContext {
  return target.lastPage === null ? context : {...context, currentPage: target.lastPage};
}

async function readImportText(
  settings: TextboxImportSettings,
  paths: string[],
  linked: boolean,
): Promise<ImportText> {
  const files: ImportFile[] = [];
  const texts: string[] = [];
  for (const path of paths) {
    const raw = await readUtf8TextFile(path);
    const text = normalizeImportedText(raw);
    if (!text) {
      throw new Error(`${fileNameOf(path)} is empty.`);
    }
    texts.push(text);
    if (linked) {
      const parsed = parseSourceBlocks(raw);
      if (parsed.blocks.length === 0) {
        throw new Error(`${fileNameOf(path)} has no text outside its frontmatter.`);
      }
      files.push({path, raw, parsed});
    }
  }
  if (!linked) {
    return {text: texts.join('\n\n'), files};
  }
  const linkedBlocks = files.flatMap((file, index) =>
    sourceImportBlocks(file.parsed.blocks, settings.structure, {index, divider: dividerText(file.path)}),
  );
  return {text: texts.join('\n\n'), files, linkedBlocks};
}

function fileNameOf(path: string): string {
  return path.split('/').slice(-1)[0] || path;
}

export async function getTextboxImportPreview(
  chosen: TextboxImportSettings,
  folder?: FolderImport,
): Promise<TextboxImportPreview> {
  const request: ImportRequest = {settings: chosen, folder};
  const paths = requestPaths(request);
  const sourcePath = paths[0] ?? '';
  const noteContext = await getCurrentNoteContext();

  try {
    const target = await importTarget(request, noteContext.notePath);
    const settings = effectiveSettings(chosen, target);
    const context = targetContext(noteContext, target);
    const {text, files, linkedBlocks} = await readImportText(settings, paths, target.linked);
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
      source: files.length > 0 ? addSummaries(files.map(file => file.parsed.summary)) : null,
      addingTo: target.links ? {fileCount: target.links.sources.length, afterPage: context.currentPage} : null,
      fileCount: paths.length,
    };
  } finally {
    await recycleElements(noteContext.pageElements);
  }
}

/**
 * Imports the text file and appends a warning to the message when a font couldn't be read, because
 * then the textboxes were sized with a standard font (`src/domain/fontPaths.ts`).
 */
export async function performTextboxImport(
  settings: TextboxImportSettings,
  options?: TextboxImportExecutionOptions,
  folder?: FolderImport,
): Promise<TextboxImportResult> {
  resetFontWarnings();
  const result = await runTextboxImport({settings, folder}, options);
  return {...result, message: appendFontWarning(result.message, getFontWarning())};
}

/**
 * Adds files to a note with linked files, after its last page (Manuscript → Settings → Files: a folder's new
 * files, or files left out before). Returns the result with the new files' source ids.
 */
export async function addLinkedFiles(
  paths: string[],
  options?: TextboxImportExecutionOptions,
): Promise<TextboxImportResult> {
  resetFontWarnings();
  const result = await runTextboxImport({settings: getSettings().import, addPaths: paths}, options);
  return {...result, message: appendFontWarning(result.message, getFontWarning())};
}

async function runTextboxImport(
  request: ImportRequest,
  options?: TextboxImportExecutionOptions,
): Promise<TextboxImportResult> {
  const paths = requestPaths(request);
  const sourcePath = paths[0] ?? '';

  options?.onProgress?.({message: 'Reading current note context...'});
  const noteContext = await getCurrentNoteContext();

  try {
    const target = await importTarget(request, noteContext.notePath);
    const settings = effectiveSettings(request.settings, target);
    const context = targetContext(noteContext, target);
    await checkNotLinkedYet(target.links, paths);

    options?.onProgress?.({message: paths.length > 1 ? `Reading ${paths.length} files...` : 'Reading import file...'});
    const {text, files, linkedBlocks} = await readImportText(settings, paths, target.linked);

    options?.onProgress?.({message: 'Planning import pages...'});
    const plan = await buildImportPlan({
      text,
      settings,
      context,
      linkedBlocks,
    });

    // The records go first: an import that stops halfway still leaves a usable link.
    const linked = target.linked
      ? await linkImport({files, plan, notePath: context.notePath, links: target.links, folder: request.folder})
      : null;
    const records = linked?.records ?? [];

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

    options?.onProgress?.({message: 'Adding the titles...'});
    let titleNote = await addTitles(context.notePath, pages);
    if (linked?.links.folder?.ordered && request.folder) {
      titleNote += await writeFirstIndex(linked.links, records.map(record => record.filePath));
    }

    const protectedCount = files.reduce((sum, file) => sum + file.parsed.summary.protectedCount, 0);
    const linkedNote =
      records.length > 0
        ? ` ${protectedCount ? `${protectedCount} kept as is · ` : ''}Linked to ${linkedName(records, request.folder)}.${titleNote}`
        : '';
    return {
      message: `Imported ${insertResult.insertedTextboxCount} textbox(es) and created ${insertResult.createdPageCount} new page(s).${linkedNote || titleNote}`,
      sourceId: records[0]?.sourceId ?? null,
      sourceIds: records.map(record => record.sourceId),
      sourcePath,
      createdPageCount: insertResult.createdPageCount,
      insertedTextboxCount: insertResult.insertedTextboxCount,
      characterCount: text.length,
      wordCount: countWords(text),
      effectiveInsertMode: plan.effectiveInsertMode,
    };
  } finally {
    await recycleElements(noteContext.pageElements);
  }
}

export type {FolderImport};
