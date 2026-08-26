import type {Rect} from 'sn-plugin-lib';
import {rectHeight, rectWidth} from './supernoteTextboxGeometry';
import type {TextboxImportBlock} from './textboxImportParsing';
import {
  DEFAULT_TEXTBOX_MIN_HEIGHT,
  estimateHeightForRect,
  rectWithTopAndHeight,
  splitLargeTextBlock,
} from './supernoteTextboxPaginationCore';

export type TextboxBlockPageChunk = {
  text: string;
  rect: Rect;
  fontSize: number;
  fontPath?: string;
  bold?: boolean;
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
  addExplicitEmptyLineHeight?: boolean;
};

const DEFAULT_BLOCK_GAP = 18;

async function heightForText(params: {
  text: string;
  maxRect: Rect;
  fontSize: number;
  fontPath?: string;
  minHeight: number;
  addExplicitEmptyLineHeight?: boolean;
}): Promise<number> {
  return estimateHeightForRect({
    text: params.text,
    rect: params.maxRect,
    fontSize: params.fontSize,
    fontPath: params.fontPath,
    minHeight: params.minHeight,
    addExplicitEmptyLineHeight: params.addExplicitEmptyLineHeight,
  });
}

async function fitsEmptyPage(params: {
  text: string;
  maxRect: Rect;
  fontSize: number;
  fontPath?: string;
  minHeight: number;
  addExplicitEmptyLineHeight?: boolean;
}): Promise<boolean> {
  const height = await heightForText(params);
  return height <= rectHeight(params.maxRect);
}

function splitWords(text: string): string[] {
  return text.split(/\s+/).map(word => word.trim()).filter(Boolean);
}

async function splitIntoPageFittingPieces(params: {
  text: string;
  maxRect: Rect;
  fontSize: number;
  fontPath?: string;
  minHeight: number;
  addExplicitEmptyLineHeight?: boolean;
}): Promise<string[]> {
  const coarseParts = splitLargeTextBlock(params.text);
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
    });

  for (const part of coarseParts) {
    const candidate = buffer ? `${buffer} ${part}` : part;

    if (await tryFits(candidate)) {
      buffer = candidate;
      continue;
    }

    if (buffer) {
      pieces.push(buffer);
      buffer = '';
    }

    if (await tryFits(part)) {
      buffer = part;
      continue;
    }

    let wordBuffer = '';

    for (const word of splitWords(part)) {
      const wordCandidate = wordBuffer ? `${wordBuffer} ${word}` : word;

      if (await tryFits(wordCandidate)) {
        wordBuffer = wordCandidate;
        continue;
      }

      if (wordBuffer) {
        pieces.push(wordBuffer);
      }

      wordBuffer = word;
    }

    if (wordBuffer) {
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
  }) => {
    const height = Math.min(
      await heightForText({
        text: params.text,
        maxRect: options.maxRect,
        fontSize: params.fontSize,
        fontPath: options.fontPath,
        minHeight,
        addExplicitEmptyLineHeight: options.addExplicitEmptyLineHeight,
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
    });

    cursorTop = cursorTop + height + blockGap;
  };

  for (const block of options.blocks) {
    const blockHeight = await heightForText({
      text: block.text,
      maxRect: options.maxRect,
      fontSize: block.fontSize,
      fontPath: options.fontPath,
      minHeight,
      addExplicitEmptyLineHeight: options.addExplicitEmptyLineHeight,
    });

    if (blockHeight <= maxHeight) {
      await placeChunk({
        text: block.text,
        fontSize: block.fontSize,
        bold: block.bold,
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
    });

    for (const piece of pieces) {
      await placeChunk({
        text: piece,
        fontSize: block.fontSize,
        bold: block.bold,
      });
    }
  }

  if (currentPage.chunks.length > 0) {
    pages.push(currentPage);
  }

  return pages;
}