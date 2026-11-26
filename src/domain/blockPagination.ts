import type {Rect} from './textboxModel';
import {rectHeight, rectWidth} from './geometry';
import type {TextboxImportBlock} from './importParsing';
import {
  DEFAULT_TEXTBOX_MIN_HEIGHT,
  estimateHeightForRect,
  type MeasureTextboxHeight,
  rectWithTopAndHeight,
} from './paginationCore';
import {indentAfterBreak, sentenceUnits, wordUnits, type CutUnit} from './textWhitespace';

export type TextboxBlockPageChunk = {
  text: string;
  rect: Rect;
  fontSize: number;
  fontPath?: string;
  bold?: boolean;
  /** Linked import: the file's block and, for a block cut to fit the pages, the piece (0, 1, …). */
  sourceIndex?: number;
  piece?: number;
  placeholder?: boolean;
  /** Linked import of several files (technical-design-linked-files.md §2.2). */
  sourceFile?: number;
  divider?: boolean;
};

export type TextboxBlockPage = {
  chunks: TextboxBlockPageChunk[];
};

export type TextboxBlockPaginationOptions = {
  blocks: TextboxImportBlock[];
  maxRect: Rect;
  fontPath?: string;
  minHeight?: number;
  blockGap?: number;
  /** Whether a block starts a new page (technical-design-settings-layout-files.md §1). */
  breakBefore?: (block: TextboxImportBlock) => boolean;
  addExplicitEmptyLineHeight?: boolean;
  measureHeight: MeasureTextboxHeight;
};

const DEFAULT_BLOCK_GAP = 18;

async function heightForText(params: {
  text: string;
  maxRect: Rect;
  fontSize: number;
  fontPath?: string;
  minHeight: number;
  addExplicitEmptyLineHeight?: boolean;
  measureHeight: MeasureTextboxHeight;
}): Promise<number> {
  return estimateHeightForRect({
    text: params.text,
    rect: params.maxRect,
    fontSize: params.fontSize,
    fontPath: params.fontPath,
    minHeight: params.minHeight,
    addExplicitEmptyLineHeight: params.addExplicitEmptyLineHeight,
    measureHeight: params.measureHeight,
  });
}

async function fitsEmptyPage(params: {
  text: string;
  maxRect: Rect;
  fontSize: number;
  fontPath?: string;
  minHeight: number;
  addExplicitEmptyLineHeight?: boolean;
  measureHeight: MeasureTextboxHeight;
}): Promise<boolean> {
  const height = await heightForText(params);
  return height <= rectHeight(params.maxRect);
}

/**
 * A text too tall for the area, cut into pieces that each fit it: at line breaks and sentence ends,
 * else between words. Inside a piece the text keeps its own whitespace, line breaks included, so a
 * list stays a list on the page; a piece after a cut at a line break starts with that line's
 * indentation (`textWhitespace.ts`).
 */
export async function splitIntoPageFittingPieces(params: {
  text: string;
  maxRect: Rect;
  fontSize: number;
  fontPath?: string;
  minHeight: number;
  addExplicitEmptyLineHeight?: boolean;
  measureHeight: MeasureTextboxHeight;
}): Promise<string[]> {
  const pieces: string[] = [];
  let buffer = '';

  const tryFits = (text: string) =>
    fitsEmptyPage({
      text,
      maxRect: params.maxRect,
      fontSize: params.fontSize,
      fontPath: params.fontPath,
      minHeight: params.minHeight,
      addExplicitEmptyLineHeight: params.addExplicitEmptyLineHeight,
      measureHeight: params.measureHeight,
    });
  // A unit as the first text of a piece: no whitespace before it, but a line's indentation.
  const opening = (unit: CutUnit) => `${indentAfterBreak(unit.before)}${unit.text}`;

  for (const unit of sentenceUnits(params.text)) {
    const candidate = buffer ? `${buffer}${unit.before}${unit.text}` : opening(unit);

    if (await tryFits(candidate)) {
      buffer = candidate;
      continue;
    }

    if (buffer) {
      pieces.push(buffer);
      buffer = '';
    }

    if (await tryFits(opening(unit))) {
      buffer = opening(unit);
      continue;
    }

    let wordBuffer = indentAfterBreak(unit.before);

    for (const word of wordUnits(unit.text)) {
      const wordCandidate = wordBuffer.trim() ? `${wordBuffer}${word.before}${word.text}` : `${wordBuffer}${word.text}`;

      if (await tryFits(wordCandidate)) {
        wordBuffer = wordCandidate;
        continue;
      }

      if (wordBuffer.trim()) {
        pieces.push(wordBuffer);
      }

      wordBuffer = word.text;
    }

    if (wordBuffer.trim()) {
      buffer = wordBuffer;
    }
  }

  if (buffer) {
    pieces.push(buffer);
  }

  return pieces;
}

