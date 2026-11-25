import {splitChangeText} from './paragraphMarks';
import type {Rect} from './textboxModel';
import type {CaretInsertMode} from './marks/place/point';

/**
 * The text side of an insertion at a caret (technical-design-pen-edits.md §8, As built): how the
 * new text joins the words around it, and where new paragraphs between two others go and what
 * moves down for them. The caret's shape is `marks/shapes/caret.ts`, its place
 * `marks/place/point.ts`. Pure.
 */

const NO_SPACE_BEFORE = /^[.,;:!?)\]}»“”'’]/;
const NO_SPACE_AFTER = /[([{„«“‘'"]$/;

/**
 * The text to put in at `offset`, with the spaces it needs: as written inside a word, between
 * spaces at a word's edge, as its own paragraph on a blank line.
 */
export function caretInsertionText(
  original: string,
  offset: number,
  inserted: string,
  mode: CaretInsertMode,
): string {
  const text = inserted.trim();
  if (!text) {
    return '';
  }
  if (mode === 'inWord') {
    return text;
  }
  if (mode === 'paragraph') {
    return splitChangeText(text);
  }
  if (mode === 'blankLine') {
    return `\n${text}\n`;
  }
  const left = original.slice(0, offset);
  const right = original.slice(offset);
  const before =
    left.length > 0 &&
    !/\s$/.test(left) &&
    !NO_SPACE_AFTER.test(left) &&
    !NO_SPACE_BEFORE.test(text)
      ? ' '
      : '';
  const after =
    right.length > 0 && !/^\s/.test(right) && !NO_SPACE_BEFORE.test(right)
      ? ' '
      : '';
  return `${before}${text}${after}`;
}

/** One textbox (or new paragraph) that may move down, by its key. */
export type ReflowItem = {key: string; rect: Rect};
/**
 * Something that grows at `y` by `delta` in the columns between `left` and `right`. The items in
 * `sourceKeys` are the ones growing (or put in) and don't move because of it.
 */
export type ReflowEvent = {
  y: number;
  left: number;
  right: number;
  delta: number;
  sourceKeys: string[];
};

/**
 * How far each item moves down: the sum of the growth above it in its column (a paragraph that
 * got longer, a new paragraph put in). Items never move up.
 */
export function planReflow(
  items: ReflowItem[],
  events: ReflowEvent[],
): Map<string, number> {
  const shifts = new Map<string, number>();
  for (const item of items) {
    let dy = 0;
    for (const event of events) {
      if (
        !event.sourceKeys.includes(item.key) &&
        event.delta > 0 &&
        event.y <= item.rect.top + 2 &&
        Math.min(event.right, item.rect.right) >
          Math.max(event.left, item.rect.left)
      ) {
        dy += event.delta;
      }
    }
    if (dy > 0) {
      shifts.set(item.key, Math.round(dy));
    }
  }
  return shifts;
}

/** A new paragraph put in between two others, before its top is known. */
export type GapParagraph = {
  key: string;
  group: string;
  left: number;
  width: number;
  height: number;
  above: Rect | null;
  below: Rect | null;
};

/**
 * Places new paragraphs in their gaps: those sharing a gap follow each other in the given order,
 * spaced like the gap was, and push the paragraph below once by what they need together.
 */
export function placeGapParagraphs(paragraphs: GapParagraph[]): {
  rects: Map<string, Rect>;
  events: ReflowEvent[];
} {
  const rects = new Map<string, Rect>();
  const events: ReflowEvent[] = [];
  const groups = new Map<string, GapParagraph[]>();
  paragraphs.forEach(paragraph =>
    groups.set(paragraph.group, [
      ...(groups.get(paragraph.group) ?? []),
      paragraph,
    ]),
  );
  for (const members of groups.values()) {
    const first = members[0];
    // The gap's own spacing, kept between every pair of paragraphs in it.
    const spacing = gapParagraphPlacement(first.above, first.below, 0).spacing;
    let top = first.above
      ? first.above.bottom + spacing
      : (first.below as Rect).top;
    const firstTop = top;
    let lastBottom = top;
    for (const member of members) {
      const rect = {
        left: member.left,
        top: Math.round(top),
        right: member.left + member.width,
        bottom: Math.round(top + member.height),
      };
      rects.set(member.key, rect);
      lastBottom = rect.bottom;
      top = rect.bottom + spacing;
    }
    const push = first.below
      ? Math.max(0, Math.round(lastBottom + spacing - first.below.top))
      : 0;
    if (push > 0) {
      events.push({
        y: Math.round(firstTop),
        left: first.left,
        right: first.left + first.width,
        delta: push,
        sourceKeys: members.map(member => member.key),
      });
    }
  }
  return {rects, events};
}

/** Default space between paragraphs when there is no paragraph below to copy it from. */
export const DEFAULT_PARAGRAPH_GAP_PX = 24;

/**
 * Where a new paragraph between `above` and `below` goes, and how far it pushes the paragraphs
 * below: it keeps the space the two had (within limits) on both its sides.
 */
export function gapParagraphPlacement(
  above: Rect | null,
  below: Rect | null,
  height: number,
): {top: number; spacing: number; pushBelow: number} {
  const rawGap =
    above && below ? below.top - above.bottom : DEFAULT_PARAGRAPH_GAP_PX;
  const spacing = Math.min(60, Math.max(8, rawGap));
  const top = above ? above.bottom + spacing : (below as Rect).top;
  const pushBelow = below ? Math.max(0, top + height + spacing - below.top) : 0;
  return {top: Math.round(top), spacing, pushBelow: Math.round(pushBelow)};
}
