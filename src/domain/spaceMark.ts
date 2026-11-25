/**
 * The insert-space mark's text side (technical-design-swap-space-marks.md §4): whether a space can
 * go in at a place, and the snippet the review shows. Its shape is `marks/shapes/space.ts`.
 */

const SPACE = /\s/;

/**
 * Whether a space can go in at `offset`: only between two characters that aren't spaces. Null
 * when it can, else the reason it can't.
 */
export function spaceRefusal(text: string, offset: number): string | null {
  const before = text.charAt(offset - 1);
  const after = text.charAt(offset);
  if (!before || !after) {
    return "The space mark is at the start or end of the text: there's nothing to separate.";
  }
  if (SPACE.test(before) || SPACE.test(after)) {
    return 'There is already a space here.';
  }
  return null;
}

/** "this|word": the characters around the place, for the review's row. */
export function spaceSnippet(text: string, offset: number, around = 6): string {
  const head = text.slice(Math.max(0, offset - around), offset).replace(/\s+/g, ' ');
  const tail = text.slice(offset, offset + around).replace(/\s+/g, ' ');
  return `${head}|${tail}`;
}
