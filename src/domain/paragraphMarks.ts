import type {CaretTarget, CaretTextbox} from './penEditCaret';
import type {Point} from './marks/markStroke';

/**
 * Paragraph marks (technical-design-paragraph-marks.md): a < or > splits a paragraph at a line
 * boundary, a step mark (_|‾) at a word gap; before a tagged Insertion either makes the text a
 * paragraph of its own there. A split travels through the text changes as a private split sign
 * and is cut apart at apply. Pure.
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

/** How near (in line heights) to a boundary between lines a sideways caret's tip must be. */
export const BOUNDARY_ZONE = 0.3;

const UNCLEAR_SIDEWAYS =
  "The caret's tip points at the middle of a line: point it between two lines.";

function lineHeightOf(textbox: CaretTextbox): number {
  const line = textbox.lines[0];
  return line ? Math.max(1, line.bottom - line.top) : 48;
}

function gapAround(
  textbox: CaretTextbox,
  column: CaretTextbox[],
  side: 'above' | 'below',
): CaretTarget {
  const ordered = [...column].sort((a, b) => a.rect.top - b.rect.top);
  const index = ordered.findIndex(item => item.uuid === textbox.uuid);
  return side === 'above'
    ? {
        kind: 'gap',
        above: ordered[index - 1]?.uuid ?? null,
        below: textbox.uuid,
      }
    : {
        kind: 'gap',
        above: textbox.uuid,
        below: ordered[index + 1]?.uuid ?? null,
      };
}

/** How far past a paragraph's last word (pixels) a tip beside that line must be. */
export const PAST_LAST_WORD_PX = 20;

/**
 * Where a < or > points; only its tip's height counts, except beside a paragraph's last line.
 * In order:
 * 1. Above a paragraph's first line or below its last line: before or after the paragraph.
 * 2. Near a boundary between two lines (within 30 % of a line height): a break there.
 * 3. On an empty line: a break there.
 * 4. Beside a line that ends a paragraph, at least 20 px past its last word: after that line.
 * 5. Anything else is unclear.
 * A break at a paragraph's first or last boundary is the gap before or after it.
 */
export function locateSideways(
  tip: Point,
  column: CaretTextbox[],
): CaretTarget | null {
  const near = column
    .map(textbox => {
      const reach = lineHeightOf(textbox) * 0.6;
      const inside =
        tip.y >= textbox.rect.top - reach &&
        tip.y <= textbox.rect.bottom + reach;
      const distance =
        tip.y < textbox.rect.top
          ? textbox.rect.top - tip.y
          : Math.max(0, tip.y - textbox.rect.bottom);
      return inside && textbox.lines.length > 0 ? {textbox, distance} : null;
    })
    .filter(
      (item): item is {textbox: CaretTextbox; distance: number} =>
        item !== null,
    )
    .sort((a, b) => a.distance - b.distance)[0];
  if (!near) {
    const ordered = [...column].sort((a, b) => a.rect.top - b.rect.top);
    const above =
      [...ordered].reverse().find(textbox => textbox.rect.bottom <= tip.y) ??
      null;
    const below = ordered.find(textbox => textbox.rect.top >= tip.y) ?? null;
    return above || below
      ? {kind: 'gap', above: above?.uuid ?? null, below: below?.uuid ?? null}
      : null;
  }
  const {textbox} = near;
  const lines = [...textbox.lines].sort((a, b) => a.top - b.top);
  const lastLine = lines[lines.length - 1];
  const breakAt = (index: number): CaretTarget =>
    index <= 0
      ? gapAround(textbox, column, 'above')
      : index >= lines.length
      ? gapAround(textbox, column, 'below')
      : {
          kind: 'split',
          uuid: textbox.uuid,
          numInPage: textbox.numInPage,
          offset: lines[index].start,
        };

  // 1. Outside the paragraph's lines.
  if (tip.y < lines[0].top) {
    return breakAt(0);
  }
  if (tip.y > lastLine.bottom) {
    return breakAt(lines.length);
  }
  // 2. Near a boundary between two lines.
  const boundaries = [...lines.map(line => line.top), lastLine.bottom];
  let best = 0;
  boundaries.forEach((y, index) => {
    if (Math.abs(tip.y - y) < Math.abs(tip.y - boundaries[best])) {
      best = index;
    }
  });
  if (
    Math.abs(tip.y - boundaries[best]) <=
    lineHeightOf(textbox) * BOUNDARY_ZONE
  ) {
    return breakAt(best);
  }
  const lineIndex = lines.findIndex(
    line => tip.y >= line.top && tip.y <= line.bottom,
  );
  const line = lines[lineIndex];
  if (line) {
    const words = textbox.words.filter(word => word.lineIndex === line.index);
    const lineText = textbox.text.slice(line.start, line.end);
    // 3. An empty line: the break goes there; empty lines are trimmed off the new paragraphs.
    if (words.length === 0 || lineText.trim() === '') {
      return breakAt(lineIndex);
    }
    // 4. Beside a line that ends a paragraph, in the free space after its last word.
    const endsParagraph =
      lineIndex === lines.length - 1 || /\n\s*$/.test(lineText);
    const lastRight = Math.max(...words.map(word => word.right));
    if (endsParagraph && tip.x >= lastRight + PAST_LAST_WORD_PX) {
      return breakAt(lineIndex + 1);
    }
  }
  // 5. Unclear.
  return {kind: 'unclear', reason: UNCLEAR_SIDEWAYS};
}

/**
 * Where a step mark splits: on the line its middle height is on, at the word gap nearest to its
 * upright. The paragraph's very start or end is no split.
 */
export function locateStep(
  tip: Point,
  column: CaretTextbox[],
): CaretTarget | null {
  for (const textbox of column) {
    const lines = [...textbox.lines].sort((a, b) => a.top - b.top);
    const lineIndex = lines.findIndex(
      line => tip.y >= line.top - 4 && tip.y <= line.bottom + 4,
    );
    if (lineIndex < 0) {
      continue;
    }
    const line = lines[lineIndex];
    const words = textbox.words
      .filter(word => word.lineIndex === line.index)
      .sort((a, b) => a.left - b.left);
    if (words.length === 0) {
      return {
        kind: 'unclear',
        reason:
          'The step mark is on an empty line: draw it across a line of text.',
      };
    }
    const nextStart = lines[lineIndex + 1]?.start ?? textbox.text.length;
    const gaps = [
      ...words.map(word => ({x: word.left, offset: word.start})),
      {x: words[words.length - 1].right, offset: nextStart},
    ];
    const gap = gaps.reduce((best, item) =>
      Math.abs(item.x - tip.x) < Math.abs(best.x - tip.x) ? item : best,
    );
    const before = textbox.text.slice(0, gap.offset).trim();
    const after = textbox.text.slice(gap.offset).trim();
    if (!before || !after) {
      return {
        kind: 'unclear',
        reason:
          "The step mark is at the paragraph's start or end: there is nothing to split.",
      };
    }
    return {
      kind: 'split',
      uuid: textbox.uuid,
      numInPage: textbox.numInPage,
      offset: gap.offset,
    };
  }
  return {
    kind: 'unclear',
    reason: "The step mark doesn't cross a line of text.",
  };
}
