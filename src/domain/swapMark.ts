import {WORD_EDGE_SNAP_CHARS, type CaretTextbox, type Point} from './penEditCaret';
import {charPositionInWord} from './textOffsets';
import type {Rect} from './textboxModel';

/**
 * The swap mark (technical-design-swap-space-marks.md §5): two parts of the text side by side,
 * one marked by a line above it, the other by a line below, joined by a vertical at the one
 * boundary between them. On one line it is one stroke (|‾‾‾|___| or |___|‾‾‾|, the outer
 * verticals optional as long as one is there). Across lines it comes in pieces: a start corner
 * where the first part begins, the middle piece (‾|_ or _|‾) where it ends and the second
 * begins, an end corner where the second ends; the lines on the lines between are optional.
 * Pure: shapes from stroke points, places from measured words.
 */

/** Which side of a line a run of the stroke is on. */
type Side = 'above' | 'below';

type Run = {side: Side; from: number; to: number; minX: number; maxX: number; minY: number; maxY: number};

/** A stroke read against one line: what kind of swap piece it is there. */
export type PieceShape =
  | {kind: 'whole'; aAbove: boolean; left: number; split: number; right: number}
  | {kind: 'split'; aAbove: boolean; split: number; leftRun: [number, number]; rightRun: [number, number]}
  | {kind: 'start'; aAbove: boolean; x: number}
  | {kind: 'end'; aAbove: boolean; x: number}
  | {kind: 'line'};

/** Points this far (in line heights) from a line's middle are above or below it. */
const SIDE_BAND = 0.2;
/** A run must reach this far (in line heights) from the middle: over or under the text. */
const RUN_REACH = 0.3;

function runsOf(points: Point[], cy: number, h: number): Run[] {
  const runs: Run[] = [];
  points.forEach((point, index) => {
    const side: Side | null =
      point.y < cy - SIDE_BAND * h ? 'above' : point.y > cy + SIDE_BAND * h ? 'below' : null;
    if (!side) {
      return;
    }
    const last = runs[runs.length - 1];
    if (last && last.side === side) {
      last.to = index;
      last.minX = Math.min(last.minX, point.x);
      last.maxX = Math.max(last.maxX, point.x);
      last.minY = Math.min(last.minY, point.y);
      last.maxY = Math.max(last.maxY, point.y);
    } else {
      runs.push({side, from: index, to: index, minX: point.x, maxX: point.x, minY: point.y, maxY: point.y});
    }
  });
  return runs;
}

const widthOf = (run: Run) => run.maxX - run.minX;

/** A stretch of the stroke that goes up or down more than it goes sideways. */
function verticalBetween(
  points: Point[],
  from: number,
  to: number,
  h: number,
): {x: number; minY: number; maxY: number} | null {
  if (to <= from) {
    return null;
  }
  const part = points.slice(from, to + 1);
  const xs = part.map(point => point.x);
  const ys = part.map(point => point.y);
  const dy = Math.max(...ys) - Math.min(...ys);
  const dx = Math.max(...xs) - Math.min(...xs);
  if (dy < h * 0.45 || dx > Math.max(20, dy * 0.6)) {
    return null;
  }
  return {x: xs.reduce((sum, x) => sum + x, 0) / xs.length, minY: Math.min(...ys), maxY: Math.max(...ys)};
}

/** Where the stroke crosses the line's middle between two runs (by the stroke's order). */
function crossingX(points: Point[], from: number, to: number, cy: number): number {
  for (let index = from; index < to; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if ((a.y - cy) * (b.y - cy) <= 0 && a.y !== b.y) {
      return a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x);
    }
  }
  const part = points.slice(from, to + 1);
  return part.reduce((sum, point) => sum + point.x, 0) / Math.max(1, part.length);
}

