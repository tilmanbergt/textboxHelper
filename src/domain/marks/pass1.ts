import {isTakenStrike} from '../penEditMatching';
import {NO_MARK_REASON, VERTICALS_NO_TEXT_REASON} from './reasons';
import {BARE_STEP_REASON} from '../paragraphMarks';
import type {Rect} from '../textboxModel';
import {unionRect, type MarkStroke, type Point} from './markStroke';
import type {Anchor, MarkKind, Need, Pass1Group, Reading, ReadingShape, StrokeRole} from './reading';
import {
  analyzeCaret,
  analyzeTwoStrokeCaret,
  CARET_MAX_SIZE,
  isCaretSizedRect,
  isSecondUpright,
  isStepSizedRect,
  type CaretShape,
} from './shapes/caret';
import {analyzeArc} from './shapes/closeUp';
import {findCaretCircle, inCaretOpening, readCircle, type CaretCircle, type PlainStroke} from './shapes/punct';
import {analyzeSlash, isSlashCandidateRect, type SlashShape} from './shapes/slash';
import {findCrossAtCaret, type ShortStroke} from './shapes/space';
import {
  anchorRect,
  closestVerticalPair,
  isReplaceLoopRect,
  isReplaceVertical,
  isStrikeLike,
  nearestLoop,
  strikeShapeRefusal,
} from './shapes/strike';

/**
 * Pass 1 (technical-design-mark-dialogue.md §2.3): what strokes are, from the strokes alone. One
 * set of shape rules (`shapes/`) for the three callers:
 *
 * - `readLookBack`: the tag, the newest mark written right before the text;
 * - `readDeclared`: Select mark, the strokes the user lassoed as one mark;
 * - `readMarks` and the family readers: the review, every free stroke of the page, in the
 *   review's order of consumption (paragraph marks → carets with a circle or cross → close-up →
 *   slash → strikes). Swap pieces are read against a line, in pass 2 (§13.1 Q1). Whether a
 *   reading places in the text is pass 2's: a reading that doesn't place leaves its strokes free
 *   for the later families (§13.1 Q3).
 */

// ---------------------------------------------------------------------------------------------
// Readings
// ---------------------------------------------------------------------------------------------

type Part = {stroke: MarkStroke; role: StrokeRole};

const NEED: Record<MarkKind, Need> = {
  strike: 'part',
  strikeVerticals: 'part',
  replaceLoop: 'part',
  slash: 'part',
  caret: 'point',
  step: 'point',
  sideways: 'point',
  space: 'point',
  swap: 'twoParts',
  closeUp: 'part',
  punct: 'point',
};

function center(rect: Rect): Point {
  return {x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2};
}

function makeReading(
  kind: MarkKind,
  parts: Part[],
  anchors: Anchor[],
  shape: ReadingShape,
  extra: Partial<Pick<Reading, 'direction' | 'punct' | 'numberPlace' | 'flags'>> = {},
): Reading {
  const rects = parts.map(part => ({...part.stroke.rect}));
  return {
    kind,
    need: NEED[kind],
    strokes: parts.map(part => part.stroke.id),
    roles: parts.map(part => part.role),
    anchors,
    band: {top: Math.min(...rects.map(rect => rect.top)), bottom: Math.max(...rects.map(rect => rect.bottom))},
    rects,
    flags: [],
    shape,
    ...extra,
  };
}

/** A strike's two ends at its middle height: whole words between them. */
function strikeAnchors(rect: Rect): Anchor[] {
  const y = center(rect).y;
  return [
    {x: rect.left, y, snap: 'word'},
    {x: rect.right, y, snap: 'word'},
  ];
}

function strokeShape(stroke: MarkStroke): ReadingShape {
  return {kind: 'stroke', points: stroke.points, center: center(stroke.rect)};
}

export function strikeReading(strike: MarkStroke): Reading {
  return makeReading('strike', [{stroke: strike, role: 'mark'}], strikeAnchors(strike.rect), strokeShape(strike));
}

