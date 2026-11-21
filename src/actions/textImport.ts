import {paginateTextboxBlocksIntoPages, type TextboxBlockPage} from '../domain/blockPagination';
import {dividerTag, formatBlockTag, newBlockId, parseBlockTag} from '../domain/blockTag';
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
import {addSummaries, parseSourceBlocks, type ParsedSource, type SourceSummary} from '../domain/sourceBlocks';
import {newNoteLinks, withSources, type NoteLinks} from '../domain/noteLinks';
import {dividerText, newSourceId, sourceFileName, type SourceRecord} from '../domain/sourceRecord';
import {countWords} from '../domain/textSplitting';
import {paginateTextIntoTextboxPages} from '../domain/textPagination';
import {readUtf8TextFile} from '../storage/importFile';
import {readNoteLinks, readSourceRecord, writeNoteLinks, writeSourceRecord} from '../storage/sourceStore';
import {
  getCurrentNoteContext,
  readNoteInfo,
  recycleElements,
  saveCurrentNoteForConsistency,
  type CurrentNoteContext,
} from '../supernote/noteElements';
import {insertTextboxPages} from '../supernote/noteTextInsertion';
import {syncFileTitles} from './fileTitles';
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

type ImportFile = {
  path: string;
  /** The file as read (the record keeps it exactly). */
  raw: string;
  parsed: ParsedSource;
};

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
type ImportTarget = {
  links: NoteLinks | null;
  linked: boolean;
  /** Set when adding to a linked note: the note's last page, the import goes after it. */
  lastPage: number | null;
};

async function importTarget(settings: TextboxImportSettings, notePath: string): Promise<ImportTarget> {
  const links = await readNoteLinks(notePath);
  if (!links) {
    return {links: null, linked: isLinkedImport(settings), lastPage: null};
  }
  const {pageCount} = await readNoteInfo();
  return {links, linked: true, lastPage: pageCount - 1};
}

/** The settings an import into a linked note uses: linked, paragraph boxes, after the last page. */
function effectiveSettings(settings: TextboxImportSettings, target: ImportTarget): TextboxImportSettings {
  if (target.lastPage === null) {
    return settings;
  }
  return {
    ...settings,
    linkToFile: true,
    insertMode: 'afterCurrentPage',
    structure: {...settings.structure, layoutMode: 'paragraphTextboxes'},
  };
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

/** Refuses a file that is already linked to this note. */
async function checkNotLinkedYet(links: NoteLinks | null, paths: string[]): Promise<void> {
  if (!links) {
    return;
  }
  for (const sourceId of links.sources) {
    const record = await readSourceRecord(sourceId);
    if (record && paths.includes(record.filePath)) {
      throw new Error(`${sourceFileName(record)} is already linked to this note.`);
    }
  }
}

export async function getTextboxImportPreview(
  chosen: TextboxImportSettings,
): Promise<TextboxImportPreview> {
  const sourcePath = resolveTextboxImportPath(chosen);
  const noteContext = await getCurrentNoteContext();

  try {
    const target = await importTarget(chosen, noteContext.notePath);
    const settings = effectiveSettings(chosen, target);
    const context = targetContext(noteContext, target);
    const {text, files, linkedBlocks} = await readImportText(settings, [sourcePath], target.linked);
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
): Promise<TextboxImportResult> {
  resetFontWarnings();
  const result = await runTextboxImport(settings, options);
  return {...result, message: appendFontWarning(result.message, getFontWarning())};
}

async function runTextboxImport(
  chosen: TextboxImportSettings,
  options?: TextboxImportExecutionOptions,
): Promise<TextboxImportResult> {
  const sourcePath = resolveTextboxImportPath(chosen);

  options?.onProgress?.({message: 'Reading current note context...'});
  const noteContext = await getCurrentNoteContext();

  try {
    const target = await importTarget(chosen, noteContext.notePath);
    const settings = effectiveSettings(chosen, target);
    const context = targetContext(noteContext, target);
    await checkNotLinkedYet(target.links, [sourcePath]);

    options?.onProgress?.({message: 'Reading import file...'});
    const {text, files, linkedBlocks} = await readImportText(settings, [sourcePath], target.linked);

    options?.onProgress?.({message: 'Planning import pages...'});
    const plan = await buildImportPlan({
      text,
      settings,
      context,
      linkedBlocks,
    });

    // The records go first: an import that stops halfway still leaves a usable link.
    const records = target.linked
      ? await linkImport({files, plan, notePath: context.notePath, links: target.links})
      : [];

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

    let titleNote = '';
    if (records.length > 0) {
      options?.onProgress?.({message: 'Adding the file titles...'});
      titleNote = await addFileTitles(context.notePath, pages);
    }

    const protectedCount = files.reduce((sum, file) => sum + file.parsed.summary.protectedCount, 0);
    const linkedNote =
      records.length > 0
        ? ` ${protectedCount ? `${protectedCount} kept as is · ` : ''}Linked to ${records.map(sourceFileName).join(', ')}.${titleNote}`
        : '';
    return {
      message: `Imported ${insertResult.insertedTextboxCount} textbox(es) and created ${insertResult.createdPageCount} new page(s).${linkedNote}`,
      sourceId: records[0]?.sourceId ?? null,
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

/**
 * Covers the inserted dividers with NOTE titles and saves the note. A title that can't be written
 * doesn't undo the import: the text and the link are there; Details → Restore titles tries again.
 */
async function addFileTitles(notePath: string, pages: {pageNumber: number; userData?: string}[]): Promise<string> {
  const dividerPages = pages.filter(page => parseBlockTag(page.userData)?.k === 'f').map(page => page.pageNumber);
  try {
    await syncFileTitles(notePath, dividerPages);
    await saveCurrentNoteForConsistency('adding the file titles');
    return '';
  } catch (error) {
    console.warn('[TextImport] file titles not added', String(error));
    return ' The file title could not be added: Manuscript → Details → Restore titles.';
  }
}

/**
 * Writes the records of a linked import (one per file) and the note's list of linked files, and
 * gives every planned textbox its tag: a block of its file (with the piece of a block cut to fit
 * the pages and the placeholder kind), or the file's divider.
 */
async function linkImport(params: {
  files: ImportFile[];
  plan: TextboxImportPlan;
  notePath: string;
  links: NoteLinks | null;
}): Promise<SourceRecord[]> {
  const now = new Date();
  const records: SourceRecord[] = params.files.map(file => ({
    version: 1,
    sourceId: newSourceId(now),
    filePath: file.path,
    notePath: params.notePath,
    importedAt: now.toISOString(),
    original: file.raw,
    eol: file.parsed.eol,
    frontmatterEnd: file.parsed.frontmatterEnd,
    blocks: file.parsed.blocks,
    removedProtected: [],
    lastWrittenAt: null,
    lastWrittenText: null,
    fileFingerprint: fingerprint(file.raw),
  }));
  for (const page of params.plan.pages) {
    for (const chunk of page.chunks) {
      const record = records[chunk.sourceFile ?? 0];
      if (!record) {
        continue;
      }
      if (chunk.divider) {
        chunk.userData = formatBlockTag(dividerTag(record.sourceId, now));
        continue;
      }
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
  for (const record of records) {
    await writeSourceRecord(record);
  }
  const links = params.links ?? newNoteLinks(params.notePath, 'files');
  await writeNoteLinks(withSources(links, records.map(record => record.sourceId)));
  console.log(
    '[TextImport] linked',
    JSON.stringify({files: records.length, blocks: records.reduce((sum, record) => sum + record.blocks.length, 0)}),
  );
  return records;
}
