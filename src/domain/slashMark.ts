import type {CaretTextbox, Point} from './penEditCaret';
import {characterAt} from './exactBounds';
import type {Rect} from './textboxModel';

/**
 * The slash through one letter (technical-design-fine-marks.md §4): a short, steep, straight
 * stroke across a line marks exactly the character it crosses. Alone it deletes it; with tagged
 * text after it, the text replaces it. Pure.
 */

export type SlashShape = {rect: Rect; top: Point; bottom: Point};

/** The slash's angle to the horizontal, at least. */
const SLASH_MIN_ANGLE_DEG = 45;
const SLASH_MIN_STRAIGHTNESS = 0.85;

function pathLength(points: Point[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return length;
}

/** A short, steep, fairly straight stroke: a possible slash. Its size is checked against a line. */
export function analyzeSlash(points: Point[]): SlashShape | null {
  if (points.length < 2) {
    return null;
  }
  const first = points[0];
  const last = points[points.length - 1];
  const direct = Math.hypot(last.x - first.x, last.y - first.y);
  if (direct < 10 || pathLength(points) > direct / SLASH_MIN_STRAIGHTNESS) {
    return null;
  }
  const angle = (Math.atan2(Math.abs(last.y - first.y), Math.abs(last.x - first.x)) * 180) / Math.PI;
  if (angle < SLASH_MIN_ANGLE_DEG) {
    return null;
  }
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const rect = {left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys)};
  const [top, bottom] = first.y <= last.y ? [first, last] : [last, first];
  return {rect, top: {...top}, bottom: {...bottom}};
}

/**
 * A slash's shape from its bounding rect alone, for the tag's look-back (which reads no points):
 * tall and narrow (at most 0.6 as wide as tall: handwriting and loops are wider), of a letter's
 * size.
 */
export function isSlashSizedRect(rect: Rect): boolean {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  return height >= 18 && height <= 130 && width <= height * 0.6;
}

export type SlashPlace =
  | {kind: 'letter'; uuid: string; lineIndex: number; offset: number}
  | {kind: 'refused'; uuid: string; reason: string};

function averageCharWidth(words: CaretTextbox['words']): number {
  const chars = words.reduce((sum, word) => sum + Math.max(1, word.end - word.start), 0);
  const width = words.reduce((sum, word) => sum + (word.right - word.left), 0);
  return chars > 0 ? Math.max(4, width / chars) : 12;
}

/**
 * Which character of a measured textbox the slash marks: it must cross a line's middle, be of
 * that line's letter size (half to one and a half line heights tall, at most two letters wide),
 * and cross a character there. Null when it is no slash on this textbox.
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
    if (slash.rect.right - slash.rect.left > 2 * averageCharWidth(words)) {
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
    return {kind: 'letter', uuid: box.uuid, lineIndex: line.index, offset};
  }
  return null;
}