export function verticalsReading(strike: MarkStroke, verticals: MarkStroke[]): Reading {
  const y = center(strike.rect).y;
  return makeReading(
    'strikeVerticals',
    [{stroke: strike, role: 'mark'}, ...verticals.map(stroke => ({stroke, role: 'modifier' as const}))],
    verticals.map(vertical => ({x: center(vertical.rect).x, y, snap: 'char' as const})),
    strokeShape(strike),
  );
}

export function loopReading(strike: MarkStroke, loop: MarkStroke): Reading {
  return makeReading(
    'replaceLoop',
    [
      {stroke: strike, role: 'mark'},
      {stroke: loop, role: 'modifier'},
    ],
    strikeAnchors(strike.rect),
    strokeShape(strike),
  );
}

export function slashReading(stroke: MarkStroke, slash: SlashShape, circle: MarkStroke | null): Reading {
  return makeReading(
    'slash',
    [{stroke, role: 'mark'}, ...(circle ? [{stroke: circle, role: 'number' as const}] : [])],
    [{x: (slash.top.x + slash.bottom.x) / 2, y: (slash.top.y + slash.bottom.y) / 2, snap: 'char'}],
    {kind: 'slash', slash},
    circle ? {numberPlace: {...circle.rect}} : {},
  );
}

/** A caret (V ∧), a sideways caret (< >) or a step, with the strokes that belong to it. */
export function caretReading(legs: MarkStroke[], shape: CaretShape, extra: {upright?: MarkStroke; circle?: MarkStroke} = {}): Reading {
  const kind: MarkKind = shape.direction === 'step' ? 'step' : shape.direction === 'left' || shape.direction === 'right' ? 'sideways' : 'caret';
  const parts: Part[] = [
    ...legs.map(stroke => ({stroke, role: 'mark' as const})),
    ...(extra.upright ? [{stroke: extra.upright, role: 'mark' as const}] : []),
    ...(extra.circle ? [{stroke: extra.circle, role: 'number' as const}] : []),
  ];
  return makeReading(
    kind,
    parts,
    [{x: shape.tip.x, y: shape.tip.y, snap: kind === 'caret' ? 'word' : 'line'}],
    {kind: 'caret', caret: shape},
    {direction: shape.direction, ...(extra.circle ? {numberPlace: {...extra.circle.rect}} : {})},
  );
}

function spaceReading(legs: MarkStroke[], shape: CaretShape, cross: MarkStroke[]): Reading {
  return makeReading(
    'space',
    [...legs.map(stroke => ({stroke, role: 'mark' as const})), ...cross.map(stroke => ({stroke, role: 'modifier' as const}))],
    [{x: shape.tip.x, y: shape.tip.y, snap: 'char'}],
    {kind: 'caret', caret: shape},
    {direction: shape.direction},
  );
}

function punctReading(legs: MarkStroke[], shape: CaretShape, circle: MarkStroke, contents: MarkStroke[], found: CaretCircle): Reading {
  return makeReading(
    'punct',
    [
      ...legs.map(stroke => ({stroke, role: 'mark' as const})),
      {stroke: circle, role: 'modifier'},
      ...contents.map(stroke => ({stroke, role: 'content' as const})),
    ],
    [{x: shape.tip.x, y: shape.tip.y, snap: 'char'}],
    {kind: 'caret', caret: shape},
    {direction: shape.direction, punct: readCircle(found.shape, found.contents)},
  );
}

export function arcReading(stroke: MarkStroke, arc: NonNullable<ReturnType<typeof analyzeArc>>): Reading {
  return makeReading(
    'closeUp',
    [{stroke, role: 'mark'}],
    [
      {x: arc.from.x, y: arc.from.y, snap: 'word'},
      {x: arc.to.x, y: arc.to.y, snap: 'word'},
    ],
    {kind: 'arc', arc},
  );
}

const plain = (stroke: MarkStroke): PlainStroke => ({uuid: stroke.id, rect: stroke.rect, points: stroke.points ?? []});
const short = (stroke: MarkStroke): ShortStroke => ({
  uuid: stroke.id,
  numInPage: stroke.numInPage,
  rect: stroke.rect,
  points: stroke.points ?? [],
});

