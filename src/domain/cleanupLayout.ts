/**
 * Clean up layout (technical-design-settings-layout-files.md §2): lays a whole note or one linked
 * file out again from scratch — every block in the page layout's text area, full width, in its
 * style, with the layout's gap; a linked file's divider and headings of the levels set to break
 * start a new page. A block taller than the text area is cut into pieces that fit (as the import
 * does); pieces cut before are joined first, so they can become one textbox again. Pure.
 */
import {splitIntoPageFittingPieces} from './blockPagination';
import type {OutlineBlock} from './outlineModel';
import type {Placement} from './outlineLayout';
import {DEFAULT_TEXTBOX_MIN_HEIGHT, estimateHeightForRect, type MeasureTextboxHeight} from './paginationCore';
import type {Rect} from './textboxModel';

export type CleanupScope = {kind: 'note'} | {kind: 'file'; sourceId: string};

/** One textbox of the cleaned-up layout: its height and whether it starts a page. */
export type CleanupBox = {id: string; height: number; startsPage: boolean};

export type CleanupLayout = {
  placements: Map<string, Placement>;
  /** How many pages the scope fills, from its first page. */
  pageCount: number;
};

/**
 * The blocks a clean up lays out, in their (planned) order: the whole note without the blocks set
 * aside earlier, or a linked file from its divider to the next file's divider.
 */
export function blocksInScope(order: OutlineBlock[], scope: CleanupScope): OutlineBlock[] {
  const staying = order.filter(block => !block.aside);
  if (scope.kind === 'note') {
    return staying;
  }
  const start = staying.findIndex(block => block.fileSource === scope.sourceId);
  if (start < 0) {
    return [];
  }
  const next = staying.findIndex((block, index) => index > start && block.kind === 'file');
  return staying.slice(start, next < 0 ? staying.length : next);
}

/**
 * The blocks in groups that are one block of their file: a block and the pieces the import (or an
 * earlier clean up) cut from it right after it.
 */
export function pieceGroups(blocks: OutlineBlock[]): OutlineBlock[][] {
  const groups: OutlineBlock[][] = [];
  for (const block of blocks) {
    const last = groups[groups.length - 1];
    const head = last?.[0];
    if (head && block.piece > 0 && block.sourceBlock !== null && block.sourceBlock === head.sourceBlock) {
      last.push(block);
    } else {
      groups.push([block]);
    }
  }
  return groups;
}

/** The text of a group: its pieces joined with a space, as the file gets them. */
export function groupText(group: OutlineBlock[]): string {
  return group.map(block => block.text).join(' ');
}

/**
 * A text as textboxes that fit the area: one when it fits, else pieces. Each with its height,
 * measured in the area's width.
 */
export async function fitText(params: {
  text: string;
  area: Rect;
  fontSize: number;
  fontPath?: string;
  measureHeight: MeasureTextboxHeight;
}): Promise<Array<{text: string; height: number}>> {
  const measure = (text: string) =>
    estimateHeightForRect({
      text,
      rect: params.area,
      fontSize: params.fontSize,
      fontPath: params.fontPath,
      minHeight: DEFAULT_TEXTBOX_MIN_HEIGHT,
      addExplicitEmptyLineHeight: false,
      measureHeight: params.measureHeight,
    });
  const whole = await measure(params.text);
  if (whole <= params.area.bottom - params.area.top) {
    return [{text: params.text, height: whole}];
  }
  const pieces = await splitIntoPageFittingPieces({
    text: params.text,
    maxRect: params.area,
    fontSize: params.fontSize,
    fontPath: params.fontPath,
    minHeight: DEFAULT_TEXTBOX_MIN_HEIGHT,
    addExplicitEmptyLineHeight: false,
    measureHeight: params.measureHeight,
  });
  const fitted: Array<{text: string; height: number}> = [];
  for (const piece of pieces) {
    fitted.push({text: piece, height: Math.min(await measure(piece), params.area.bottom - params.area.top)});
  }
  return fitted;
}

/** The boxes stacked down the pages from `firstPage`, full width of the area. */
export function layoutCleanup(boxes: CleanupBox[], area: Rect, gap: number, firstPage: number): CleanupLayout {
  const placements = new Map<string, Placement>();
  let page = firstPage;
  let y = area.top;
  let first = true;
  for (const box of boxes) {
    if (!first && (box.startsPage || y + gap + box.height > area.bottom)) {
      page += 1;
      y = area.top;
      first = true;
    }
    const top = first ? area.top : y + gap;
    placements.set(box.id, {page, rect: {left: area.left, right: area.right, top, bottom: top + box.height}});
    y = top + box.height;
    first = false;
  }
  return {placements, pageCount: boxes.length === 0 ? 0 : page - firstPage + 1};
}

/**
 * The pages a clean up covers now: from the first block's page to the last one's; for a file up to
 * the page before the next file's divider (pages in between are its own).
 */
export function cleanupRange(
  scoped: OutlineBlock[],
  all: OutlineBlock[],
  scope: CleanupScope,
): {first: number; last: number} | null {
  if (scoped.length === 0) {
    return null;
  }
  const pages = scoped.map(block => block.page);
  const first = Math.min(...pages);
  let last = Math.max(...pages);
  if (scope.kind === 'file') {
    const next = all
      .filter(block => block.kind === 'file' && block.fileSource !== scope.sourceId && block.page > first)
      .map(block => block.page);
    if (next.length > 0) {
      last = Math.max(last, Math.min(...next) - 1);
    }
  }
  return {first, last};
}

/**
 * Whether a file can be cleaned up on its own: its divider is the first block on its page, so its
 * pages hold only its text (files imported before files started on a new page share pages).
 */
export function fileStartsPage(all: OutlineBlock[], sourceId: string): boolean {
  const at = all.findIndex(block => block.fileSource === sourceId);
  if (at < 0) {
    return false;
  }
  const before = all[at - 1];
  return !before || before.page !== all[at].page || before.aside;
}
