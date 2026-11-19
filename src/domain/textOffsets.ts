/**
 * Where a point falls inside a measured word, in characters (technical-design-swap-space-marks.md
 * §3). With the character edges from the native measurement the letter is exact; without them
 * (an older native build, or edges that don't fit the word) the word's average character width
 * is used. Pure.
 */

export type WordWithEdges = {
  start: number;
  end: number;
  left: number;
  right: number;
  /** Page x of each character's start, and of the last one's end (characters + 1 values). */
  edges?: number[];
};

function usableEdges(word: WordWithEdges): number[] | null {
  const edges = word.edges;
  const length = word.end - word.start;
  if (!edges || edges.length !== length + 1 || length <= 0) {
    return null;
  }
  for (let index = 1; index < edges.length; index += 1) {
    if (!(edges[index] >= edges[index - 1])) {
      return null;
    }
  }
  return edges[edges.length - 1] > edges[0] ? edges : null;
}

/**
 * The position of `x` in the word in characters, as a fraction: 0 at its left edge, its length
 * at its right edge, 2.5 in the middle of its third character. Clamped to the word.
 */
export function charPositionInWord(word: WordWithEdges, x: number): number {
  const length = Math.max(1, word.end - word.start);
  const edges = usableEdges(word);
  if (!edges) {
    const charWidth = Math.max(1, (word.right - word.left) / length);
    return Math.min(length, Math.max(0, (x - word.left) / charWidth));
  }
  if (x <= edges[0]) {
    return 0;
  }
  for (let index = 0; index < edges.length - 1; index += 1) {
    const from = edges[index];
    const to = edges[index + 1];
    if (x <= to) {
      return to > from ? index + (x - from) / (to - from) : index;
    }
  }
  return length;
}

/** The page x where the character at `offset` (inside or at the ends of the word) starts. */
export function xAtOffset(word: WordWithEdges, offset: number): number {
  const length = Math.max(1, word.end - word.start);
  const index = Math.min(length, Math.max(0, offset - word.start));
  const edges = usableEdges(word);
  if (edges) {
    return edges[index];
  }
  return word.left + ((word.right - word.left) * index) / length;
}