// ---------------------------------------------------------------------------------------------
// Families, for the review: each reads among the strokes still free, in the review's order.
// ---------------------------------------------------------------------------------------------

/**
 * A paragraph mark at this stroke: a < or > (`sideways`), or a step with its second upright among
 * the free strokes; a step without one is `bare`. Null when the stroke is none of them (V and ∧
 * are the carets' family).
 */
export function readParagraphMark(
  stroke: MarkStroke,
  free: MarkStroke[],
): {reading: Reading} | {bare: true; reason: string} | null {
  const shape = stroke.points && !stroke.straightLine ? analyzeCaret(stroke.points) : null;
  if (!shape || shape.direction === 'up' || shape.direction === 'down') {
    return null;
  }
  if (shape.direction !== 'step') {
    return {reading: caretReading([stroke], shape)};
  }
  const upright = free.find(other => other !== stroke && isSecondUpright(shape, other.rect));
  return upright ? {reading: caretReading([stroke], shape, {upright})} : {bare: true, reason: BARE_STEP_REASON};
}

/** The V and ∧ carets among the strokes: one stroke each, or two short strokes meeting at the tip. */
export function findCarets(strokes: MarkStroke[]): Array<{legs: MarkStroke[]; shape: CaretShape}> {
  const carets: Array<{legs: MarkStroke[]; shape: CaretShape}> = [];
  for (const stroke of strokes) {
    const shape = stroke.points && !stroke.straightLine ? analyzeCaret(stroke.points) : null;
    if (shape && (shape.direction === 'up' || shape.direction === 'down')) {
      carets.push({legs: [stroke], shape});
    }
  }
  // Only strokes of a caret's size can be its legs; handwriting elsewhere is skipped quickly.
  const small = strokes.filter(
    stroke =>
      !!stroke.points &&
      !stroke.straightLine &&
      !carets.some(caret => caret.legs.includes(stroke)) &&
      Math.max(stroke.rect.right - stroke.rect.left, stroke.rect.bottom - stroke.rect.top) <= CARET_MAX_SIZE,
  );
  for (let i = 0; i < small.length; i += 1) {
    for (let j = i + 1; j < small.length; j += 1) {
      const shape = analyzeTwoStrokeCaret(small[i].points as Point[], small[j].points as Point[]);
      if (shape && (shape.direction === 'up' || shape.direction === 'down')) {
        carets.push({legs: [small[i], small[j]], shape});
      }
    }
  }
  return carets;
}

/** How far (pixels) around a caret's tip its circle or cross is looked for. */
const CARET_REACH_PX = 160;

/**
 * What a V or ∧ is with the free strokes around its tip: a filled circle between its legs makes a
 * punctuation mark, an empty one is the caret's number place; a cross near its tip makes a space.
 * The plain caret otherwise.
 */
export function readAtCaret(caret: {legs: MarkStroke[]; shape: CaretShape}, free: MarkStroke[]): Reading {
  const tip = caret.shape.tip;
  const around = free.filter(
    stroke =>
      !caret.legs.includes(stroke) &&
      !!stroke.points &&
      stroke.rect.left <= tip.x + CARET_REACH_PX &&
      stroke.rect.right >= tip.x - CARET_REACH_PX &&
      stroke.rect.top <= tip.y + CARET_REACH_PX &&
      stroke.rect.bottom >= tip.y - CARET_REACH_PX,
  );
  const byId = new Map(around.map(stroke => [stroke.id, stroke]));
  const found = findCaretCircle(caret.shape, around.map(plain));
  if (found) {
    const circle = byId.get(found.circle.uuid) as MarkStroke;
    if (found.contents.length > 0) {
      const contents = found.contents.map(item => byId.get(item.uuid) as MarkStroke);
      return punctReading(caret.legs, caret.shape, circle, contents, found);
    }
    return caretReading(caret.legs, caret.shape, {circle});
  }
  const cross = findCrossAtCaret(caret.shape, around.map(short));
  if (cross) {
    return spaceReading(caret.legs, caret.shape, cross.map(item => byId.get(item.uuid) as MarkStroke));
  }
  return caretReading(caret.legs, caret.shape);
}

