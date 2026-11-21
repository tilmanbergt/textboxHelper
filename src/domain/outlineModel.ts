import {parseBlockTag, type BlockTag} from './blockTag';
import {headingLevelOf, type HeadingLevel} from './headingText';
import type {Rect} from './textboxModel';
import type {ScannedTextBox} from './exportClassification';
import type {PageReview} from './manuscriptPages';

/**
 * The Manuscript Outline (technical-design-manuscript.md §5.1): every textbox of the note as one
 * block in reading order, with its status (kept in the plugin, by block tag) and the edits still
 * pending on it (from the pages the Review has read).
 *
 * What a block is (technical-design-outline-sections.md §1.2), first match wins: a linked file's
 * divider (its tag) starts the file's section; a text starting with `#`s is a heading of that
 * level; a heading of a note linked before the `#`s stayed on the page counts by its file's record;
 * a textbox under a NOTE title is a heading of the default level; everything else is a paragraph.
 * The textbox's look never decides. Pure.
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
  /** Where it is on its page (layout of a rebuild). */
  rect: Rect;
  text: string;
  firstLine: string;
  /** Empty when the block is short enough to show whole in its first line. */
  lastLine: string;
  kind: OutlineBlockKind;
  /** File 0, heading 1–3, paragraph null. */
  level: number | null;
  /** A linked file's divider (its name under a title): the file's source id. */
  fileSource: string | null;
  /** Set aside by the Outline earlier: on the pages at the end, left out of a linked file. */
  aside: boolean;
  /** A linked block: its file and block (`source:index`), so pieces of one block go together. */
  sourceBlock: string | null;
  /** Which piece of its block (0 for the first or only one). */
  piece: number;
  /** A protected block's placeholder: keeps its own style. */
  placeholder: boolean;
  status: BlockStatus;
  /** Edits waiting on this block; null while its page is not read by the Review. */
  pendingEdits: number | null;
};

export type OutlineBlockKind = 'file' | 'heading' | 'paragraph';

/** What the Outline shows: everything, blocks with edits waiting, blocks not final yet. */
export type OutlineFilter = 'all' | 'edits' | 'notFinal';

export const OUTLINE_FILTERS: OutlineFilter[] = ['all', 'edits', 'notFinal'];

/** How blocks are told apart beyond their text (technical-design-outline-sections.md §1.2). */
export type OutlineOptions = {
  /** The level of a textbox under a NOTE title without `#`s. */
  defaultLevel: HeadingLevel;
  /** A heading's level from its linked file's record, for notes linked before the `#`s stayed. */
  recordLevel?: (tag: BlockTag) => number | null;
};

export const DEFAULT_OUTLINE_OPTIONS: OutlineOptions = {defaultLevel: 1};

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
  options: OutlineOptions = DEFAULT_OUTLINE_OPTIONS,
): OutlineBlock[] {
  const pending = pendingByTextbox(pages);
  return items.map(item => {
    const tag = parseBlockTag(item.userData);
    const tagId = tag?.id ?? null;
    const place = `${item.page}:${item.numInPage}`;
    const fileSource = tag?.k === 'f' && tag.s ? tag.s : null;
    const level = fileSource ? 0 : headingLevel(item, tag, options);
    return {
      key: tagId ?? place,
      tagId,
      page: item.page,
      numInPage: item.numInPage,
      rect: item.rect ?? {left: 0, top: 0, right: 0, bottom: 0},
      text: item.text,
      firstLine: firstLineOf(item.text),
      lastLine: lastLineOf(item.text),
      kind: fileSource ? 'file' : level ? 'heading' : 'paragraph',
      level: fileSource ? 0 : level || null,
      fileSource,
      aside: tag?.a === 1,
      sourceBlock: tag?.s && tag.i !== undefined ? `${tag.s}:${tag.i}` : null,
      piece: tag?.p ?? 0,
      placeholder: tag?.k === 'x',
      status: (tagId && statuses[tagId]) || 'open',
      pendingEdits: pages[item.page]?.state === 'read' ? pending.get(place) ?? 0 : null,
    };
  });
}

function headingLevel(item: ScannedTextBox, tag: BlockTag | null, options: OutlineOptions): number {
  const own = headingLevelOf(item.text);
  if (own) {
    return own;
  }
  const recorded = tag && options.recordLevel ? options.recordLevel(tag) : null;
  if (recorded) {
    return Math.min(3, Math.max(1, recorded));
  }
  return item.underTitle ? options.defaultLevel : 0;
}

/** How deep a block starts a section: a file 0, a heading its level; a paragraph starts none. */
export function rank(block: Pick<OutlineBlock, 'kind' | 'level'>): number {
  return block.kind === 'paragraph' ? Infinity : block.level ?? Infinity;
}

export function matchesFilter(block: OutlineBlock, filter: OutlineFilter): boolean {
  if (filter === 'edits') {
    return (block.pendingEdits ?? 0) > 0;
  }
  if (filter === 'notFinal') {
    return block.status !== 'final';
  }
  return true;
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
