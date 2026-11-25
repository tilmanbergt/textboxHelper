/**
 * Paragraph marks (technical-design-paragraph-marks.md): a < or > splits a paragraph at a line
 * boundary, a step mark (_|‾) at a word gap; before a tagged Insertion either makes the text a
 * paragraph of its own there. A split travels through the text changes as a private split sign
 * and is cut apart at apply. Pure. Shapes: `marks/shapes/caret.ts`; places: `marks/place/paragraph.ts`.
 */

/** The split sign: a private-use character, never typed, cut out at apply. */
export const SPLIT_SIGN = '';

/** How the split sign shows in the review: the end of a paragraph. */
export const SPLIT_SHOWN = ' ¶\n';

/** A textbox's new text cut into paragraphs at the split signs; empty parts are dropped. */
export function splitParagraphParts(text: string): string[] {
  return text
    .split(SPLIT_SIGN)
    .map(part => part.trim())
    .filter(part => part.length > 0);
}

/** Review text with the split signs shown as paragraph ends. */
export function showSplits(text: string): string {
  return text.replace(/\s*\s*/g, SPLIT_SHOWN);
}

/** The change text of a split: just the sign, or the inserted text as a paragraph of its own. */
export function splitChangeText(inserted: string | null): string {
  const text = inserted?.trim() ?? '';
  return text ? `${SPLIT_SIGN}${text}${SPLIT_SIGN}` : SPLIT_SIGN;
}

/** Why a step on its own, with no second upright and no swap around it, is ignored. */
export const BARE_STEP_REASON =
  'A step alone is not used: a paragraph break needs a second short line next to its upright (_||‾); a swap needs a start and an end corner.';