/** A close-up arc. */
export function readArc(stroke: MarkStroke): Reading | null {
  const arc = stroke.points && !stroke.straightLine ? analyzeArc(stroke.points) : null;
  return arc ? arcReading(stroke, arc) : null;
}

/** The user's own circle for the number at a point (a slash's top, a right vertical's top). */
function numberCircleAt(x: number, y: number, candidates: MarkStroke[]): MarkStroke | null {
  return candidates.find(other => !other.straightLine && isReplaceLoopRect(anchorRect(x, y), other.rect)) ?? null;
}

/**
 * A slash: a stroke whose points read as one, which is no leg of a two-stroke caret and crosses no
 * strike (a vertical across a strike is that strike's), with the user's own circle for the number
 * at its top when there is one among the free strokes.
 */
export function readSlash(stroke: MarkStroke, free: MarkStroke[], caretLegs: Set<MarkStroke> = new Set()): Reading | null {
  if (caretLegs.has(stroke) || stroke.straightLine || !stroke.points) {
    return null;
  }
  const slash = analyzeSlash(stroke.points);
  if (!slash || free.some(other => other !== stroke && isStrikeLike(other.rect) && intersectsRect(other.rect, stroke.rect))) {
    return null;
  }
  const topX = (slash.rect.left + slash.rect.right) / 2;
  return slashReading(stroke, slash, numberCircleAt(topX, slash.rect.top, free.filter(other => other !== stroke)));
}

function intersectsRect(a: Rect, b: Rect): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

/** The verticals across a strike among the candidates (straight lines too): the closest pair, or []. */
export function verticalsFor(strike: MarkStroke, candidates: MarkStroke[]): MarkStroke[] {
  return closestVerticalPair(
    candidates.filter(other => other.id !== strike.id && isReplaceVertical(strike.rect, other.rect)),
    stroke => stroke.rect,
  );
}

/** The loop after a strike among the candidates, or null. */
export function loopFor(strike: MarkStroke, candidates: MarkStroke[]): MarkStroke | null {
  return nearestLoop(
    strike.rect,
    candidates.filter(other => other.id !== strike.id && !other.straightLine),
    stroke => stroke.rect,
  );
}

/**
 * A strike with what goes with it among the candidates: two verticals (exact bounds, deleted
 * only), else a loop (replaced by tagged text), else the strike alone. Null with the reason when
 * the stroke is no strike.
 */
export function readStrike(stroke: MarkStroke, candidates: MarkStroke[]): {reading: Reading} | {reason: string} {
  const refusal = strikeShapeRefusal(stroke.rect);
  if (refusal) {
    return {reason: refusal};
  }
  const verticals = verticalsFor(stroke, candidates);
  if (verticals.length === 2) {
    return {reading: verticalsReading(stroke, verticals)};
  }
  const loop = loopFor(stroke, candidates);
  return {reading: loop ? loopReading(stroke, loop) : strikeReading(stroke)};
}

/**
 * The review's pass 1 on every free stroke of a page, as if every reading placed (pass 2 frees
 * the strokes of one that doesn't, §13.1 Q3): groups in the order of consumption. A close-up arc
 * that is also strike-like has the strike as its second reading. Strokes in no group are
 * handwriting or swap pieces, which pass 2 reads against the lines (§13.1 Q1).
 */
