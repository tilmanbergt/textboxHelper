import type {BlockTag} from '../blockTag';
import {isAsideDivider} from '../noteRegions';
import type {Rect} from '../textboxModel';

/**
 * Which paragraph a comment or an image belongs to (technical-design-comments-images.md §4). Pure.
 *
 * A note belongs to a paragraph of its own page, region (text or the aside area) and linked file:
 * the one whose height overlaps the note's most; with no overlap the nearest above the note's top
 * (a comment written below a paragraph belongs to it); with none above the nearest below.
 * Headings count as paragraphs. A paragraph the user chose (‹ ›) is stored as its block id and
 * wins while it is in the note; once it is gone, the nearest is taken and `gone` says so.
 *
 * Region and file follow position, as everywhere (`noteRegions.ts`, `fileSegments.ts`): a file
 * divider or the aside divider starts a section that runs to the next one in reading order. A
 * note's section is that of the textbox before it in reading order.
 */

export type Region = 'text' | 'aside';

/** A textbox a note may belong to: where it is, its block id, its section. */
export type ParagraphCandidate = {
  uuid: string;
  /** Its block id (`tbt:b:`), null when it has none yet. */
  blockId: string | null;
  page: number;
  rect: Rect;
  region: Region;
  /** The linked file it belongs to (its source id); null for none. */
  file: string | null;
};

export type NoteAt = {page: number; rect: Rect; region: Region; file: string | null};

export type ParagraphResult =
  | {uuid: string; blockId: string | null; by: 'stored' | 'nearest'; gone?: true}
  | {none: true; reason: string; gone?: true};

export const NO_PARAGRAPH = 'No paragraph on this page';

/** Reading order within a note: page, then top, then left (textboxes within 1 px share a row). */
export function readingOrder(a: {page: number; rect: Rect}, b: {page: number; rect: Rect}): number {
  if (a.page !== b.page) {
    return a.page - b.page;
  }
  const top = a.rect.top - b.rect.top;
  return Math.abs(top) > 1 ? top : a.rect.left - b.rect.left;
}

/** The section a textbox starts or continues. */
export type Section = {region: Region; file: string | null};

/**
 * Each item's section, in reading order, from the section before the first one (`carry`): a file
 * divider (`k: 'f'` with its source) starts its file; the aside divider starts the aside area,
 * which belongs to no file and runs to the end of the note.
 */
export function sectionsOf(tags: Array<BlockTag | null | undefined>, carry: Section): Section[] {
  let current = carry;
  return tags.map(tag => {
    if (isAsideDivider(tag)) {
      current = {region: 'aside', file: null};
    } else if (current.region === 'text' && tag?.k === 'f' && tag.s) {
      current = {region: 'text', file: tag.s};
    }
    return current;
  });
}

/** A note's section: that of the textbox before it in reading order, else of the first one after it. */
export function sectionAt(note: {page: number; rect: Rect}, candidates: ParagraphCandidate[], fallback: Section): Section {
  const ordered = [...candidates].sort(readingOrder);
  const before = ordered.filter(item => readingOrder(item, {page: note.page, rect: {...note.rect, left: Infinity}}) <= 0);
  const at = before[before.length - 1] ?? ordered[0];
  return at ? {region: at.region, file: at.file} : fallback;
}

/** How much two rects share in height (pixels; negative: the gap between them). */
function heightOverlap(a: Rect, b: Rect): number {
  return Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
}

/** The textboxes a note may belong to: same page, region and file. */
function sameSection(note: NoteAt, candidates: ParagraphCandidate[]): ParagraphCandidate[] {
  return candidates
    .filter(item => item.page === note.page && item.region === note.region && item.file === note.file)
    .sort(readingOrder);
}

/** The nearest paragraph by height, or none (§4). */
export function nearestParagraph(note: NoteAt, candidates: ParagraphCandidate[]): ParagraphCandidate | null {
  const near = sameSection(note, candidates);
  let best: ParagraphCandidate | null = null;
  let bestOverlap = 0;
  for (const item of near) {
    const overlap = heightOverlap(note.rect, item.rect);
    if (overlap > bestOverlap) {
      best = item;
      bestOverlap = overlap;
    }
  }
  if (best) {
    return best;
  }
  const above = near.filter(item => item.rect.bottom <= note.rect.top);
  if (above.length > 0) {
    return above.reduce((nearest, item) => (item.rect.bottom > nearest.rect.bottom ? item : nearest));
  }
  const below = near.filter(item => item.rect.top >= note.rect.bottom);
  return below.length > 0 ? below.reduce((nearest, item) => (item.rect.top < nearest.rect.top ? item : nearest)) : null;
}

/**
 * The paragraph of a note: the stored one while it is among `candidates` (any page), else the
 * nearest. `complete`: the candidates hold every textbox of the note, so a stored block not among
 * them is gone; otherwise the caller looks further before calling it gone.
 */
export function paragraphOf(note: NoteAt, candidates: ParagraphCandidate[], storedBlockId?: string): ParagraphResult {
  const stored = storedBlockId ? candidates.find(item => item.blockId === storedBlockId) : undefined;
  if (stored) {
    return {uuid: stored.uuid, blockId: stored.blockId, by: 'stored'};
  }
  const gone = storedBlockId ? {gone: true as const} : {};
  const nearest = nearestParagraph(note, candidates);
  return nearest
    ? {uuid: nearest.uuid, blockId: nearest.blockId, by: 'nearest', ...gone}
    : {none: true, reason: NO_PARAGRAPH, ...gone};
}

/**
 * What ‹ Paragraph above · Paragraph below › select (§4): the paragraphs before and after
 * `uuid` in reading order, in the same region and file, across page edges when the candidates
 * hold the neighbouring pages. Null at the start or end.
 */
export function neighbours(
  uuid: string,
  candidates: ParagraphCandidate[],
): {above: ParagraphCandidate | null; below: ParagraphCandidate | null} {
  const current = candidates.find(item => item.uuid === uuid);
  if (!current) {
    return {above: null, below: null};
  }
  const ordered = candidates
    .filter(item => item.region === current.region && item.file === current.file)
    .sort(readingOrder);
  const index = ordered.indexOf(current);
  return {above: ordered[index - 1] ?? null, below: ordered[index + 1] ?? null};
}