export async function paginateTextboxBlocksIntoPages(
  options: TextboxBlockPaginationOptions,
): Promise<TextboxBlockPage[]> {
  const maxHeight = rectHeight(options.maxRect);
  const maxWidth = rectWidth(options.maxRect);
  const minHeight = options.minHeight ?? DEFAULT_TEXTBOX_MIN_HEIGHT;
  const blockGap = options.blockGap ?? DEFAULT_BLOCK_GAP;

  if (maxWidth <= 0 || maxHeight <= 0) {
    throw new Error('Block pagination received an unusable rectangle.');
  }

  const pages: TextboxBlockPage[] = [];
  let currentPage: TextboxBlockPage = {chunks: []};
  let cursorTop = options.maxRect.top;

  const startNewPage = () => {
    if (currentPage.chunks.length > 0) {
      pages.push(currentPage);
    }

    currentPage = {chunks: []};
    cursorTop = options.maxRect.top;
  };

  const placeChunk = async (params: {
    text: string;
    fontSize: number;
    bold: boolean;
    block: TextboxImportBlock;
    piece: number;
  }) => {
    const height = Math.min(
      await heightForText({
        text: params.text,
        maxRect: options.maxRect,
        fontSize: params.fontSize,
        fontPath: options.fontPath,
        minHeight,
        addExplicitEmptyLineHeight: options.addExplicitEmptyLineHeight,
        measureHeight: options.measureHeight,
      }),
      maxHeight,
    );

    if (
      currentPage.chunks.length > 0 &&
      cursorTop + height > options.maxRect.bottom
    ) {
      startNewPage();
    }

    currentPage.chunks.push({
      text: params.text,
      rect: rectWithTopAndHeight(options.maxRect, cursorTop, height),
      fontSize: params.fontSize,
      fontPath: options.fontPath,
      bold: params.bold,
      ...(params.block.sourceIndex !== undefined
        ? {sourceIndex: params.block.sourceIndex, piece: params.piece}
        : {}),
      ...(params.block.placeholder ? {placeholder: true} : {}),
      ...(params.block.sourceFile !== undefined ? {sourceFile: params.block.sourceFile} : {}),
      ...(params.block.divider ? {divider: true} : {}),
    });

    cursorTop = cursorTop + height + blockGap;
  };

  for (const block of options.blocks) {
    if (currentPage.chunks.length > 0 && options.breakBefore?.(block)) {
      startNewPage();
    }
    const blockHeight = await heightForText({
      text: block.text,
      maxRect: options.maxRect,
      fontSize: block.fontSize,
      fontPath: options.fontPath,
      minHeight,
      addExplicitEmptyLineHeight: options.addExplicitEmptyLineHeight,
      measureHeight: options.measureHeight,
    });

    if (blockHeight <= maxHeight) {
      await placeChunk({
        text: block.text,
        fontSize: block.fontSize,
        bold: block.bold,
        block,
        piece: 0,
      });
      continue;
    }

    const pieces = await splitIntoPageFittingPieces({
      text: block.text,
      maxRect: options.maxRect,
      fontSize: block.fontSize,
      fontPath: options.fontPath,
      minHeight,
      addExplicitEmptyLineHeight: options.addExplicitEmptyLineHeight,
      measureHeight: options.measureHeight,
    });

    for (const [index, piece] of pieces.entries()) {
      await placeChunk({
        text: piece,
        fontSize: block.fontSize,
        bold: block.bold,
        block,
        piece: index,
      });
    }
  }

  if (currentPage.chunks.length > 0) {
    pages.push(currentPage);
  }

  return pages;
}
