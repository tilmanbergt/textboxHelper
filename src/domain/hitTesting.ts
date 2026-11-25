/**
 * Shared text hit-testing helpers: which measured words, in page pixels, lie in a mark's line band,
 * on which lines, and coarse coordinate-to-word / coordinate-to-character lookups.
 */

/** A measured word's box on the page. */
export type PageWord = {
  start: number;
  end: number;
  lineIndex: number;
  absoluteLeft: number;
  absoluteRight: number;
  absoluteTop: number;
  absoluteBottom: number;
  absoluteCenterX: number;
  absoluteCenterY: number;
};

/** The words whose box (without its top and bottom fifth) holds the mark's height `projectedY`. */
export function findLineBandWordCandidates<T extends {absoluteTop: number; absoluteBottom: number; projectedY: number}>(
  wordCandidates: T[],
): T[] {
  return wordCandidates.filter(candidate => {
    const wordHeight = Math.max(1, candidate.absoluteBottom - candidate.absoluteTop);
    const bandTop = candidate.absoluteTop + wordHeight * 0.2;
    const bandBottom = candidate.absoluteBottom - wordHeight * 0.2;
    return candidate.projectedY >= bandTop && candidate.projectedY <= bandBottom;
  });
}

/** The lines the words are on, in the order first met. */
export function findCandidateLineIndexes(wordCandidates: Array<{lineIndex: number}>): number[] {
  return [...new Set(wordCandidates.map(candidate => candidate.lineIndex))];
}

export function findWordAtPoint<T extends PageWord>(wordCandidates: T[], x: number, y: number): T | null {
  const containingWord = wordCandidates.find(
    word =>
      x >= word.absoluteLeft &&
      x <= word.absoluteRight &&
      y >= word.absoluteTop &&
      y <= word.absoluteBottom,
  );

  if (containingWord) {
    return containingWord;
  }

  if (wordCandidates.length === 0) {
    return null;
  }

  return [...wordCandidates].sort((left, right) => {
    const leftDistance = Math.hypot(left.absoluteCenterX - x, left.absoluteCenterY - y);
    const rightDistance = Math.hypot(right.absoluteCenterX - x, right.absoluteCenterY - y);
    return leftDistance - rightDistance;
  })[0];
}

/**
 * Approximate character hit-testing using the nearest measured word box.
 * This is intentionally simple but good enough for plugin-side coordinate mapping.
 */
export function findCharacterOffsetAtPoint(
  wordCandidates: PageWord[],
  x: number,
  y: number,
): number | null {
  const word = findWordAtPoint(wordCandidates, x, y);
  if (!word) {
    return null;
  }

  const wordLength = Math.max(1, word.end - word.start);
  const relativeX =
    word.absoluteRight <= word.absoluteLeft
      ? 0
      : (Math.min(word.absoluteRight, Math.max(word.absoluteLeft, x)) - word.absoluteLeft) /
        (word.absoluteRight - word.absoluteLeft);
  const offsetInWord = Math.min(
    wordLength,
    Math.max(0, Math.round(relativeX * wordLength)),
  );

  return Math.min(word.end, word.start + offsetInWord);
}

