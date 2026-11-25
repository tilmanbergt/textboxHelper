import type {MarkStroke} from './marks/markStroke';
import type {PenEditMark} from './penEditModel';
import {rectsMatch} from './penEditMatching';
import type {Rect} from './textboxModel';

/**
 * The tag's look-back window (technical-design-pen-edits.md §3.5): the rule is that new text is
 * written right after its mark, so only the few strokes just before the snippet are read - no
 * textbox measurement, no recognition, no page scan. What the strokes are is pass 1's
 * (`marks/pass1.ts` `readLookBack`); whether the mark really covers words is the review's.
 */

/**
 * How many strokes before the snippet are looked at. A mark counts only when it is the last thing
 * written before the text (`pickNewestMark`), and the largest mark the look-back takes has three
 * strokes (a step with its second upright and the user's circle for the number), so four are
 * enough; fewer reads make the tag quicker.
 */
export const LOOK_BACK_WINDOW = 4;
/**
 * The most element numbers read: the host renumbers after inserts, so our own icons and numbers
 * can sit between a mark and its snippet and are skipped without counting.
 */
export const LOOK_BACK_MAX_READS = 14;

/** The element numbers that may be read, newest first: L−1 down to L−maxReads, never below 1. */
export function lookBackNumbers(lowestSnippetNum: number, maxReads = LOOK_BACK_MAX_READS): number[] {
  const numbers: number[] = [];
  for (let num = lowestSnippetNum - 1; num >= 1 && num >= lowestSnippetNum - maxReads; num -= 1) {
    numbers.push(num);
  }
  return numbers;
}

/**
 * The places of every stroke that already belongs to tagged text: its handwriting and its mark
 * (strike, loop or crossing lines, caret). They are never the mark of new text. Their tag on the
 * page usually says so too; the places cover strokes the host didn't let us tag.
 */
export function ownedRects(entries: Array<{strokeRects: Rect[]; mark: PenEditMark | null}>): Rect[] {
  return entries.flatMap(entry => [
    ...entry.strokeRects,
    ...(entry.mark?.kind === 'replace'
      ? [entry.mark.strikeRect, ...entry.mark.modifierRects, ...(entry.mark.numberRect ? [entry.mark.numberRect] : [])]
      : entry.mark?.kind === 'caret'
        ? [entry.mark.caretRect]
        : []),
  ]);
}

/** The window without the strokes that already belong to tagged text. */
export function withoutOwned(window: MarkStroke[], owned: Rect[]): MarkStroke[] {
  return window.filter(stroke => !owned.some(rect => rectsMatch(rect, stroke.rect)));
}
