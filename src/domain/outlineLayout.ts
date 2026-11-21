import type {Rect} from './textboxModel';

/**
 * Where the textboxes go when the Outline's planned changes are applied
 * (technical-design-manuscript.md §5.4). Every block keeps its size, its left edge and the gap
 * above it (within limits); a heading whose new level makes it taller brings its new height
 * (`heights`, measured by the caller) and counts as changed there. From the first page a change
 * touches, blocks are stacked down the pages in their new order; a block that doesn't fit goes to
 * the next page, and a block that starts a page (a linked file's divider, a heading of a level set to
 * break, technical-design-settings-layout-files.md §1) begins the next one. Blocks are never pulled up from a page past the changes (a gap stays), and the
 * rebuild stops at the first page from which everything is as before, so pages further on stay
 * untouched. Pure.
 */

export type LayoutBlock = {
  key: string;
  page: number;
  rect: Rect;
  /** Starts a new page when it isn't first on one. */
  startsPage?: boolean;
};

/** The part of a page textboxes are stacked in. */
export type PageFrame = {top: number; bottom: number};

export type Placement = {page: number; rect: Rect};

export type RebuildLayout = {
  /** New place of every block on the rebuilt pages (also of those that stay where they are). */
  placements: Map<string, Placement>;
  /** The pages rebuilt, in order; pages past the note's end are new pages. */
  pages: number[];
  /** How many pages have to be added at the end of the note. */
  newPages: number;
};

const MIN_GAP = 8;
const MAX_GAP = 120;
const DEFAULT_GAP = 24;

const height = (rect: Rect) => rect.bottom - rect.top;

/**
 * The gap above each block: as on its page, within limits. A block that was first on its page has
 * no gap of its own; it gets the note's usual gap (the median), for when it lands below another.
 */
function gapsAbove(blocks: LayoutBlock[]): Map<string, number> {
  const clampGap = (gap: number) => Math.min(MAX_GAP, Math.max(MIN_GAP, gap));
  const own = blocks.map((block, index) => {
    const before = blocks[index - 1];
    return before && before.page === block.page
      ? clampGap(block.rect.top - before.rect.bottom)
      : null;
  });
  const known = own
    .filter((gap): gap is number => gap !== null)
    .sort((x, y) => x - y);
  const usual =
    known.length > 0 ? known[Math.floor(known.length / 2)] : DEFAULT_GAP;
  return new Map(
    blocks.map((block, index) => [block.key, own[index] ?? usual]),
  );
}

/**
 * `original`: every block of the note in reading order. `order`: the keys of the blocks that stay
 * in the text, in their new order (set-aside and deleted blocks are left out). Null when nothing
 * changes.
 */
export function layoutRebuild(
  original: LayoutBlock[],
  order: string[],
  frame: PageFrame,
  pageCount: number,
  heights: Map<string, number> = new Map(),
): RebuildLayout | null {
  const resized = (block: LayoutBlock): LayoutBlock => {
    const next = heights.get(block.key);
    return next === undefined ? block : {...block, rect: {...block.rect, bottom: block.rect.top + next}};
  };
  const byKey = new Map(original.map(block => [block.key, resized(block)]));
  const staying = new Set(order);
  const originalStaying = original
    .filter(block => staying.has(block.key))
    .map(block => block.key);
  const removedPages = original
    .filter(block => !staying.has(block.key))
    .map(block => block.page);

  // The first place where the new order differs from the old one, and the last.
  let firstDiff = order.findIndex(
    (key, index) => key !== originalStaying[index],
  );
  let lastDiff = -1;
  order.forEach((key, index) => {
    if (key !== originalStaying[index] || heights.has(key)) {
      lastDiff = index;
      if (firstDiff < 0 || index < firstDiff) {
        firstDiff = index;
      }
    }
  });
  if (firstDiff < 0 && removedPages.length === 0) {
    return null;
  }
  if (firstDiff < 0) {
    firstDiff = order.length;
  }
  const diffPages = [
    order[firstDiff] !== undefined
      ? byKey.get(order[firstDiff])?.page
      : undefined,
    originalStaying[firstDiff] !== undefined
      ? byKey.get(originalStaying[firstDiff])?.page
      : undefined,
  ].filter((page): page is number => page !== undefined);
  const firstPage = Math.min(...diffPages, ...removedPages);
  const lastTouchedPage = Math.max(
    ...removedPages,
    ...order
      .slice(firstDiff, lastDiff + 1)
      .map(key => byKey.get(key)?.page ?? 0),
    firstPage,
  );

  const gaps = gapsAbove(original);
  const start = order.findIndex(
    (key, index) =>
      index >= firstDiff || (byKey.get(key)?.page ?? 0) >= firstPage,
  );
  const placements = new Map<string, Placement>();
  let page = firstPage;
  let y = frame.top;
  let firstOnPage = true;

  for (
    let index = start < 0 ? order.length : start;
    index < order.length;
    index++
  ) {
    const block = byKey.get(order[index]) as LayoutBlock;
    const gap = firstOnPage ? 0 : gaps.get(block.key) ?? MIN_GAP;
    // Nothing moves up from a page past the changes: such a block starts its own page again.
    const untouchedLater =
      index > lastDiff && block.page > lastTouchedPage && block.page > page;
    if (
      untouchedLater ||
      (!firstOnPage && (block.startsPage || y + gap + height(block.rect) > frame.bottom))
    ) {
      page = untouchedLater ? block.page : page + 1;
      y = frame.top;
      firstOnPage = true;
      // From here on, is everything as before? Then the rebuild ends before this page.
      const rest = order.slice(index);
      const before = original
        .filter(item => item.page >= page)
        .map(item => item.key);
      if (
        page > lastTouchedPage &&
        index > lastDiff &&
        rest.join('|') === before.join('|')
      ) {
        return finish(placements, firstPage, page - 1, pageCount);
      }
    }
    const top = firstOnPage ? frame.top : y + gap;
    placements.set(block.key, {
      page,
      rect: {
        left: block.rect.left,
        right: block.rect.right,
        top,
        bottom: top + height(block.rect),
      },
    });
    y = top + height(block.rect);
    firstOnPage = false;
  }
  return finish(
    placements,
    firstPage,
    Math.max(page, lastTouchedPage),
    pageCount,
  );
}

function finish(
  placements: Map<string, Placement>,
  first: number,
  last: number,
  pageCount: number,
): RebuildLayout {
  const pages = Array.from(
    {length: last - first + 1},
    (_, index) => first + index,
  );
  return {placements, pages, newPages: Math.max(0, last + 1 - pageCount)};
}

/** Set-aside blocks stacked from the top of new pages after `afterPage`. */
export function layoutAside(
  blocks: LayoutBlock[],
  frame: PageFrame,
  afterPage: number,
): Map<string, Placement> {
  const placements = new Map<string, Placement>();
  let page = afterPage + 1;
  let y = frame.top;
  blocks.forEach(block => {
    const h = height(block.rect);
    if (y > frame.top && y + MIN_GAP * 3 + h > frame.bottom) {
      page += 1;
      y = frame.top;
    }
    const top = y === frame.top ? y : y + MIN_GAP * 3;
    placements.set(block.key, {
      page,
      rect: {
        left: block.rect.left,
        right: block.rect.right,
        top,
        bottom: top + h,
      },
    });
    y = top + h;
  });
  return placements;
}