export function readMarks(strokes: MarkStroke[]): Pass1Group[] {
  const groups: Pass1Group[] = [];
  const used = new Set<string>();
  const free = () => strokes.filter(stroke => !used.has(stroke.id));
  const take = (readings: Reading[], reason: string | null = null, ids?: string[]) => {
    const group = {strokes: ids ?? readings[0].strokes, readings, reason};
    group.strokes.forEach(id => used.add(id));
    groups.push(group);
  };

  for (const stroke of strokes) {
    if (used.has(stroke.id)) {
      continue;
    }
    const paragraph = readParagraphMark(stroke, free());
    if (paragraph && 'reading' in paragraph) {
      take([paragraph.reading]);
    } else if (paragraph) {
      take([], paragraph.reason, [stroke.id]);
    }
  }
  const carets = findCarets(free());
  for (const caret of carets) {
    if (caret.legs.some(leg => used.has(leg.id))) {
      continue;
    }
    take([readAtCaret(caret, free())]);
  }
  for (const stroke of free()) {
    const arc = readArc(stroke);
    if (arc) {
      const strike = readStrike(stroke, []);
      take('reading' in strike ? [arc, strike.reading] : [arc]);
    }
  }
  const caretLegs = new Set(carets.filter(caret => caret.legs.length === 2).flatMap(caret => caret.legs));
  for (const stroke of free()) {
    const slash = used.has(stroke.id) ? null : readSlash(stroke, free(), caretLegs);
    if (slash) {
      take([slash]);
    }
  }
  const strikes = free()
    .filter(stroke => isStrikeLike(stroke.rect))
    .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
  for (const stroke of strikes) {
    if (used.has(stroke.id)) {
      continue;
    }
    const strike = readStrike(stroke, free());
    if ('reading' in strike) {
      take([strike.reading]);
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------------------------
// Select mark
// ---------------------------------------------------------------------------------------------

/**
 * Select mark (technical-design-pen-edits-2.md §4.2): the strokes the user lassoed as one mark.
 * A caret first, as its shape is the more specific (one stroke, or two in writing order meeting
 * at the tip; a step with its second upright); else the widest strike: with two verticals it is
 * an exact delete and takes no text (also with a loop, as in the review and the look-back); with
 * its loop a replace mark; alone it counts too (the user said it is a mark). With no strike, a slash, with its own circle for the number when
 * lassoed along. Strokes that belong to no mark stay out of it.
 */
export function readDeclared(strokes: MarkStroke[]): Pass1Group {
  const ordered = [...strokes].sort((a, b) => a.numInPage - b.numInPage);
  const group = (reading: Reading): Pass1Group => ({strokes: reading.strokes, readings: [reading], reason: null});
  for (const stroke of ordered) {
    const shape = stroke.straightLine || !stroke.points ? null : analyzeCaret(stroke.points);
    if (shape) {
      const upright =
        shape.direction === 'step'
          ? ordered.find(other => other !== stroke && !other.straightLine && isSecondUpright(shape, other.rect))
          : undefined;
      return group(caretReading([stroke], shape, upright ? {upright} : {}));
    }
  }
  for (let i = 0; i + 1 < ordered.length; i += 1) {
    const [first, second] = [ordered[i], ordered[i + 1]];
    const shape = first.points && second.points ? analyzeTwoStrokeCaret(first.points, second.points) : null;
    if (shape) {
      return group(caretReading([first, second], shape));
    }
  }
  const strike = ordered
    .filter(stroke => isStrikeLike(stroke.rect))
    .sort((a, b) => b.rect.right - b.rect.left - (a.rect.right - a.rect.left))[0];
  if (strike) {
    if (verticalsFor(strike, ordered).length === 2) {
      return {strokes: ordered.map(stroke => stroke.id), readings: [], reason: VERTICALS_NO_TEXT_REASON};
    }
    const loop = loopFor(strike, ordered);
    return group(loop ? loopReading(strike, loop) : strikeReading(strike));
  }
  for (const stroke of ordered) {
    const slash = stroke.straightLine || !stroke.points ? null : analyzeSlash(stroke.points);
    if (slash) {
      const topX = (slash.rect.left + slash.rect.right) / 2;
      return group(slashReading(stroke, slash, numberCircleAt(topX, slash.rect.top, ordered.filter(other => other !== stroke))));
    }
  }
  return {strokes: ordered.map(stroke => stroke.id), readings: [], reason: NO_MARK_REASON};
}

// ---------------------------------------------------------------------------------------------
// The tag's look-back
// ---------------------------------------------------------------------------------------------

/** Rects of marks already paired with other text: their strikes and slashes, their carets. */
export type TakenMarks = {strikes: Rect[]; carets: Rect[]};

const newestFirst = (window: MarkStroke[]) => [...window].sort((a, b) => b.numInPage - a.numInPage);

/**
 * The newest replace mark in the window: a strike (long flat stroke or straight line) with a loop
 * after it; a strike with two verticals is an exact delete and is skipped. With `slash`, a slash
 * through one letter written last (or right before its own circle for the number); a window whose
 * strike has a vertical across it holds an unfinished mark, whose vertical is no slash.
 */
export function readLookBackReplace(window: MarkStroke[], taken: Rect[], options: {slash: boolean} = {slash: true}): Reading | null {
  const ordered = newestFirst(window);
  for (const strike of ordered) {
    if (isTakenStrike(strike.rect, taken) || !isStrikeLike(strike.rect)) {
      continue;
    }
    if (verticalsFor(strike, ordered).length === 2) {
      continue;
    }
    const loop = loopFor(strike, ordered);
    if (loop) {
      return loopReading(strike, loop);
    }
  }
  if (!options.slash) {
    return null;
  }
  const unfinished = ordered.some(
    strike =>
      isStrikeLike(strike.rect) &&
      ordered.some(other => other !== strike && isReplaceVertical(strike.rect, other.rect)),
  );
  if (unfinished) {
    return null;
  }
  const [newest, second] = ordered;
  for (const candidate of [newest, second]) {
    if (!candidate || candidate.straightLine || !candidate.points || isTakenStrike(candidate.rect, taken)) {
      continue;
    }
    const slash = analyzeSlash(candidate.points);
    if (!slash) {
      continue;
    }
    const topX = (slash.rect.left + slash.rect.right) / 2;
    const circle = numberCircleAt(
      topX,
      slash.rect.top,
      ordered.filter(other => other !== candidate && other.numInPage > candidate.numInPage),
    );
    if (candidate === newest || circle === newest) {
      return slashReading(candidate, slash, circle);
    }
  }
  return null;
}

/**
 * The caret in the window, newest first: two strokes written one after the other whose ends meet
 * at the tip, or one stroke shaped like a V, ∧, <, > or step, not already paired. A step takes its
 * second upright along; the newest small round stroke in the caret's opening written after it is
 * the user's circle for the number. Strokes without points are skipped.
 */
export function readLookBackCaret(window: MarkStroke[], taken: Rect[]): Reading | null {
  const ordered = newestFirst(window);
  for (const candidate of caretCandidates(ordered, taken)) {
    if (candidate.some(stroke => !stroke.points)) {
      continue;
    }
    const shape =
      candidate.length === 2
        ? analyzeTwoStrokeCaret(candidate[0].points as Point[], candidate[1].points as Point[])
        : analyzeCaret(candidate[0].points as Point[]);
    if (!shape) {
      continue;
    }
    const upright =
      shape.direction === 'step'
        ? window.find(stroke => !candidate.includes(stroke) && !stroke.straightLine && isSecondUpright(shape, stroke.rect))
        : undefined;
    const legs = upright ? [...candidate, upright] : candidate;
    const circle = emptyCircleOf(legs, shape, window);
    return caretReading(candidate, shape, {...(upright ? {upright} : {}), ...(circle ? {circle} : {})});
  }
  return null;
}

/** The caret candidates in reading order: per stroke, newest first, the pair it ends, then itself. */
function caretCandidates(ordered: MarkStroke[], taken: Rect[]): MarkStroke[][] {
  const candidates: MarkStroke[][] = [];
  ordered.forEach((stroke, index) => {
    const older = ordered[index + 1];
    if (older && older.numInPage === stroke.numInPage - 1) {
      const rect = unionRect(older.rect, stroke.rect);
      if (isCaretSizedRect(rect) && !isTakenStrike(rect, taken)) {
        candidates.push([older, stroke]);
      }
    }
    if (!stroke.straightLine && (isCaretSizedRect(stroke.rect) || isStepSizedRect(stroke.rect)) && !isTakenStrike(stroke.rect, taken)) {
      candidates.push([stroke]);
    }
  });
  return candidates;
}

/** The user's circle in a caret's opening, written after the caret: small, round, by its rect. */
function emptyCircleOf(legs: MarkStroke[], shape: CaretShape, window: MarkStroke[]): MarkStroke | null {
  const newestLeg = Math.max(...legs.map(stroke => stroke.numInPage));
  const legLengths = shape.ends.map(end => Math.hypot(end.x - shape.tip.x, end.y - shape.tip.y));
  return (
    window.find(stroke => {
      const rect = stroke.rect;
      const width = rect.right - rect.left;
      const height = rect.bottom - rect.top;
      return (
        !stroke.straightLine &&
        stroke.numInPage > newestLeg &&
        Math.max(width, height) >= 12 &&
        Math.max(width, height) <= Math.max(...legLengths) * 1.2 &&
        Math.min(width, height) >= Math.max(width, height) * 0.6 &&
        inCaretOpening(shape, center(rect))
      );
    }) ?? null
  );
}

/**
 * Which strokes of the window the look-back needs points of: caret-sized strokes and pairs, and
 * the two newest strokes whose rect may hold a slash. Points are read only for these.
 */
export function lookBackPointsWanted(window: MarkStroke[], taken: TakenMarks): Set<string> {
  const ordered = newestFirst(window);
  const wanted = new Set<string>();
  caretCandidates(ordered, taken.carets).forEach(candidate => candidate.forEach(stroke => wanted.add(stroke.id)));
  ordered
    .slice(0, 2)
    .filter(stroke => !stroke.straightLine && isSlashCandidateRect(stroke.rect))
    .forEach(stroke => wanted.add(stroke.id));
  return wanted;
}

/**
 * Which of the marks found in the look-back the text belongs to (technical-design-pen-edits-2.md
 * §3): only a mark written last, right before the text, counts - its strokes must include the
 * newest stroke of the window. When both qualify, a caret that reuses a stroke of the replace mark
 * (a loop read as a caret) is part of that replace mark; a slash and a caret: the caret, the larger
 * shape (a caret's leg is slash-sized); otherwise the newer one wins.
 */
export function pickNewestMark(window: MarkStroke[], replace: Reading | null, caret: Reading | null): 'replace' | 'caret' | null {
  if (window.length === 0) {
    return null;
  }
  const byId = new Map(window.map(stroke => [stroke.id, stroke.numInPage]));
  const newestOf = (ids: string[]) => Math.max(...ids.map(id => byId.get(id) ?? -1));
  const newest = Math.max(...window.map(stroke => stroke.numInPage));
  const replaceIsLast = !!replace && newestOf(replace.strokes) === newest;
  const caretIsLast = !!caret && newestOf(caret.strokes) === newest;
  if (replaceIsLast && caretIsLast && replace?.kind === 'slash') {
    return 'caret';
  }
  if (replaceIsLast && caretIsLast) {
    return (caret as Reading).strokes.some(id => (replace as Reading).strokes.includes(id)) ? 'replace' : 'caret';
  }
  return replaceIsLast ? 'replace' : caretIsLast ? 'caret' : null;
}

/**
 * The tag's look-back (technical-design-pen-edits.md §3.5, decision 11 of the design): the newest
 * mark written right before the text - a replace mark (strike with a loop, or a slash) or a caret.
 * Null when the window holds none written last.
 */
export function readLookBack(window: MarkStroke[], taken: TakenMarks): Reading | null {
  const replace = readLookBackReplace(window, taken.strikes);
  const caret = readLookBackCaret(window, taken.carets);
  const choice = pickNewestMark(window, replace, caret);
  return choice === 'replace' ? replace : choice === 'caret' ? caret : null;
}
