import type {
  ChangeHunk,
  EditMarkerApplyPlan,
  EditMarkerPreview,
  RecognizedEditOperation,
} from './markerTypes';
import type {ToDecideItem} from './marks/toDecide';
import type {NoteRow} from './notes/noteRows';
import {plural} from './plural';

/**
 * The Manuscript card across the whole note (technical-design-manuscript.md §4.2): which pages are
 * read, and their changes as one list. A page is read when the card opens (the current one), when
 * its chip is tapped, or with "Read n pages"; the rest show "?" until then. Pure.
 */

export type PageReview =
  | {state: 'unread'}
  | {state: 'reading'}
  | {state: 'read'; preview: EditMarkerPreview}
  | {state: 'failed'; message: string};

/** One change in the card's list, with the page it is on. */
export type ManuscriptEntry = {
  key: string;
  page: number;
  hunk: ChangeHunk;
  operation: RecognizedEditOperation;
};

/** One item of To decide in the card's list, with the page it is on. */
export type DecideEntry = {key: string; page: number; item: ToDecideItem};

/** A comment or image in the card's Notes tab (technical-design-comments-images.md §5.2). */
export type NoteEntry = {key: string; page: number; row: NoteRow};

export type ManuscriptView = {
  entries: ManuscriptEntry[];
  toDecide: DecideEntry[];
  /** The comments and images of every read page. */
  notes: NoteEntry[];
  /** The ready changes of every read page, page by page. */
  plans: EditMarkerApplyPlan[];
  readyCount: number;
  pendingCount: number;
  fontWarning: string | null;
};

export const entryKey = (page: number, operationId: string) => `${page}:${operationId}`;

/** Every read page's changes in page order, and what applies. */
export function combinePages(pages: Record<number, PageReview>): ManuscriptView {
  const view: ManuscriptView = {
    entries: [],
    toDecide: [],
    notes: [],
    plans: [],
    readyCount: 0,
    pendingCount: 0,
    fontWarning: null,
  };
  for (const page of Object.keys(pages).map(Number).sort((a, b) => a - b)) {
    const review = pages[page];
    if (review.state !== 'read') {
      continue;
    }
    const {preview} = review;
    const operations = new Map(preview.operations.map(operation => [operation.id, operation]));
    preview.hunks.forEach(hunk => {
      const operation = operations.get(hunk.operationId);
      if (operation) {
        view.entries.push({key: entryKey(page, hunk.operationId), page, hunk, operation});
      }
    });
    preview.toDecide.forEach(item => {
      view.toDecide.push({key: `${page}:${item.key}`, page, item});
    });
    (preview.base?.notes ?? []).forEach(row => {
      view.notes.push({key: `${page}:note:${row.id}`, page, row});
    });
    if (preview.applyPlan && preview.canApply) {
      view.plans.push(preview.applyPlan);
      view.readyCount += preview.applyPlan.operations.length;
    }
    view.pendingCount += preview.pendingCount;
    view.fontWarning = view.fontWarning ?? preview.fontWarning;
  }
  return view;
}

/**
 * A page chip: "p.3 ✓" nothing to do, "p.3 · 4" changes, "p.3 ?" not read, "p.3 …" reading; its
 * comments and images after them ("p.3 · 4 · 2 notes", "p.3 · 1 note").
 */
export function chipLabel(page: number, review: PageReview | undefined): string {
  const name = `p.${page + 1}`;
  if (!review || review.state === 'unread') {
    return `${name} ?`;
  }
  if (review.state === 'reading') {
    return `${name} …`;
  }
  if (review.state === 'failed') {
    return `${name} !`;
  }
  const count = review.preview.hunks.length + review.preview.toDecide.length;
  const notes = review.preview.base?.notes?.length ?? 0;
  const notesPart = notes > 0 ? ` · ${plural(notes, 'note')}` : '';
  return count === 0 ? (notes > 0 ? `${name}${notesPart}` : `${name} ✓`) : `${name} · ${count}${notesPart}`;
}

/** Pages not read yet (or whose read failed), in order. */
export function unreadPages(pageCount: number, pages: Record<number, PageReview>): number[] {
  return Array.from({length: pageCount}, (_, page) => page).filter(page => {
    const state = pages[page]?.state ?? 'unread';
    return state === 'unread' || state === 'failed';
  });
}

/** Pages read so far, in order. */
export function readPages(pages: Record<number, PageReview>): number[] {
  return Object.keys(pages)
    .map(Number)
    .filter(page => pages[page].state === 'read')
    .sort((a, b) => a - b);
}

/**
 * The order pages read before are checked in when the card opens (technical-design-manuscript-cache.md
 * §4): the current page first, then the others nearest first (the earlier page on a tie).
 */
export function checkOrder(current: number, pages: number[]): number[] {
  return [...new Set(pages)].sort((a, b) => {
    const distance = Math.abs(a - current) - Math.abs(b - current);
    return distance !== 0 ? distance : a - b;
  });
}

/** True when two reads of a page show different lists (changes or marks needing attention). */
export function listChanged(before: PageReview | undefined, after: EditMarkerPreview): boolean {
  if (before?.state !== 'read') {
    return true;
  }
  const keys = (preview: EditMarkerPreview) =>
    JSON.stringify([
      preview.hunks.map(hunk => [hunk.label, hunk.before, hunk.after, hunk.segments]),
      preview.toDecide.map(item => [item.kind, item.reason]),
      (preview.base?.notes ?? []).map(row => [row.id, row.kind, row.at?.uuid ?? null]),
    ]);
  return keys(before.preview) !== keys(after);
}
