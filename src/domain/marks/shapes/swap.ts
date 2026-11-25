import type {MarkStroke} from '../markStroke';

/**
 * The swap mark's pass-1 test (technical-design-mark-dialogue.md §13.1 Q1): a swap piece is read
 * against a line's letters - which runs are above and which below them, whether an upright
 * crosses them - so its real test is in pass 2 (`swapMark.ts`). Pass 1 only says which strokes may
 * be one: drawn, not a straight line, with at least three points and at least one letter wide
 * (a piece's shortest run is 12 px).
 */

export const SWAP_PIECE_MIN_WIDTH = 12;

export function isSwapCandidate(stroke: MarkStroke): boolean {
  return (
    !stroke.straightLine &&
    !!stroke.points &&
    stroke.points.length >= 3 &&
    stroke.rect.right - stroke.rect.left >= SWAP_PIECE_MIN_WIDTH
  );
}
