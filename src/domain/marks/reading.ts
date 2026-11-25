import type {Rect} from '../textboxModel';
import type {Point} from './markStroke';
import type {ArcShape} from './shapes/closeUp';
import type {CaretDirection, CaretShape} from './shapes/caret';
import type {PunctuationChar} from './shapes/punct';
import type {SlashShape} from './shapes/slash';

/**
 * The output of pass 1 (technical-design-mark-dialogue.md §2.2): what a group of strokes is, read
 * from the strokes alone. Pass 2 places a reading in the text.
 *
 * Kinds: a `strike` (whole words; with tagged text a replacement), a strike with a vertical at
 * each end (`strikeVerticals`: exactly between them, deleted), the same with a circle
 * (`replaceVerticals`: exactly between them, replaced by the tagged text, the circle holds the
 * number), a strike with a loop (`replaceLoop`: whole words replaced by the tagged text), a `slash` through one letter,
 * the carets (`caret` V ∧, `sideways` < >, `step` _|‾ with or without its second upright), the
 * insert-space mark (`space`), a punctuation circle (`punct`), a `closeUp` arc and a `swap`
 * piece (read against a line only in pass 2, technical-design-mark-dialogue.md §13.1 Q1).
 */

export type MarkKind =
  | 'strike'
  | 'strikeVerticals'
  | 'replaceVerticals'
  | 'replaceLoop'
  | 'slash'
  | 'caret'
  | 'step'
  | 'sideways'
  | 'space'
  | 'swap'
  | 'closeUp'
  | 'punct';

/** What pass 2 must find: a place, a part of the text, or two parts (a swap). */
export type Need = 'point' | 'part' | 'twoParts';

/** A place the mark points at, and how it snaps to the text. */
export type Anchor = {x: number; y: number; snap: 'word' | 'char' | 'line'};

/** What each stroke of a reading is: the mark itself, a modifier, the number's circle, a circle's contents. */
export type StrokeRole = 'mark' | 'modifier' | 'number' | 'content';

/** The shape a reading was read from, kept for pass 2. */
export type ReadingShape =
  | {kind: 'caret'; caret: CaretShape}
  | {kind: 'slash'; slash: SlashShape}
  | {kind: 'arc'; arc: ArcShape}
  | {kind: 'stroke'; points: Point[] | null; center: Point};

export type Reading = {
  kind: MarkKind;
  need: Need;
  /** Ids of the strokes it consumes; `roles` says what each is. */
  strokes: string[];
  roles: StrokeRole[];
  /** 1 (point) · 2 (part: start, end); none for a swap piece. */
  anchors: Anchor[];
  /** The mark's height, raw. */
  band: {top: number; bottom: number};
  /** The strokes' rects, in `strokes` order. */
  rects: Rect[];
  direction?: CaretDirection;
  /** A punctuation circle's reading by the plugin. */
  punct?: {char: PunctuationChar | null; tie: boolean};
  /** The user's own circle for the number. */
  numberPlace?: Rect;
  /** Remarks shown with the mark, never refusing it. */
  flags: string[];
  shape: ReadingShape;
};

/** A group of strokes and its readings, ranked: none (and why), one, or two (the first first). */
export type Pass1Group = {strokes: string[]; readings: Reading[]; reason: string | null};

/** The rects of a reading's strokes in one role. */
export function rectsWithRole(reading: Reading, role: StrokeRole): Rect[] {
  return reading.rects.filter((_, index) => reading.roles[index] === role);
}

export function idsWithRole(reading: Reading, role: StrokeRole): string[] {
  return reading.strokes.filter((_, index) => reading.roles[index] === role);
}
