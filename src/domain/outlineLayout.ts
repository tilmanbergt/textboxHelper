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
 * untouched.
 *
 * A note with an aside area (technical-design-aside-area.md §3.1) is laid out in two parts: the
 * text, and the aside area after it (`layoutNote`). Text that grows past its last page gets new
 * pages inserted before the aside area's first page, so it never flows into the area and the
 * area's pages move down whole. Pure.
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

/** A block of the note with the part it is in now. */
export type NoteLayoutBlock = LayoutBlock & {aside: boolean};

export type NoteRebuild = {
  /** New place of every block on the rebuilt pages, in page numbers after the inserted pages. */
  placements: Map<string, Placement>;
  /** Pages of the note as it is now that are rebuilt (read, then rewritten). */
  pages: number[];
  /** Pages inserted at `insertAt` (the aside area's first page): text that grew, a new divider's page. */
  insertAt: number;
  insertCount: number;
  /** Pages added at the end of the note. */
  appendCount: number;
  /** The page (after the inserts) given to a new aside divider of its own (`newDividerPage`). */
  dividerPage: number | null;
};

/** A page number of the note as it is now, after the rebuild's inserted pages. */
export function shiftedPage(rebuild: Pick<NoteRebuild, 'insertAt' | 'insertCount'>, page: number): number {
  return page >= rebuild.insertAt ? page + rebuild.insertCount : page;
}

/**
 * The rebuild of a note in its two parts. `original`: every block in reading order with `aside`
 * for the blocks of the aside area now; `order`: the keys that stay, as planned; `asideFrom`: where
 * the aside area starts in `order` (`order.length` without one). A block moved from the aside area
 * into the text counts for the text as if it came from just after the text's end.
 * `newDividerPage`: a note set aside before the divider existed gets a page of its own for the
 * divider, before its aside area. Falls back to one part when the text and the aside area share a
 * page (moved there by hand). Null when nothing changes.
 */
export function layoutNote(
  original: NoteLayoutBlock[],
  order: string[],
  asideFrom: number,
  frame: PageFrame,
  pageCount: number,
  heights: Map<string, number> = new Map(),
  newDividerPage = false,
): NoteRebuild | null {
  const asideBlocks = original.filter(block => block.aside);
  const asideFirst = asideBlocks.length > 0 ? Math.min(...asideBlocks.map(block => block.page)) : pageCount;
  const shared = original.some(block => !block.aside && block.page >= asideFirst);
  if (asideBlocks.length === 0 || shared) {
    const whole = layoutRebuild(original, order, frame, pageCount, heights);
    return whole
      ? {
          placements: whole.placements,
          pages: whole.pages.filter(page => page < pageCount),
          insertAt: pageCount,
          insertCount: 0,
          appendCount: whole.newPages,
          dividerPage: null,
        }
      : null;
  }

  const byKey = new Map(original.map(block => [block.key, block]));
  const textKeys = order.slice(0, asideFrom);
  const asideKeys = order.slice(asideFrom);

  // Blocks moved back into the text come, for the text's layout, from just after its end.
  const lastTextPage = Math.max(0, asideFirst - 1);
  const entering = textKeys
    .map(key => byKey.get(key) as NoteLayoutBlock)
    .filter(block => block.aside)
    .map(block => ({...block, page: lastTextPage, aside: false}));
  const textOriginal = [...original.filter(block => !block.aside), ...entering];
  // A block that comes in always changes place, even where the order alone looks the same.
  const textHeights = new Map(heights);
  entering.forEach(block => textHeights.set(block.key, heights.get(block.key) ?? block.rect.bottom - block.rect.top));
  const text = layoutRebuild(textOriginal, textKeys, frame, asideFirst, textHeights);
  const grown = text?.newPages ?? 0;
  const insertCount = grown + (newDividerPage ? 1 : 0);

  const aside = layoutRebuild(asideBlocks, asideKeys, frame, pageCount, heights);
  if (!text && !aside && !newDividerPage) {
    return null;
  }
  const placements = new Map(text?.placements ?? []);
  for (const [key, place] of aside?.placements ?? []) {
    placements.set(key, {...place, page: place.page >= asideFirst ? place.page + insertCount : place.page});
  }
  const pages = [
    ...new Set([
      ...(text?.pages ?? []).filter(page => page < asideFirst),
      ...(aside?.pages ?? []).filter(page => page < pageCount),
    ]),
  ].sort((a, b) => a - b);
  return {
    placements,
    pages,
    insertAt: asideFirst,
    insertCount,
    appendCount: aside?.newPages ?? 0,
    dividerPage: newDividerPage ? asideFirst + grown : null,
  };
}
