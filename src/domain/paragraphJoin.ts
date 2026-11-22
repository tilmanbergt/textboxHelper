/**
 * Joining two paragraphs with two close-up arcs (technical-design-fine-marks.md §7): the lower
 * paragraph's text follows the upper one's, with one space between - or, when the user takes the
 * dash ending the upper paragraph away, with nothing between ("note-" + "book" → "notebook").
 * Pure.
 */

const TRAILING_DASH = /[-‐‑–—]$/;

/** The dash ending a paragraph that the "Also remove" toggle would take; '' when none. */
export function trailingDash(text: string): string {
  return text.trimEnd().match(TRAILING_DASH)?.[0] ?? '';
}

export function joinParagraphTexts(upper: string, lower: string, removeDash: boolean): string {
  const head = upper.trimEnd();
  const tail = lower.trimStart();
  if (!head) {
    return tail;
  }
  if (!tail) {
    return head;
  }
  if (removeDash && TRAILING_DASH.test(head)) {
    return `${head.slice(0, -1)}${tail}`;
  }
  return `${head} ${tail}`;
}
