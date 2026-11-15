import type {Rect} from 'sn-plugin-lib';
import {rectWidth} from './supernoteTextboxGeometry';
import {
  DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION,
  estimateTextboxHeight,
} from './supernoteTextboxLayout';

export const DEFAULT_TEXTBOX_MIN_HEIGHT = 48;

export function splitLargeTextBlock(text: string): string[] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(part => part.trim())
    .filter(Boolean);

  if (sentences.length > 1) {
    return sentences;
  }

  const words = text.split(/\s+/).filter(Boolean);
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

export async function estimateHeightForRect(params: {
  text: string;
  rect: Rect;
  fontSize: number;
  fontPath?: string;
  minHeight?: number;
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

  return Math.max(
    params.minHeight ?? DEFAULT_TEXTBOX_MIN_HEIGHT,
    Math.ceil(height),
  );
}

export function rectWithTopAndHeight(
  rect: Rect,
  top: number,
  height: number,
): Rect {
  return {
    left: rect.left,
    top,
    right: rect.right,
    bottom: top + height,
  };
}

export function withHeight(rect: Rect, height: number): Rect {
  return rectWithTopAndHeight(rect, rect.top, height);
}
