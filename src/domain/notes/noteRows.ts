import {firstWords} from '../markerHunks';
import {shiftRect} from '../penEditMatching';
import type {NoteInfo, PenEditEntry} from '../penEditModel';
import type {NoteKind} from '../penEditTags';
import type {Rect} from '../textboxModel';
import {readingOrder, type ParagraphCandidate, type ParagraphResult} from './paragraphOf';

/**
 * A page's comments and images as the Review shows them (technical-design-comments-images.md
 * §5.1): each with the paragraph it belongs to. Pure; `actions/notesRead.ts` reads them.
 */

/** A textbox of a page a note may belong to, with what its row and the page map need. */
export type PageParagraph = ParagraphCandidate & {numInPage: number; text: string};

export type NoteRow = {
  id: string;
  kind: NoteKind;
  page: number;
  /** Where its handwriting is now. */
  rect: Rect;
  note: NoteInfo;
  paragraph: ParagraphResult;
  /** The paragraph it belongs to: its page, its number there (1 = first in reading order), its start. */
  at: {uuid: string; page: number; number: number; words: string; rect: Rect} | null;
  pictureUri: string | null;
};

/** How many words of a paragraph its row shows. */
const ROW_WORDS = 8;

/** A paragraph's number on its page (1-based, reading order) among `paragraphs` of that page. */
export function paragraphNumber(target: ParagraphCandidate, paragraphs: ParagraphCandidate[]): number {
  return paragraphs.filter(item => item.page === target.page).sort(readingOrder).indexOf(target) + 1;
}

/** Where a note's paragraph is, for its row: found among the page's paragraphs or `elsewhere`. */
export function paragraphAt(result: ParagraphResult, paragraphs: PageParagraph[]): NoteRow['at'] {
  if ('none' in result) {
    return null;
  }
  const target = paragraphs.find(item => item.uuid === result.uuid);
  return target
    ? {uuid: target.uuid, page: target.page, number: paragraphNumber(target, paragraphs), words: firstWords(target.text, ROW_WORDS), rect: target.rect}
    : null;
}

/** "¶ 2", "¶ 2 on p.4" when its paragraph is on another page, "no paragraph". */
export function paragraphLabel(row: Pick<NoteRow, 'page' | 'at'>): string {
  if (!row.at) {
    return 'no paragraph';
  }
  return row.at.page === row.page ? `¶ ${row.at.number}` : `¶ ${row.at.number} on p.${row.at.page + 1}`;
}

/** What a row says of its kind and paragraph: "Comment · ¶ 1", "Image · after ¶ 2". */
export function noteRowTitle(row: Pick<NoteRow, 'kind' | 'page' | 'at' | 'note'>): string {
  const where = paragraphLabel(row);
  if (row.kind === 'comment') {
    return `Comment · ${where}`;
  }
  return row.at ? `Image · ${row.note.place === 'before' ? 'before' : 'after'} ${where}` : `Image · ${where}`;
}

/** Bounds of rects; null for none. */
function union(rects: Rect[]): Rect | null {
  return rects.length === 0
    ? null
    : {
        left: Math.min(...rects.map(rect => rect.left)),
        top: Math.min(...rects.map(rect => rect.top)),
        right: Math.max(...rects.map(rect => rect.right)),
        bottom: Math.max(...rects.map(rect => rect.bottom)),
      };
}

/** A move smaller than this (pixels) is reading noise, not a move. */
const MOVE_SLACK_PX = 2;

/**
 * A note whose tagged handwriting was moved with the lasso since it was tagged: the entry with its
 * place moved along (`rect`, `strokeRects`), so counts that read only the index (the Outline,
 * §6) find it where it is now. Null when it didn't move. `now`: its strokes' bounds on the page.
 */
export function movedNote(entry: PenEditEntry, now: Rect): PenEditEntry | null {
  const then = union(entry.strokeRects);
  if (!then) {
    return null;
  }
  const dx = now.left - then.left;
  const dy = now.top - then.top;
  if (Math.abs(dx) <= MOVE_SLACK_PX && Math.abs(dy) <= MOVE_SLACK_PX) {
    return null;
  }
  return {
    ...entry,
    rect: shiftRect(entry.rect, dx, dy),
    strokeRects: entry.strokeRects.map(rect => shiftRect(rect, dx, dy)),
  };
}
