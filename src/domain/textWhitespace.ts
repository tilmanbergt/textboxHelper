/**
 * Line breaks and spaces of a block cut into several textboxes (technical-design-source-link.md
 * §2.4). A block taller than the page is cut into pieces; this module cuts it so each piece keeps
 * its own line breaks, joins pieces back the way the file had them, and puts the file's whitespace
 * back where the words are unchanged. That way a list survives the cut: untouched, it is written
 * back byte for byte, and edited, every item keeps its own line. Pure.
 */

/** A line that starts a list item: `-`, `*`, `+` or `1.` / `1)`, after optional indentation. */
export const LIST_ITEM = /^[ \t]*([-*+]|\d{1,9}[.)])[ \t]+/;

/** One piece of a text to cut: the whitespace before it in the text, and its own text. */
export type CutUnit = {before: string; text: string};

type Words = {words: string[]; seps: string[]};

/** Words and the whitespace before each (`seps[0]` is the leading whitespace). */
function wordsOf(text: string): Words {
  const words: string[] = [];
  const seps: string[] = [];
  const pattern = /(\s*)(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    seps.push(match[1]);
    words.push(match[2]);
  }
  return {words, seps};
}

/**
 * The places a text can be cut, coarse: at every line break and after every sentence end
 * (`.`, `!` or `?` before whitespace). Each unit keeps the whitespace before it, so the units
 * joined with it are the text again.
 */
export function sentenceUnits(text: string): CutUnit[] {
  const {words, seps} = wordsOf(text.replace(/\r\n?/g, '\n'));
  const units: CutUnit[] = [];
  words.forEach((word, index) => {
    const before = seps[index];
    const last = units[units.length - 1];
    const startsUnit = !last || before.includes('\n') || /[.!?]$/.test(words[index - 1]);
    if (startsUnit) {
      units.push({before, text: word});
    } else {
      last.text += `${before}${word}`;
    }
  });
  return units;
}

/** The places a unit can be cut, fine: between its words. */
export function wordUnits(text: string): CutUnit[] {
  const {words, seps} = wordsOf(text);
  return words.map((word, index) => ({before: seps[index], text: word}));
}

/**
 * The text a piece starts with when the cut before it was at a line break: the next line's
 * indentation, so a nested list item stays nested.
 */
export function indentAfterBreak(before: string): string {
  const at = before.lastIndexOf('\n');
  return at < 0 ? '' : before.slice(at + 1);
}

/** Pieces of one block, one after the other, as one text: a list item starts on a new line. */
export function joinPieces(pieces: string[]): string {
  return pieces.reduce((text, piece, index) => {
    if (index === 0) {
      return piece;
    }
    return `${text}${LIST_ITEM.test(piece) ? '\n' : ' '}${piece}`;
  }, '');
}

/** Above this many word pairs the middle of two texts is not compared word by word. */
const MAX_COMPARED_PAIRS = 1_000_000;

/**
 * For each word of `edited`, the index of the same word in `original`, or -1 for a new word: a
 * longest common subsequence of the words, after the common start and end.
 */
function matchWords(original: string[], edited: string[]): number[] {
  const match = new Array<number>(edited.length).fill(-1);
  let head = 0;
  while (head < original.length && head < edited.length && original[head] === edited[head]) {
    match[head] = head;
    head++;
  }
  let tail = 0;
  while (
    tail < original.length - head &&
    tail < edited.length - head &&
    original[original.length - 1 - tail] === edited[edited.length - 1 - tail]
  ) {
    match[edited.length - 1 - tail] = original.length - 1 - tail;
    tail++;
  }
  const rows = original.length - head - tail;
  const cols = edited.length - head - tail;
  if (rows === 0 || cols === 0 || rows * cols > MAX_COMPARED_PAIRS) {
    return match;
  }
  // lengths[r * (cols + 1) + c]: common words of original[head + r..] and edited[head + c..].
  const width = cols + 1;
  const lengths = new Int32Array((rows + 1) * width);
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      lengths[r * width + c] =
        original[head + r] === edited[head + c]
          ? lengths[(r + 1) * width + c + 1] + 1
          : Math.max(lengths[(r + 1) * width + c], lengths[r * width + c + 1]);
    }
  }
  let r = 0;
  let c = 0;
  while (r < rows && c < cols) {
    if (original[head + r] === edited[head + c]) {
      match[head + c] = head + r;
      r++;
      c++;
    } else if (lengths[(r + 1) * width + c] >= lengths[r * width + c + 1]) {
      r++;
    } else {
      c++;
    }
  }
  return match;
}

/**
 * `edited` with the file's whitespace put back: a single space before a word that is also in
 * `original` becomes the whitespace that word had there. Pieces joined with a space, and pieces
 * an older import flattened, get their line breaks back this way, also next to an edit; a line
 * break or other whitespace the user typed stays.
 */
export function restoreWhitespace(original: string, edited: string): string {
  const before = wordsOf(original.replace(/\r\n?/g, '\n'));
  const after = wordsOf(edited.replace(/\r\n?/g, '\n'));
  const match = matchWords(before.words, after.words);
  return after.words
    .map((word, index) => {
      const sep = after.seps[index];
      const restored = index > 0 && sep === ' ' && match[index] > 0 ? before.seps[match[index]] : sep;
      return `${restored}${word}`;
    })
    .join('');
}

/** Whether two texts have the same words in the same order, whatever the whitespace. */
export function sameWords(a: string, b: string): boolean {
  const words = (text: string) => text.split(/\s+/).filter(Boolean).join(' ');
  return words(a) === words(b);
}
