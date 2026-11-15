import type {Rect} from './textboxModel';
import {rectWidth} from './geometry';

export const DEFAULT_TEXTBOX_MIN_HEIGHT = 48;

/**
 * Measures the height a textbox needs for a text at a width. The pagination gets it passed in, so
 * it stays free of the device: the plugin passes `measureTextboxHeight` from
 * `src/supernote/textboxMetrics.ts`, tests pass a fake.
 */
export type MeasureTextboxHeight = (
  text: string,
  width: number,
  fontSize: number,
  fontPath: string | undefined,
  addExplicitEmptyLineHeight: boolean | undefined,
) => Promise<number>;

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
  measureHeight: MeasureTextboxHeight;
}): Promise<number> {
  const height = await params.measureHeight(
    params.text,
    rectWidth(params.rect),
    params.fontSize,
    params.fontPath,
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
