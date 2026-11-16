/**
 * Height-driven paging of rows (taken from Kept GTD's ui/pagination.ts). Every list pages through
 * a fixed box instead of scrolling, so e-ink only redraws one fixed-size box.
 *
 * `usePagedByHeight` fits as many rows as their real `rowHeight` allows into `viewportHeight`.
 * The current page is kept across data reloads and only clamped down when it no longer exists.
 * `resetKey`: a change means "a different list now" and jumps back to page 0. `jumpTo`: a change
 * of its `key` jumps to the page that holds row `index` (it wins over `resetKey` on the same
 * render). Page boundaries are discovered lazily, only for pages actually visited.
 */
import {useEffect, useRef, useState} from 'react';

export interface JumpTo {
  key: string | number;
  index: number;
}

export interface PagedByHeight<T> {
  page: number;
  /** Index (into `rows`) of the first row on the current page. */
  startIndex: number;
  pageItems: T[];
  canPrev: boolean;
  canNext: boolean;
  goPrev: () => void;
  goNext: () => void;
}

export function usePagedByHeight<T>(
  rows: T[],
  rowHeight: (row: T) => number,
  viewportHeight: number,
  resetKey?: string | number,
  jumpTo?: JumpTo | null,
): PagedByHeight<T> {
  const [page, setPage] = useState(0);
  // pageStarts[i] = the row index page i starts at; grown on the way forward and kept.
  const pageStartsRef = useRef<number[]>([0]);

  useEffect(() => {
    if (resetKey !== undefined) {
      pageStartsRef.current = [0];
      setPage(0);
    }
  }, [resetKey]);

  // Row heights vary, so the target's page is found by re-running the same greedy fill page by
  // page from the start until it passes `jumpTo.index`.
  useEffect(() => {
    if (!jumpTo) {
      return;
    }
    const boundaries: number[] = [0];
    let landingPage = 0;
    let start = 0;
    while (true) {
      let used = 0;
      let count = 0;
      for (let i = start; i < rows.length; i++) {
        const h = rowHeight(rows[i]);
        if (count > 0 && used + h > viewportHeight) {
          break;
        }
        used += h;
        count += 1;
      }
      const nextStart = start + count;
      landingPage = boundaries.length - 1;
      if (jumpTo.index < nextStart || nextStart >= rows.length || count === 0) {
        break;
      }
      boundaries.push(nextStart);
      start = nextStart;
    }
    pageStartsRef.current = boundaries;
    setPage(landingPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new jumpTo.key jumps
  }, [jumpTo?.key]);

  // Clamp down (never forward) when the page no longer exists.
  let clampedPage = page;
  while (clampedPage > 0 && (pageStartsRef.current[clampedPage] ?? 0) >= rows.length) {
    clampedPage -= 1;
  }

  // At least one row per page, even an oversize one: the box's overflow: hidden clips it.
  const start = pageStartsRef.current[clampedPage] ?? 0;
  const pageItems: T[] = [];
  let usedHeight = 0;
  for (let i = start; i < rows.length; i++) {
    const h = rowHeight(rows[i]);
    if (pageItems.length > 0 && usedHeight + h > viewportHeight) {
      break;
    }
    pageItems.push(rows[i]);
    usedHeight += h;
  }

  const nextStart = start + pageItems.length;
  const canNext = nextStart < rows.length;
  const canPrev = clampedPage > 0;

  const goNext = () => {
    if (!canNext) {
      return;
    }
    if (pageStartsRef.current[clampedPage + 1] === undefined) {
      pageStartsRef.current[clampedPage + 1] = nextStart;
    }
    setPage(clampedPage + 1);
  };
  const goPrev = () => {
    if (canPrev) {
      setPage(clampedPage - 1);
    }
  };

  return {page: clampedPage, startIndex: start, pageItems, canPrev, canNext, goPrev, goNext};
}
