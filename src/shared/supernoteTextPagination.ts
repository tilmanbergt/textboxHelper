import type {Rect} from 'sn-plugin-lib';
import {rectHeight, rectWidth} from './supernoteTextboxGeometry';
import {
  DEFAULT_TEXTBOX_MIN_HEIGHT,
  estimateHeightForRect,
  splitLargeTextBlock,
  withHeight,
} from './supernoteTextboxPaginationCore';

export type TextboxPageChunk = {
  text: string;
  rect: Rect;
};

export type TextboxPaginationOptions = {
  text: string;
  maxRect: Rect;
  fontSize: number;
  fontPath?: string;
  minHeight?: number;
  addExplicitEmptyLineHeight?: boolean;
};

function splitIntoParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean);
}

export async function paginateTextIntoTextboxPages(
  options: TextboxPaginationOptions,
): Promise<TextboxPageChunk[]> {
  const maxHeight = rectHeight(options.maxRect);
  const minHeight = options.minHeight ?? DEFAULT_TEXTBOX_MIN_HEIGHT;

  if (rectWidth(options.maxRect) <= 0 || maxHeight <= 0) {
    throw new Error('Textbox pagination received an unusable rectangle.');
  }

  const paragraphs = splitIntoParagraphs(options.text);
  const pageTexts: string[] = [];
  let currentText = '';

  const fits = async (candidate: string): Promise<boolean> => {
    const height = await estimateHeightForRect({
      text: candidate,
      rect: options.maxRect,
      fontSize: options.fontSize,
      fontPath: options.fontPath,
      minHeight,
      addExplicitEmptyLineHeight: options.addExplicitEmptyLineHeight,
    });

    return height <= maxHeight;
  };

  for (const paragraph of paragraphs) {
    const candidate = currentText ? `${currentText}\n\n${paragraph}` : paragraph;

    if (await fits(candidate)) {
      currentText = candidate;
      continue;
    }

    if (currentText) {
      pageTexts.push(currentText);
      currentText = '';
    }

    if (await fits(paragraph)) {
      currentText = paragraph;
      continue;
    }

    let buffer = '';

    for (const part of splitLargeTextBlock(paragraph)) {
      const partCandidate = buffer ? `${buffer} ${part}` : part;

      if (await fits(partCandidate)) {
        buffer = partCandidate;
        continue;
      }

      if (buffer) {
        pageTexts.push(buffer);
      }

      buffer = part;
    }

    if (buffer) {
      currentText = buffer;
    }
  }

  if (currentText) {
    pageTexts.push(currentText);
  }

  const chunks: TextboxPageChunk[] = [];

  for (const text of pageTexts) {
    const height = await estimateHeightForRect({
      text,
      rect: options.maxRect,
      fontSize: options.fontSize,
      fontPath: options.fontPath,
      minHeight,
      addExplicitEmptyLineHeight: options.addExplicitEmptyLineHeight,
    });

    chunks.push({
      text,
      rect: withHeight(options.maxRect, Math.min(height, maxHeight)),
    });
  }

  return chunks;
}