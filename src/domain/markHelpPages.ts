/**
 * How the edit-marker help is split into pages (technical-design-mark-help.md §4): the overview
 * of all marks first, then the marks with their pictures (two on a page when they fit, else
 * one), then the blocks about the review. Nothing scrolls, so every page must fit the measured
 * box. Text heights are estimated from the text length, generously, because the pages are fixed
 * before anything is drawn; ui/MarkHelp.tsx draws with the same sizes as `MARK_HELP_LAYOUT`.
 */
import type {HelpBlock, MarkHelpEntry} from './markHelp';

/** Sizes (dp) shared with ui/MarkHelp.tsx, so estimate and drawing agree. */
export const MARK_HELP_LAYOUT = {
  /** Body text: FONT.small with LINE_HEIGHT.small. */
  fontSize: 15,
  lineHeight: 20,
  /** A mark's name line, a block's title line, the page heading. */
  titleHeight: 26,
  headingHeight: 34,
  /** An overview row: icon box, name and the glance line. */
  rowHeight: 64,
  /** Between the parts of an entry, and between entries or blocks (with their line). */
  gap: 6,
  sectionGap: 14,
  /** Indent of the "Keep in mind" points. */
  bulletIndent: 18,
  /** Smallest picture height when a picture has to shrink to fit a page alone. */
  minPictureHeight: 80,
} as const;

/** Average character width as a share of the font size; on the generous side for a sans font. */
const CHAR_WIDTH = 0.55;

/** How many lines `text` takes at `width` (word wrap, estimated). */
export function estimateLines(text: string, width: number, fontSize: number = MARK_HELP_LAYOUT.fontSize): number {
  const perLine = Math.max(8, Math.floor(width / (fontSize * CHAR_WIDTH)));
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const length = word.length;
    if (used === 0) {
      used = Math.min(length, perLine);
      lines += Math.floor(Math.max(0, length - 1) / perLine);
    } else if (used + 1 + length <= perLine) {
      used += 1 + length;
    } else {
      lines += 1 + Math.floor(Math.max(0, length - 1) / perLine);
      used = Math.min(length, perLine);
    }
  }
  return lines;
}

/** The height of a mark's text below its picture: "Draw: …" and "Keep in mind:" with its points. */
export function entryTextHeight(entry: MarkHelpEntry, width: number): number {
  const L = MARK_HELP_LAYOUT;
  const draw = estimateLines(`Draw: ${entry.draw}`, width) * L.lineHeight;
  const keep = entry.keep.reduce<number>(
    (sum, point) => sum + estimateLines(point, width - L.bulletIndent) * L.lineHeight,
    L.lineHeight,
  );
  return draw + L.gap + keep;
}

export type PictureSize = {width: number; height: number};

export type PlacedEntry = {id: string; picture: PictureSize};

export type MarkHelpPage =
  | {kind: 'overview'; ids: string[]; first: boolean}
  | {kind: 'marks'; entries: PlacedEntry[]}
  | {kind: 'text'; blocks: HelpBlock[]};

/** The height of the two keys under the overview. */
export function overviewKeysHeight(keys: string[], width: number): number {
  const L = MARK_HELP_LAYOUT;
  // Each key sits right of a small badge.
  return keys.reduce<number>((sum, key) => sum + estimateLines(key, width - 70) * L.lineHeight + L.gap, L.gap);
}

/**
 * The pages for a box of `width` × `height` dp. `pictures` gives each mark's picture size at
 * its natural display width (already no wider than the box).
 */
export function markHelpPages(
  entries: MarkHelpEntry[],
  blocks: HelpBlock[],
  keys: string[],
  pictures: Record<string, PictureSize>,
  width: number,
  height: number,
): MarkHelpPage[] {
  const L = MARK_HELP_LAYOUT;
  const pages: MarkHelpPage[] = [];

  // Overview: as many rows as fit above the keys; more rows go on a second overview page.
  const rowRoom = height - L.headingHeight - overviewKeysHeight(keys, width);
  const perPage = Math.max(1, Math.floor(rowRoom / L.rowHeight));
  for (let start = 0; start < entries.length; start += perPage) {
    pages.push({kind: 'overview', ids: entries.slice(start, start + perPage).map(e => e.id), first: start === 0});
  }

  // Marks: greedy, in order; a mark that doesn't fit a page alone gets a smaller picture.
  const room = height - L.headingHeight;
  let current: PlacedEntry[] = [];
  let used = 0;
  for (const entry of entries) {
    const natural = pictures[entry.id] ?? {width: 0, height: 0};
    const text = entryTextHeight(entry, width);
    const fixed = L.titleHeight + L.gap + L.gap + text;
    let picture = natural;
    if (fixed + natural.height > room) {
      const shrunk = Math.max(L.minPictureHeight, room - fixed);
      const scale = natural.height > 0 ? Math.min(1, shrunk / natural.height) : 1;
      picture = {width: Math.floor(natural.width * scale), height: Math.floor(natural.height * scale)};
    }
    const own = fixed + picture.height;
    if (current.length > 0 && used + L.sectionGap + own > room) {
      pages.push({kind: 'marks', entries: current});
      current = [];
      used = 0;
    }
    used += (current.length > 0 ? L.sectionGap : 0) + own;
    current.push({id: entry.id, picture});
  }
  if (current.length > 0) {
    pages.push({kind: 'marks', entries: current});
  }

  // The review: blocks as they fit.
  let blockPage: HelpBlock[] = [];
  used = 0;
  for (const block of blocks) {
    const own = L.titleHeight + estimateLines(block.text, width) * L.lineHeight;
    if (blockPage.length > 0 && used + L.sectionGap + own > room) {
      pages.push({kind: 'text', blocks: blockPage});
      blockPage = [];
      used = 0;
    }
    used += (blockPage.length > 0 ? L.sectionGap : 0) + own;
    blockPage.push(block);
  }
  if (blockPage.length > 0) {
    pages.push({kind: 'text', blocks: blockPage});
  }
  return pages;
}

/** The page that shows a mark's picture, for the overview's "p. n ›". */
export function pageOfMark(pages: MarkHelpPage[], id: string): number {
  return pages.findIndex(page => page.kind === 'marks' && page.entries.some(entry => entry.id === id));
}