/** What swap piece a stroke is against a line with middle `cy` and height `h`, or null. */
export function pieceOnLine(points: Point[], cy: number, h: number): PieceShape | null {
  if (points.length < 3) {
    return null;
  }
  let runs = runsOf(points, cy, h);
  // Short runs at the ends are the outer verticals' tips beyond the band.
  const tiny = (run: Run) => widthOf(run) < Math.max(12, h * 0.3);
  while (runs.length > 0 && tiny(runs[0])) {
    runs = runs.slice(1);
  }
  while (runs.length > 0 && tiny(runs[runs.length - 1])) {
    runs = runs.slice(0, -1);
  }
  if (runs.length === 0 || runs.length > 2 || runs.some(tiny)) {
    return null;
  }
  const reaches = (run: Run) =>
    run.side === 'above' ? run.minY <= cy - RUN_REACH * h : run.maxY >= cy + RUN_REACH * h;
  if (!runs.every(reaches)) {
    return null;
  }
  const first = runs[0];
  const last = runs[runs.length - 1];
  const startVertical = verticalBetween(points, 0, first.from, h);
  const endVertical = verticalBetween(points, last.to, points.length - 1, h);

  if (runs.length === 2) {
    const [left, right] = [...runs].sort((a, b) => a.minX + a.maxX - (b.minX + b.maxX));
    const overlap = Math.min(left.maxX, right.maxX) - Math.max(left.minX, right.minX);
    if (overlap > Math.min(widthOf(left), widthOf(right)) * 0.2) {
      return null;
    }
    const split = crossingX(points, first.to, last.from, cy);
    if (split < left.maxX - 20 || split > right.minX + 20) {
      return null;
    }
    const aAbove = left.side === 'above';
    if (startVertical || endVertical) {
      const xs = points.map(point => point.x);
      return {kind: 'whole', aAbove, left: Math.min(...xs), split, right: Math.max(...xs)};
    }
    return {kind: 'split', aAbove, split, leftRun: [left.minX, left.maxX], rightRun: [right.minX, right.maxX]};
  }

  const run = first;
  if (startVertical && endVertical) {
    return null;
  }
  const vertical = startVertical ?? endVertical;
  if (!vertical) {
    return {kind: 'line'};
  }
  // A corner's vertical crosses the middle of its own line.
  if (vertical.minY > cy + 0.15 * h || vertical.maxY < cy - 0.15 * h) {
    return null;
  }
  const atLeft = vertical.x <= run.minX + widthOf(run) * 0.25;
  const atRight = vertical.x >= run.maxX - widthOf(run) * 0.25;
  if (atLeft === atRight) {
    return null;
  }
  return atLeft
    ? {kind: 'start', aAbove: run.side === 'above', x: vertical.x}
    : {kind: 'end', aAbove: run.side === 'below', x: vertical.x};
}

/** A stroke read as a swap piece on a line of a textbox. */
export type SwapPiece = PieceShape & {lineIndex: number};

function lineMiddle(line: {top: number; bottom: number}) {
  return {cy: (line.top + line.bottom) / 2, h: Math.max(1, line.bottom - line.top)};
}

/**
 * What swap piece a stroke is in a textbox: the line it fits. A piece that fits two lines is
 * unclear and null; a plain line (no vertical) is reported on the first line it fits.
 */
export function analyzeSwapPiece(points: Point[], box: CaretTextbox, rect: Rect): SwapPiece | null {
  const found: SwapPiece[] = [];
  for (const line of box.lines) {
    const {cy, h} = lineMiddle(line);
    if (rect.bottom < line.top - h || rect.top > line.bottom + h) {
      continue;
    }
    const shape = pieceOnLine(points, cy, h);
    if (shape) {
      found.push({...shape, lineIndex: line.index});
    }
  }
  const pieces = found.filter(piece => piece.kind !== 'line');
  if (pieces.length === 1) {
    return pieces[0];
  }
  if (pieces.length === 0 && found.length > 0) {
    return found[0];
  }
  return null;
}

/** A place in the text from a vertical's x on a line; `inside` when it cuts a word. */
export function offsetAtX(
  box: CaretTextbox,
  lineIndex: number,
  x: number,
): {offset: number; inside: boolean} | null {
  const words = box.words.filter(word => word.lineIndex === lineIndex).sort((a, b) => a.left - b.left);
  if (words.length === 0) {
    return null;
  }
  const first = words[0];
  const last = words[words.length - 1];
  if (x <= first.left) {
    return {offset: first.start, inside: false};
  }
  if (x >= last.right) {
    return {offset: last.end, inside: false};
  }
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (x >= word.left && x <= word.right) {
      const length = Math.max(1, word.end - word.start);
      const position = charPositionInWord(word, x);
      if (position < WORD_EDGE_SNAP_CHARS) {
        return {offset: word.start, inside: false};
      }
      if (length - position < WORD_EDGE_SNAP_CHARS) {
        return {offset: word.end, inside: false};
      }
      return {offset: word.start + Math.round(position), inside: true};
    }
    const next = words[index + 1];
    if (next && x > word.right && x < next.left) {
      return {offset: word.end, inside: false};
    }
  }
  return {offset: last.end, inside: false};
}

const SPACE = /\s/;

function forwardOverSpace(text: string, offset: number): number {
  let at = offset;
  while (at < text.length && SPACE.test(text.charAt(at))) {
    at += 1;
  }
  return at;
}

function backOverSpace(text: string, offset: number): number {
  let at = offset;
  while (at > 0 && SPACE.test(text.charAt(at - 1))) {
    at -= 1;
  }
  return at;
}

/** The swapped parts: A is [a0, a1), B is [b0, b1); between them only spaces (the gap). */
export type SwapZones = {a0: number; a1: number; b0: number; b1: number};

