/**
 * One page layout for everything that places text on a page (technical-design-settings-layout-files.md
 * §1): the import, the Outline's Apply and Clean up layout. The margins leave room for handwriting
 * (about a fifth of the width on the right, a third of the height at the bottom); linked files and
 * the aside area always start a new page, headings of the chosen levels too. Pure.
 */
import type {HeadingLevel} from './headingText';
import type {Rect} from './textboxModel';

export type PageMargins = {left: number; top: number; right: number; bottom: number};

export type PageLayout = {
  /** Distance from the page edges, in page pixels. */
  margins: PageMargins;
  /** Heading levels that start a new page (a linked file's divider always does). */
  breakBefore: HeadingLevel[];
  /** Space between two blocks, in page pixels. */
  blockGap: number;
};

export const DEFAULT_PAGE_LAYOUT: PageLayout = {
  margins: {left: 100, top: 100, right: 280, bottom: 625},
  breakBefore: [],
  blockGap: 18,
};

/** The text area of a page; throws when the margins leave none. */
export function textArea(page: {width: number; height: number}, layout: PageLayout): Rect {
  const {margins} = layout;
  const rect: Rect = {
    left: margins.left,
    top: margins.top,
    right: page.width - margins.right,
    bottom: page.height - margins.bottom,
  };
  if (rect.right <= rect.left || rect.bottom <= rect.top) {
    throw new Error('The page margins leave no room for text: make them smaller in Settings → Layout.');
  }
  return rect;
}

export type BreakKind = 'file' | 'heading' | 'paragraph' | 'aside';

/** Whether a block starts a new page: a file's or the aside area's divider always, a heading by its level. */
export function startsPage(block: {kind: BreakKind; level: number | null}, layout: PageLayout): boolean {
  if (block.kind === 'file' || block.kind === 'aside') {
    return true;
  }
  return block.kind === 'heading' && block.level !== null && layout.breakBefore.includes(block.level as HeadingLevel);
}

/** A short line for the layout: "Margins 100 · 100 · 280 · 625". */
export function marginsSummary(layout: PageLayout): string {
  const {left, top, right, bottom} = layout.margins;
  return `Margins ${left} · ${top} · ${right} · ${bottom}`;
}
