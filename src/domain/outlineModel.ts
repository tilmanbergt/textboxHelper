import {parseBlockTag} from './blockTag';
import type {ScannedTextBox} from './exportClassification';
import type {PageReview} from './manuscriptPages';

/**
 * The Manuscript Outline (technical-design-manuscript.md §5.1): every textbox of the note as one
 * block in reading order, with its status (kept in the plugin, by block tag) and the edits still
 * pending on it (from the pages the Review has read). Plain notes: each textbox is a block; a
 * heading is guessed by its style, as the DOCX export does. Pure.
 */

export type BlockStatus = 'open' | 'review' | 'final';

export const BLOCK_STATUSES: BlockStatus[] = ['open', 'review', 'final'];

export const STATUS_GLYPH: Record<BlockStatus, string> = {open: '○', review: '◐', final: '●'};
export const STATUS_LABEL: Record<BlockStatus, string> = {open: 'Open', review: 'Review', final: 'Final'};

export type OutlineBlock = {
  /** The block tag's id, else `page:numInPage` for this read only. */
  key: string;
  tagId: string | null;
  page: number;
  numInPage: number;
  text: string;
  firstLine: string;
  /** Empty when the block is short enough to show whole in its first line. */
  lastLine: string;
  heading: boolean;
  status: BlockStatus;
  /** Edits waiting on this block; null while its page is not read by the Review. */
  pendingEdits: number | null;
};

export type OutlineFilter = 'all' | 'pending' | BlockStatus;

/** About one line of a row: the text is cut at a word near this many characters. */
const LINE_CHARS = 64;

/** The start of a text, cut at a word, with "…" when cut. */
export function firstLineOf(text: string, chars = LINE_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= chars) {
    return flat;
  }
  const cut = flat.lastIndexOf(' ', chars);
  return `${flat.slice(0, cut > chars / 2 ? cut : chars)} …`;
}

/** The end of a text, cut at a word, with "…" before it; empty when the first line shows it all. */
export function lastLineOf(text: string, chars = LINE_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= chars) {
    return '';
  }
  const from = flat.length - chars;
  const cut = flat.indexOf(' ', from);
  return `… ${flat.slice(cut >= 0 && cut < from + chars / 2 ? cut + 1 : from)}`;
}

/** How many changes the Review lists on each textbox of the read pages: `page:numInPage` → count. */
export function pendingByTextbox(pages: Record<number, PageReview>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [key, review] of Object.entries(pages)) {
    if (review.state !== 'read') {
      continue;
    }
    for (const operation of review.preview.operations) {
      if (operation.targetTextboxUuid.startsWith('new:')) {
        continue;
      }
      const id = `${key}:${operation.targetTextboxNumInPage}`;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

export function buildOutline(
  items: ScannedTextBox[],
  statuses: Record<string, BlockStatus>,
  pages: Record<number, PageReview>,
): OutlineBlock[] {
  const pending = pendingByTextbox(pages);
  return items.map(item => {
    const tagId = parseBlockTag(item.userData)?.id ?? null;
    const place = `${item.page}:${item.numInPage}`;
    return {
      key: tagId ?? place,
      tagId,
      page: item.page,
      numInPage: item.numInPage,
      text: item.text,
      firstLine: firstLineOf(item.text),
      lastLine: lastLineOf(item.text),
      heading: item.role === 'heading',
      status: (tagId && statuses[tagId]) || 'open',
      pendingEdits: pages[item.page]?.state === 'read' ? pending.get(place) ?? 0 : null,
    };
  });
}

export function matchesFilter(block: OutlineBlock, filter: OutlineFilter): boolean {
  if (filter === 'all') {
    return true;
  }
  if (filter === 'pending') {
    return (block.pendingEdits ?? 0) > 0;
  }
  return block.status === filter;
}

export function filterCounts(blocks: OutlineBlock[]): Record<OutlineFilter, number> {
  const filters: OutlineFilter[] = ['all', 'pending', ...BLOCK_STATUSES];
  return Object.fromEntries(
    filters.map(filter => [filter, blocks.filter(block => matchesFilter(block, filter)).length]),
  ) as Record<OutlineFilter, number>;
}

/** The stored statuses: block id → status; anything unreadable is dropped. */
export function parseBlockStatuses(json: string | null): Record<string, BlockStatus> {
  if (!json) {
    return {};
  }
  try {
    const value = JSON.parse(json) as {statuses?: Record<string, unknown>};
    const result: Record<string, BlockStatus> = {};
    for (const [id, status] of Object.entries(value?.statuses ?? {})) {
      if (BLOCK_STATUSES.includes(status as BlockStatus)) {
        result[id] = status as BlockStatus;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/** The statuses as stored; "open" is the default and isn't stored. */
export function serializeBlockStatuses(statuses: Record<string, BlockStatus>): string {
  const kept = Object.fromEntries(Object.entries(statuses).filter(([, status]) => status !== 'open'));
  return JSON.stringify({version: 1, statuses: kept}, null, 2);
}
