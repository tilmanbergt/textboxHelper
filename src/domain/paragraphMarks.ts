import type {
  CaretShape,
  CaretTarget,
  CaretTextbox,
  Point,
} from './penEditCaret';
import type {Rect} from './textboxModel';

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

export const STEP_MIN_HEIGHT = 24;
export const STEP_MAX_HEIGHT = 160;
export const STEP_MIN_WIDTH = 40;
export const STEP_MAX_WIDTH = 700;

/** Whether a rect has a step mark's size; a cheap test before reading points. */
export function isStepSizedRect(rect: Rect): boolean {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  return (
    height >= STEP_MIN_HEIGHT &&
    height <= STEP_MAX_HEIGHT &&
    width >= STEP_MIN_WIDTH &&
    width <= STEP_MAX_WIDTH
  );
}

function boundsOf(points: Point[]): Rect {
  return {
    left: Math.min(...points.map(point => point.x)),
    top: Math.min(...points.map(point => point.y)),
    right: Math.max(...points.map(point => point.x)),
    bottom: Math.max(...points.map(point => point.y)),
  };
}

/**
 * The step mark (_|‾), drawn in one stroke: a run to the right under a line, straight up, a run
 * to the right above it. Its tip is the upright's x at the mark's middle height: the place to
 * split. Null for any other shape.
 */
export function analyzeStepMark(points: Point[]): CaretShape | null {
  if (points.length < 4) {
    return null;
  }
  const rect = boundsOf(points);
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  if (
    height < STEP_MIN_HEIGHT ||
    height > STEP_MAX_HEIGHT ||
    width < STEP_MIN_WIDTH ||
    width > STEP_MAX_WIDTH
  ) {
    return null;
  }
  const first = points[0];
  const last = points[points.length - 1];
  const lowBand = rect.bottom - height * 0.3;
  const highBand = rect.top + height * 0.3;
  if (
    first.y < lowBand ||
    first.x > rect.left + width * 0.35 ||
    last.y > highBand ||
    last.x < rect.right - width * 0.35
  ) {
    return null;
  }
  // The upright runs from the last point still low to the first point already high.
  let lowEnd = -1;
  points.forEach((point, index) => {
    if (point.y >= lowBand) {
      lowEnd = index;
    }
  });
  const highStart = points.findIndex(point => point.y <= highBand);
  if (lowEnd < 0 || highStart < 0 || lowEnd >= highStart) {
    return null;
  }
  const lowerRun = points.slice(0, lowEnd + 1);
  const upperRun = points.slice(highStart);
  const upright = points.slice(lowEnd, highStart + 1);
  const level = (run: Point[], from: number, to: number) =>
    run.every(point => point.y >= from && point.y <= to);
  if (
    !level(lowerRun, rect.bottom - height * 0.35, rect.bottom) ||
    !level(upperRun, rect.top, rect.top + height * 0.35) ||
    lowerRun[lowerRun.length - 1].x - lowerRun[0].x < 15 ||
    upperRun[upperRun.length - 1].x - upperRun[0].x < 15
  ) {
    return null;
  }
  const uprightXs = upright.map(point => point.x);
  if (
    Math.max(...uprightXs) - Math.min(...uprightXs) >
    Math.max(height * 0.25, 20)
  ) {
    return null;
  }
  const x = uprightXs.reduce((sum, value) => sum + value, 0) / uprightXs.length;
  return {
    tip: {x, y: (rect.top + rect.bottom) / 2},
    direction: 'step',
    rect,
    ends: [{...first}, {...last}],
  };
}

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

/**
 * Where a < or > points: only its tip's height counts. Between two lines of a paragraph it splits
 * there (at the start of the lower line); at a paragraph's first or last boundary, or between
 * paragraphs, it is the gap there. A tip in the middle of a line is unclear.
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
  const boundaries = [
    ...lines.map(line => line.top),
    lines[lines.length - 1].bottom,
  ];
  let best = 0;
  boundaries.forEach((y, index) => {
    if (Math.abs(tip.y - y) < Math.abs(tip.y - boundaries[best])) {
      best = index;
    }
  });
  if (
    Math.abs(tip.y - boundaries[best]) >
    lineHeightOf(textbox) * BOUNDARY_ZONE
  ) {
    return {kind: 'unclear', reason: UNCLEAR_SIDEWAYS};
  }
  if (best === 0) {
    return gapAround(textbox, column, 'above');
  }
  if (best === lines.length) {
    return gapAround(textbox, column, 'below');
  }
  return {
    kind: 'split',
    uuid: textbox.uuid,
    numInPage: textbox.numInPage,
    offset: lines[best].start,
  };
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
