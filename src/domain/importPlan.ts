import {intersectionRect} from './geometry';
import type {TextboxImportBlockSummary} from './importParsing';
import type {TextboxImportInsertMode} from './importSettings';
import {MAIN_LAYER, TEXT_TYPE_NORMAL, type PageElementData, type Rect} from './textboxModel';

/**
 * Planning a text import without the device: the cleaned-up text and its preview, whether the current page is free there, the insert mode, and how the
 * paginated chunks become pages.
 */

export type Size = {
  width: number;
  height: number;
};

export type PlannedTextboxChunk = {
  text: string;
  rect: Rect;
  fontSize: number;
  fontPath?: string;
  bold?: boolean;
  /** Linked import (technical-design-source-link.md §3): the file's block and the piece of it. */
  sourceIndex?: number;
  piece?: number;
  /** A protected block's placeholder: italic and framed. */
  placeholder?: boolean;
  /** Linked import of several files: which file, and whether this is its divider. */
  sourceFile?: number;
  divider?: boolean;
  /** The block tag the textbox carries. */
  userData?: string;
};

export type PlannedTextboxPage = {
  chunks: PlannedTextboxChunk[];
};

export type TextboxImportPlan = {
  pages: PlannedTextboxPage[];
  currentPageHasImportAreaContent: boolean;
  recommendedInsertMode: Exclude<TextboxImportInsertMode, 'auto'>;
  effectiveInsertMode: Exclude<TextboxImportInsertMode, 'auto'>;
  expectedCreatedPageCount: number;
  expectedTextboxCount: number;
  blockSummary: TextboxImportBlockSummary;
};

const PREVIEW_LINE_LIMIT = 5;

const PREVIEW_CHARACTER_LIMIT = 200;

export function normalizeImportedText(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

export function countParagraphs(text: string): number {
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

export function buildPreviewText(text: string, fromStart: boolean): string {
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

function getElementObstacleRect(element: PageElementData): Rect | null {
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

export function pageHasContentInImportArea(
  pageElements: PageElementData[],
  importRect: Rect,
): boolean {
  return pageElements.some(element => {
    const obstacleRect = getElementObstacleRect(element);
    return obstacleRect ? intersectionRect(obstacleRect, importRect) !== null : false;
  });
}

export function getRecommendedInsertMode(
  currentPageHasImportAreaContent: boolean,
): Exclude<TextboxImportInsertMode, 'auto'> {
  return currentPageHasImportAreaContent ? 'afterCurrentPage' : 'currentPage';
}

export function resolveEffectiveInsertMode(params: {
  selectedInsertMode: TextboxImportInsertMode;
  recommendedInsertMode: Exclude<TextboxImportInsertMode, 'auto'>;
}): Exclude<TextboxImportInsertMode, 'auto'> {
  if (params.selectedInsertMode === 'auto') {
    return params.recommendedInsertMode;
  }

  return params.selectedInsertMode;
}

export function countCreatedPages(params: {
  plannedPageCount: number;
  effectiveInsertMode: Exclude<TextboxImportInsertMode, 'auto'>;
}): number {
  if (params.effectiveInsertMode === 'currentPage') {
    return Math.max(0, params.plannedPageCount - 1);
  }

  return params.plannedPageCount;
}

export function countPlannedTextboxes(pages: PlannedTextboxPage[]): number {
  return pages.reduce((total, page) => total + page.chunks.length, 0);
}

export function wrapContinuousChunks(params: {
  chunks: Array<{text: string; rect: Rect}>;
  fontSize: number;
  fontPath?: string;
}): PlannedTextboxPage[] {
  return params.chunks.map(chunk => ({
    chunks: [
      {
        text: chunk.text,
        rect: chunk.rect,
        fontSize: params.fontSize,
        ...(params.fontPath ? {fontPath: params.fontPath} : {}),
        bold: false,
      },
    ],
  }));
}

export function buildInsertPages(params: {
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
      italic: chunk.placeholder,
      framed: chunk.placeholder,
      userData: chunk.userData,
      createPage: shouldCreatePlannedPage && chunkIndex === 0,
    }));
  });
}

export function emptyBlockSummaryForContinuousMode(text: string): TextboxImportBlockSummary {
  return {
    blockCount: countParagraphs(text),
    paragraphCount: countParagraphs(text),
    headingCount: 0,
    h1Count: 0,
    h2Count: 0,
    h3Count: 0,
  };
}
