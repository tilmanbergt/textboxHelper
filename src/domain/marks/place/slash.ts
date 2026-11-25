import type {CaretTextbox} from '../textboxView';
import {characterAt} from './exact';
import type {SlashShape} from '../shapes/slash';

/**
 * Where a slash through one letter acts (technical-design-mark-dialogue.md §7,
 * technical-design-fine-marks.md §4): the character it crosses at a line's middle. Alone it
 * deletes it; with tagged text after it, the text replaces it. Its shape is pass 1's
 * (`marks/shapes/slash.ts`). Pure.
 */

/** A slash at most this many line heights wide (a slanted one is wider than a letter). */
const SLASH_MAX_WIDTH_LINES = 1.6;

export const SLANTED_SLASH = 'The slash is slanted: check the letter.';

export type SlashPlace =
  | {kind: 'letter'; uuid: string; lineIndex: number; offset: number; uncertain?: string}
  | {kind: 'refused'; uuid: string; reason: string};

function averageCharWidth(words: CaretTextbox['words']): number {
  const chars = words.reduce((sum, word) => sum + Math.max(1, word.end - word.start), 0);
  const width = words.reduce((sum, word) => sum + (word.right - word.left), 0);
  return chars > 0 ? Math.max(4, width / chars) : 12;
}

/**
 * Which character of a measured textbox the slash marks: it must cross a line's middle, be of
 * that line's letter size (half to one and a half line heights tall, at most 1.6 line heights
 * wide), and cross a character there; one wider than two letters is uncertain. Null when it is no
 * slash on this textbox.
 */
export function placeSlash(slash: SlashShape, box: CaretTextbox): SlashPlace | null {
  for (const line of box.lines) {
    const height = Math.max(1, line.bottom - line.top);
    const centre = (line.top + line.bottom) / 2;
    const band = 0.15 * height;
    if (slash.rect.top > centre - band || slash.rect.bottom < centre + band) {
      continue;
    }
    const tall = slash.rect.bottom - slash.rect.top;
    const words = box.words.filter(word => word.lineIndex === line.index);
    if (words.length === 0 || tall < 0.5 * height || tall > 1.5 * height) {
      continue;
    }
    const wide = slash.rect.right - slash.rect.left;
    if (wide > SLASH_MAX_WIDTH_LINES * height) {
      continue;
    }
    // Where the slash crosses the line's middle.
    const {top, bottom} = slash;
    const t = bottom.y === top.y ? 0.5 : (centre - top.y) / (bottom.y - top.y);
    const x = top.x + (bottom.x - top.x) * Math.min(1, Math.max(0, t));
    const offset = characterAt(words, x);
    if (offset === null || /\s/.test(box.text.charAt(offset))) {
      return {
        kind: 'refused',
        uuid: box.uuid,
        reason: 'A slash marks one letter; to join two words, use the close-up arc.',
      };
    }
    return {
      kind: 'letter',
      uuid: box.uuid,
      lineIndex: line.index,
      offset,
      ...(wide > 2 * averageCharWidth(words) ? {uncertain: SLANTED_SLASH} : {}),
    };
  }
  return null;
}