export type SwapFound = {
  boxUuid: string;
  strokeUuids: string[];
  zones: SwapZones;
  aAbove: boolean;
  lineIndex: number;
  /** Set when an edge cuts a word: worth a look. */
  uncertain?: string;
};

export type SwapRefused = {strokeUuids: string[]; reason: string};

export const CUT_INSIDE_WORD = 'An edge of the swap is inside a word: check where it cut.';

/**
 * The zones of a swap from its three places, or why it can't be one: both parts need text, and
 * neither the parts nor the gap may hold a paragraph's end.
 */
export function swapZones(
  text: string,
  start: number,
  split: number,
  end: number,
): {zones: SwapZones} | {reason: string} {
  const zones = {
    a0: forwardOverSpace(text, start),
    a1: backOverSpace(text, split),
    b0: forwardOverSpace(text, split),
    b1: backOverSpace(text, end),
  };
  if (zones.a1 <= zones.a0 || zones.b1 <= zones.b0) {
    return {reason: 'One side of the swap has no words.'};
  }
  if (text.slice(zones.a0, zones.b1).includes('\n')) {
    return {reason: 'The swap reaches over the end of a paragraph: both parts must be in one paragraph.'};
  }
  return {zones};
}

/** A swap piece placed on the page, ready for pairing. */
export type PlacedPiece = {
  uuid: string;
  boxUuid: string;
  piece: SwapPiece;
  rect: Rect;
};

/** The minimum length (pixels) of each run of a middle piece used across lines. */
export const SPLIT_RUN_MIN_PX = 60;

/** Word width next to a place on a line: the word left (side -1) or right (side 1) of it. */
function wordWidthBeside(box: CaretTextbox, lineIndex: number, x: number, side: -1 | 1): number {
  const words = box.words.filter(word => word.lineIndex === lineIndex);
  const beside =
    side < 0
      ? words.filter(word => word.left < x).sort((a, b) => b.left - a.left)[0]
      : words.filter(word => word.right > x).sort((a, b) => a.left - b.left)[0];
  return beside ? beside.right - beside.left : 0;
}

/**
 * Swaps from the pieces found on a page's textboxes: a whole one-line mark on its own; a middle
 * piece with the nearest matching start corner before it and end corner after it, in reading
 * order in the same textbox. Plain lines between a swap's first and last line are taken along.
 * Pieces that make no swap come back refused with the reason.
 */
