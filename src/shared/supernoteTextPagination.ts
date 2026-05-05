import type {Rect} from 'sn-plugin-lib';
import {rectHeight, rectWidth} from './supernoteTextboxGeometry';
import {
  DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION,
  estimateTextboxHeight,
} from './supernoteTextboxLayout';

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

const DEFAULT_MIN_HEIGHT = 48;

function splitIntoParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean);
}

function splitLargeParagraph(paragraph: string): string[] {
  const sentences = paragraph
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(part => part.trim())
    .filter(Boolean);

  if (sentences.length > 1) {
    return sentences;
  }

  const words = paragraph.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;

    if (candidate.length > 900 && current) {
      chunks.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

async function estimateHeightForRect(params: {
  text: string;
  rect: Rect;
  fontSize: number;
  fontPath?: string;
  minHeight: number;
  addExplicitEmptyLineHeight?: boolean;
}): Promise<number> {
  const height = await estimateTextboxHeight(
    params.text,
    rectWidth(params.rect),
    params.fontSize,
    params.fontPath,
    DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION,
    params.addExplicitEmptyLineHeight,
  );

  return Math.max(params.minHeight, Math.ceil(height));
}

function withHeight(rect: Rect, height: number): Rect {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.top + height,
  };
}

export async function paginateTextIntoTextboxPages(
  options: TextboxPaginationOptions,
): Promise<TextboxPageChunk[]> {
  const maxHeight = rectHeight(options.maxRect);
  const minHeight = options.minHeight ?? DEFAULT_MIN_HEIGHT;

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

    for (const part of splitLargeParagraph(paragraph)) {
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