import type {Rect, TextElementData} from './textboxModel';

/**
 * Where an insertion goes (technical-design-pen-edits.md §3.7): a new textbox at the place the
 * snippet was written, styled like the paragraph above it. Nothing is pushed down; an overlap
 * with the paragraph below is reported for the review.
 */

export type InsertionPlacement<T extends TextElementData = TextElementData> = {
  /** The textbox the new one copies its column and style from. */
  styleSource: T;
  above: T | null;
  below: T | null;
  /** Left, top and width of the new textbox; its height comes from measuring the text. */
  left: number;
  top: number;
  width: number;
};

function overlapsHorizontally(a: Rect, b: Rect): boolean {
  return Math.min(a.right, b.right) > Math.max(a.left, b.left);
}

/**
 * `textboxes` in reading order. Above = the last one that starts above the snippet and shares
 * columns with it; below = the first one that starts at or below the snippet top. Null when
 * there is no textbox to take a style from.
 */
export function placeInsertion<T extends TextElementData>(snippet: Rect, textboxes: T[]): InsertionPlacement<T> | null {
  const inColumn = textboxes.filter(textbox => overlapsHorizontally(textbox.textBox.textRect, snippet));
  let above: T | null = null;
  let below: T | null = null;
  for (const textbox of inColumn) {
    if (textbox.textBox.textRect.top < snippet.top) {
      above = textbox;
    } else if (!below) {
      below = textbox;
    }
  }
  const styleSource = above ?? below;
  if (!styleSource) {
    return null;
  }
  const rect = styleSource.textBox.textRect;
  return {
    styleSource,
    above,
    below,
    left: rect.left,
    top: Math.round(snippet.top),
    width: rect.right - rect.left,
  };
}

/** How far a new textbox from `top` with `height` reaches into the textbox below; 0 when it doesn't. */
export function overlapWithBelow(top: number, height: number, below: TextElementData | null): number {
  if (!below) {
    return 0;
  }
  return Math.max(0, Math.round(top + height - below.textBox.textRect.top));
}