export function pairSwapPieces(
  placed: PlacedPiece[],
  boxes: CaretTextbox[],
): {swaps: SwapFound[]; refused: SwapRefused[]; unusedLines: string[]} {
  const swaps: SwapFound[] = [];
  const refused: SwapRefused[] = [];
  const used = new Set<string>();
  const boxOf = new Map(boxes.map(box => [box.uuid, box]));
  const placeOf = (item: PlacedPiece, x: number) => {
    const box = boxOf.get(item.boxUuid);
    return box ? offsetAtX(box, item.piece.lineIndex, x) : null;
  };

  const accept = (strokes: PlacedPiece[], box: CaretTextbox, places: Array<{offset: number; inside: boolean} | null>, first: PlacedPiece) => {
    const uuids = strokes.map(item => item.uuid);
    if (places.some(place => !place)) {
      refused.push({strokeUuids: uuids, reason: "The swap doesn't sit on words of a line."});
      return;
    }
    const [start, split, end] = places as Array<{offset: number; inside: boolean}>;
    const result = swapZones(box.text, start.offset, split.offset, end.offset);
    if ('reason' in result) {
      refused.push({strokeUuids: uuids, reason: result.reason});
      return;
    }
    uuids.forEach(uuid => used.add(uuid));
    swaps.push({
      boxUuid: box.uuid,
      strokeUuids: uuids,
      zones: result.zones,
      aAbove: (first.piece as {aAbove: boolean}).aAbove,
      lineIndex: first.piece.lineIndex,
      ...(places.some(place => place?.inside) ? {uncertain: CUT_INSIDE_WORD} : {}),
    });
  };

  for (const item of placed) {
    const box = boxOf.get(item.boxUuid);
    if (item.piece.kind !== 'whole' || !box) {
      continue;
    }
    accept([item], box, [placeOf(item, item.piece.left), placeOf(item, item.piece.split), placeOf(item, item.piece.right)], item);
  }

  const offsetOf = (item: PlacedPiece): number | null => {
    const piece = item.piece;
    const x = piece.kind === 'split' ? piece.split : piece.kind === 'start' || piece.kind === 'end' ? piece.x : null;
    return x === null ? null : placeOf(item, x)?.offset ?? null;
  };
  const splits = placed
    .filter(item => item.piece.kind === 'split')
    .map(item => ({item, offset: offsetOf(item)}))
    .sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0));
  for (const {item, offset} of splits) {
    const box = boxOf.get(item.boxUuid);
    const piece = item.piece as Extract<SwapPiece, {kind: 'split'}>;
    const aAbove = piece.aAbove;
    const corners = (kind: 'start' | 'end') =>
      placed
        .filter(
          other =>
            other.boxUuid === item.boxUuid &&
            !used.has(other.uuid) &&
            other.piece.kind === kind &&
            (other.piece as {aAbove: boolean}).aAbove === aAbove,
        )
        .map(other => ({other, at: offsetOf(other)}))
        .filter((entry): entry is {other: PlacedPiece; at: number} => entry.at !== null);
    const start =
      offset === null
        ? undefined
        : corners('start')
            .filter(entry => entry.at <= offset)
            .sort((a, b) => b.at - a.at)[0];
    const end =
      offset === null
        ? undefined
        : corners('end')
            .filter(entry => entry.at >= offset)
            .sort((a, b) => a.at - b.at)[0];
    if (!box || !start || !end || offset === null) {
      continue;
    }
    const otherSplitInside = splits.some(
      entry =>
        entry.item !== item &&
        entry.item.boxUuid === item.boxUuid &&
        entry.offset !== null &&
        entry.offset > start.at &&
        entry.offset < end.at,
    );
    const runsLongEnough =
      piece.leftRun[1] - piece.leftRun[0] >=
        Math.max(SPLIT_RUN_MIN_PX, wordWidthBeside(box, piece.lineIndex, piece.split, -1)) &&
      piece.rightRun[1] - piece.rightRun[0] >=
        Math.max(SPLIT_RUN_MIN_PX, wordWidthBeside(box, piece.lineIndex, piece.split, 1));
    if (otherSplitInside) {
      refused.push({strokeUuids: [item.uuid], reason: 'Two swap middles between one start and one end: swaps may not overlap.'});
      continue;
    }
    if (!runsLongEnough) {
      refused.push({
        strokeUuids: [item.uuid],
        reason: "The swap's middle piece is too short: its lines must reach past the word on each side.",
      });
      continue;
    }
    accept(
      [start.other, item, end.other],
      box,
      [placeOf(start.other, (start.other.piece as {x: number}).x), placeOf(item, piece.split), placeOf(end.other, (end.other.piece as {x: number}).x)],
      start.other,
    );
  }

  // Plain lines between a swap's first and last line are part of it (drawn or not). Only swaps
  // drawn in pieces have them; a one-line mark is one stroke.
  const unusedLines: string[] = [];
  for (const item of placed) {
    if (item.piece.kind !== 'line') {
      continue;
    }
    const swap = swaps.find(found => {
      if (found.boxUuid !== item.boxUuid || found.strokeUuids.length < 3) {
        return false;
      }
      const box = boxOf.get(found.boxUuid);
      const lines = box?.lines.filter(
        line => line.end > found.zones.a0 && line.start < found.zones.b1,
      );
      if (!lines || lines.length === 0) {
        return false;
      }
      const top = Math.min(...lines.map(line => line.top));
      const bottom = Math.max(...lines.map(line => line.bottom));
      const h = Math.max(1, lines[0].bottom - lines[0].top);
      return item.rect.top >= top - h && item.rect.bottom <= bottom + h;
    });
    if (swap) {
      swap.strokeUuids.push(item.uuid);
      used.add(item.uuid);
    } else {
      unusedLines.push(item.uuid);
    }
  }

  for (const item of placed) {
    if (used.has(item.uuid) || item.piece.kind === 'line' || item.piece.kind === 'whole') {
      continue;
    }
    if (refused.some(entry => entry.strokeUuids.includes(item.uuid))) {
      continue;
    }
    refused.push({
      strokeUuids: [item.uuid],
      reason:
        item.piece.kind === 'split'
          ? 'A swap middle piece (or a step) without a start and an end corner. A paragraph break needs a second short line next to its upright (_||‾).'
          : 'A swap corner without its middle piece and other corner.',
    });
  }

  // Swaps that overlap each other are both refused.
  const overlapping = new Set<number>();
  swaps.forEach((a, i) =>
    swaps.forEach((b, j) => {
      if (i < j && a.boxUuid === b.boxUuid && a.zones.a0 < b.zones.b1 && b.zones.a0 < a.zones.b1) {
        overlapping.add(i);
        overlapping.add(j);
      }
    }),
  );
  const kept = swaps.filter((swap, index) => {
    if (overlapping.has(index)) {
      refused.push({strokeUuids: swap.strokeUuids, reason: 'Swaps overlap: draw them one after the other.'});
      return false;
    }
    return true;
  });
  return {swaps: kept, refused, unusedLines};
}
