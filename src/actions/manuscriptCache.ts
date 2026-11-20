import type {ScannedTextBox} from '../domain/exportClassification';
import type {EditMarkerPreview} from '../domain/markerTypes';

/**
 * What the Manuscript card read, kept in memory while the plugin's JS runs
 * (technical-design-manuscript-cache.md §3): each page's analysis with its fingerprint, and the
 * Outline's last scan, per note. What is shown from here is checked again before anything is
 * written (`markerApply.ts`, `outlineApply.ts` read their pages fresh).
 */

type CachedPage = {fingerprint: string; preview: EditMarkerPreview; readAt: number};

type CachedNote = {
  pageCount: number;
  pages: Map<number, CachedPage>;
  outline: ScannedTextBox[] | null;
};

const notes = new Map<string, CachedNote>();

/**
 * The note as cached; a different page count means the pages moved, so the note is forgotten.
 * Returns the pages cached for it (page → preview), in page order.
 */
export function openCachedNote(notePath: string, pageCount: number): Map<number, EditMarkerPreview> {
  const note = notes.get(notePath);
  if (!note || note.pageCount !== pageCount) {
    notes.set(notePath, {pageCount, pages: new Map(), outline: null});
    return new Map();
  }
  return new Map(
    [...note.pages]
      .sort(([a], [b]) => a - b)
      .map(([page, cached]) => [page, cached.preview]),
  );
}

export function cachedPage(notePath: string, page: number): CachedPage | null {
  return notes.get(notePath)?.pages.get(page) ?? null;
}

export function rememberPage(
  notePath: string,
  page: number,
  fingerprint: string,
  preview: EditMarkerPreview,
): void {
  const note = notes.get(notePath);
  if (note) {
    note.pages.set(page, {fingerprint, preview, readAt: Date.now()});
  }
}

/** Forgets pages (all of the note's when `pages` is left out), and its Outline scan with them. */
export function forgetPages(notePath: string, pages?: number[]): void {
  const note = notes.get(notePath);
  if (!note) {
    return;
  }
  if (pages) {
    pages.forEach(page => note.pages.delete(page));
  } else {
    note.pages.clear();
  }
  note.outline = null;
}

export function cachedOutline(notePath: string, pageCount: number): ScannedTextBox[] | null {
  const note = notes.get(notePath);
  return note && note.pageCount === pageCount ? note.outline : null;
}

export function rememberOutline(notePath: string, pageCount: number, items: ScannedTextBox[]): void {
  const note = notes.get(notePath);
  if (note && note.pageCount === pageCount) {
    note.outline = items;
  } else {
    notes.set(notePath, {pageCount, pages: new Map(), outline: items});
  }
}

export function forgetOutline(notePath: string): void {
  const note = notes.get(notePath);
  if (note) {
    note.outline = null;
  }
}

/** For the timings file: what is cached right now. */
export function cacheState(): {notes: number; pages: number; outlines: number} {
  let pages = 0;
  let outlines = 0;
  notes.forEach(note => {
    pages += note.pages.size;
    outlines += note.outline ? 1 : 0;
  });
  return {notes: notes.size, pages, outlines};
}

/** Tests only. */
export function clearCacheForTests(): void {
  notes.clear();
}
