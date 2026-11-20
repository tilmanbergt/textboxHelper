import type {
  ChangeHunk,
  EditMarkerApplyPlan,
  EditMarkerPreview,
  IgnoredEditMarker,
  RecognizedEditOperation,
} from './markerTypes';

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

export type AttentionItem = {key: string; page: number; marker: IgnoredEditMarker};

export type ManuscriptView = {
  entries: ManuscriptEntry[];
  attention: AttentionItem[];
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
    attention: [],
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
    preview.ignoredMarkers.forEach((marker, index) => {
      view.attention.push({key: `${page}:ignored:${index}`, page, marker});
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

/** A page chip: "p.3 ✓" nothing to do, "p.3 · 4" changes, "p.3 ?" not read, "p.3 …" reading. */
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
  const count = review.preview.hunks.length + review.preview.ignoredMarkers.length;
  return count === 0 ? `${name} ✓` : `${name} · ${count}`;
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
