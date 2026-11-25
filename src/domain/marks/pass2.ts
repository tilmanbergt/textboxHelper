import {pointInRect} from '../geometry';
import {BARE_STEP_REASON} from '../paragraphMarks';
import {spaceRefusal} from '../spaceMark';
import type {PenEditMark} from '../penEditModel';
import type {Rect} from '../textboxModel';
import {intersects, type MarkStroke} from './markStroke';
import {findCarets, readArc, readAtCaret, readParagraphMark, readSlash, verticalsFor, loopFor} from './pass1';
import type {Place, PlaceAt} from './place';
import {gapBetween, placeArc, type ArcPlace} from './place/closeUp';
import {locateCaret, type CaretInsertMode, type CaretTarget} from './place/point';
import {placeSlash, type SlashPlace} from './place/slash';
import {byReadingOrder, onLine, placeStrike, strikeSpan, type StrikeWord} from './place/strike';
import {pairSwapPieces, placeSwapPiece, type PlacedPiece, type SwapZones} from './place/swap';
import type {Reading} from './reading';
import type {CaretDirection, CaretShape} from './shapes/caret';
import {isSwapCandidate} from './shapes/swap';
import {anchorRect, isReplaceLoopRect, strikeShapeRefusal} from './shapes/strike';
import type {CaretTextbox, TextboxView} from './textboxView';

/**
 * Pass 2 (technical-design-mark-dialogue.md §2.5): where readings act in the text, from the
 * readings and the measured textboxes alone. `placeReading` places one reading; `resolvePage`
 * places a whole page in the review's order of consumption (paragraph marks → carets with a
 * circle or cross → swap → close-up → slash → strikes and replace marks), each family reading
 * among the strokes still free: a reading that doesn't place leaves its strokes free for the later
 * families (§13.1 Q3). Measuring is lazy: a textbox not yet measured is reported in `wanted`, and
 * the caller runs it again with that textbox measured.
 */

// ---------------------------------------------------------------------------------------------
// Near the text
// ---------------------------------------------------------------------------------------------

/** Says that a textbox's layout is needed. */
type Want = (view: TextboxView) => void;

/** How far around a mark's tip the textboxes in its column are looked at (pixels). */
const TIP_REACH_X = 120;
const TIP_REACH_Y = 400;
/** How far around a stroke the textboxes a swap piece, an arc or a slash may be on are looked at. */
const NEAR_X = 40;
const NEAR_Y = 60;

export type Located = {near: TextboxView[]; target: CaretTarget | null; locked?: TextboxView};

/**
 * Where a mark's tip points on the page: the textboxes in its column near its tip, located with
 * `locateCaret`. A place inside a textbox whose font can't be read is unclear: its words were
 * measured in the wrong font (technical-design-swap-space-marks.md §2).
 */
export function locateOnPage(tip: {x: number; y: number}, direction: CaretDirection, views: TextboxView[], want: Want = () => undefined): Located {
  const near = views.filter(
    view =>
      tip.x >= view.rect.left - TIP_REACH_X &&
      tip.x <= view.rect.right + TIP_REACH_X &&
      tip.y >= view.rect.top - TIP_REACH_Y &&
      tip.y <= view.rect.bottom + TIP_REACH_Y,
  );
  near.forEach(want);
  const boxes = near.map(view => view.layout).filter((layout): layout is CaretTextbox => !!layout);
  const target = locateCaret(tip, direction, boxes);
  if (target && (target.kind === 'text' || target.kind === 'split')) {
    const hit = near.find(view => view.uuid === target.uuid);
    if (hit && !hit.fontReadable) {
      return {near, target: {kind: 'unclear', reason: hit.lockedReason ?? 'The font of this textbox can\'t be read.'}, locked: hit};
    }
  }
  return {near, target};
}

/** The readable textboxes near a stroke (a swap piece, an arc, a slash), measured. */
function readableNear(rect: Rect, views: TextboxView[], want: Want): CaretTextbox[] {
  const boxes: CaretTextbox[] = [];
  for (const view of views) {
    if (rect.right < view.rect.left - NEAR_X || rect.left > view.rect.right + NEAR_X || rect.bottom < view.rect.top - NEAR_Y || rect.top > view.rect.bottom + NEAR_Y) {
      continue;
    }
    want(view);
    // Marks on an unreadable font are reported by the strike analysis.
    if (view.layout && view.fontReadable) {
      boxes.push(view.layout);
    }
  }
  return boxes;
}

const LINE_END_PIECE =
  'A close-up at a line end needs two arcs: one after the last word of the line, one before the first word of the next. Two paragraphs join only when one is directly above the other.';

const onAnyText = (rect: Rect, views: TextboxView[]) => views.some(view => intersects(rect, view.rect));

// ---------------------------------------------------------------------------------------------
// One reading
// ---------------------------------------------------------------------------------------------

function at(view: TextboxView, lineIndex: number, start: number, end: number, extra: Partial<PlaceAt> = {}): PlaceAt {
  return {uuid: view.uuid, numInPage: view.numInPage, lineIndex, start, end, ...extra};
}

function lineAt(view: TextboxView, offset: number): number {
  return view.layout?.lines.find(line => offset >= line.start && offset < line.end)?.index ?? 0;
}

function refuse(reason: string, onText: boolean, guess: PlaceAt | null = null): Place {
  return {ok: false, reason, guess, onText};
}

/** A caret-like reading's place: a point in a line, a split, or why not. */
function placePoint(reading: Reading, views: TextboxView[], want: Want): Place {
  const shape = (reading.shape as {caret: CaretShape}).caret;
  const onText = reading.rects.some(rect => onAnyText(rect, views));
  const {near, target} = locateOnPage(shape.tip, shape.direction, views, want);
  const view = target && (target.kind === 'text' || target.kind === 'split') ? near.find(item => item.uuid === target.uuid) : undefined;
  if (target?.kind === 'split' && view && (reading.kind === 'sideways' || reading.kind === 'step')) {
    return {ok: true, ...at(view, lineAt(view, target.offset), target.offset, target.offset, {mode: 'split'})};
  }
  if (target?.kind === 'text' && view && reading.kind !== 'sideways' && reading.kind !== 'step') {
    if (reading.kind === 'space') {
      const refusal = spaceRefusal(view.text, target.offset);
      if (refusal) {
        return refuse(refusal, true, at(view, lineAt(view, target.offset), target.offset, target.offset));
      }
    }
    return {
      ok: true,
      ...at(view, lineAt(view, target.offset), target.offset, target.offset, {mode: target.mode, ...(target.uncertain ? {uncertain: target.uncertain} : {})}),
    };
  }
  if (target?.kind === 'unclear') {
    return refuse(target.reason, onText);
  }
  if (reading.kind === 'sideways' || reading.kind === 'step') {
    return refuse(
      target?.kind === 'gap' ? "It is at a paragraph's start or end, which is already a paragraph break." : "It doesn't point between two lines of a paragraph.",
      onText,
    );
  }
  return refuse(
    reading.kind === 'space'
      ? 'The space mark must point into a line of text.'
      : reading.kind === 'punct'
      ? 'The punctuation mark must point into a line of text.'
      : "Its caret doesn't point at a line of text or the space between two paragraphs.",
    onText,
  );
}

function placeSlashReading(reading: Reading, views: TextboxView[], want: Want): {place: Place; raw: SlashPlace | null} {
  const slash = (reading.shape as {slash: Parameters<typeof placeSlash>[0]}).slash;
  let raw: SlashPlace | null = null;
  for (const box of readableNear(reading.rects[0], views, want)) {
    raw = placeSlash(slash, box);
    if (raw) {
      break;
    }
  }
  const onText = onAnyText(reading.rects[0], views);
  if (!raw) {
    return {place: refuse('The slash crosses no letter of a line.', onText), raw};
  }
  const view = views.find(item => item.uuid === raw?.uuid);
  if (raw.kind === 'refused' || !view) {
    return {place: refuse(raw.kind === 'refused' ? raw.reason : 'The slash crosses no letter of a line.', true), raw};
  }
  return {place: {ok: true, ...at(view, raw.lineIndex, raw.offset, raw.offset + 1, raw.uncertain ? {uncertain: raw.uncertain} : {})}, raw};
}

/**
 * Where one reading acts (technical-design-mark-dialogue.md §2.5): a point for a caret, a space
 * or a punctuation mark; a split for < > and a step; a part for a strike (whole words, or exactly
 * between its verticals), a slash (one letter) and a close-up arc (one gap). Swap pieces and arcs
 * at a line end are paired page-wide (`resolvePage`).
 */
export function placeReading(reading: Reading, views: TextboxView[], want: Want = () => undefined): Place {
  switch (reading.kind) {
    case 'caret':
    case 'sideways':
    case 'step':
    case 'space':
    case 'punct':
      return placePoint(reading, views, want);
    case 'slash':
      return placeSlashReading(reading, views, want).place;
    case 'closeUp': {
      const arc = (reading.shape as {arc: Parameters<typeof placeArc>[0]}).arc;
      for (const box of readableNear(reading.rects[0], views, want)) {
        const placed = placeArc(arc, box);
        const view = views.find(item => item.uuid === box.uuid);
        if (placed?.kind === 'gap' && view) {
          return {ok: true, ...at(view, placed.lineIndex, placed.start, placed.end)};
        }
        if (placed?.kind === 'refused') {
          return refuse(placed.reason, true);
        }
        if (placed && placed.kind !== 'gap' && view) {
          return refuse(LINE_END_PIECE, true, at(view, placed.lineIndex, placed.offset, placed.offset));
        }
      }
      return refuse('The arc is under no gap of a line.', onAnyText(reading.rects[0], views));
    }
    case 'swap':
      return refuse('A swap is placed with its pieces, page-wide.', onAnyText(reading.rects[0], views));
    default: {
      const stroke: MarkStroke = {id: reading.strokes[0], numInPage: 0, rect: reading.rects[0], points: null, straightLine: false};
      const placed = placeStrike(stroke, views, strikeShapeRefusal(stroke.rect), want);
      if (!placed.ok) {
        return refuse(placed.reason, placed.removable);
      }
      const verticals = reading.kind === 'strikeVerticals' ? reading.rects.slice(1) : null;
      const span = strikeSpan(placed.words, stroke.rect, verticals);
      return {ok: true, ...at(placed.view, placed.lineIndex, span.start, span.end)};
    }
  }
}

// ---------------------------------------------------------------------------------------------
// A whole page
// ---------------------------------------------------------------------------------------------

/** A stroke of the page by id and number; the strokes are given in page order. */
export type StrokeRef = {id: string; numInPage: number};

/** A page's stroke as read: `stroke` null when the host gave no geometry for it. */
export type PageStroke = StrokeRef & {stroke: MarkStroke | null};

/** The tagged text a stroke is the replace mark of (a strike or a slash), if any. */
export type StrokeOwner = {id: string; number: number; mark: PenEditMark | null};

/** A mark that was ignored: its first stroke, why, and the strokes "Remove" may take (null: none). */
export type Refusal = {first: StrokeRef; reason: string; removable: number[] | null};

export type PageMark =
  | {
      kind: 'line';
      strike: StrokeRef;
      view: TextboxView;
      lineIndex: number;
      /** The words not taken by an earlier strike. */
      words: StrikeWord[];
      span: {start: number; end: number; exact: boolean};
      consumed: number[];
      owner?: StrokeOwner;
    }
  | {kind: 'split'; strokes: StrokeRef[]; view: TextboxView; offset: number; direction: CaretDirection}
  | {kind: 'punct'; strokes: StrokeRef[]; view: TextboxView; offset: number; mode: CaretInsertMode; uncertain?: string; reading: Reading}
  | {kind: 'space'; strokes: StrokeRef[]; view: TextboxView; offset: number; uncertain?: string}
  | {kind: 'swap'; strokes: StrokeRef[]; view: TextboxView; lineIndex: number; zones: SwapZones; uncertain?: string}
  | {kind: 'closeUp'; strokes: StrokeRef[]; view: TextboxView; start: number; end: number; where: string}
  | {kind: 'join'; strokes: StrokeRef[]; upper: TextboxView; lower: TextboxView; lineIndex: number}
  | {kind: 'slash'; strokes: StrokeRef[]; view: TextboxView; lineIndex: number; offset: number; uncertain?: string; owner?: StrokeOwner};

export type PageResult = {
  /** In the order the drafts are made: strikes and replace marks first, then the shape marks. */
  marks: PageMark[];
  /** In the order the review lists them. */
  refused: Refusal[];
  /** Tagged replacements whose mark was found. */
  pairedPenEditIds: string[];
  /** Tagged replacements whose strike is on a textbox whose font can't be read. */
  lockedPenEditIds: string[];
  /** Textboxes whose unreadable font kept a mark from being placed (for the review's one line). */
  lockedViews: string[];
  /** Textboxes pass 2 needs measured: run again with them measured. */
  wanted: string[];
  /** Every decision, for "Save Diagnostics". */
  trace: Array<{stage: string; payload: Record<string, unknown>}>;
};

export const REPLACE_WITHOUT_TEXT =
  'Replace mark without new text: write the new words right after it, lasso them and tap Insertion or Replacement. (A strike with two short verticals and no text deletes exactly what is between them.)';
export const DUPLICATE_STRIKE = 'This marker duplicates text already covered by another recognized marker.';
export const NO_GEOMETRY = 'No usable page-coordinate marker geometry was available.';

/**
 * Whether `lower` is the paragraph directly below `upper`: they overlap by half the narrower one's
 * width, it starts below the upper one, and no other textbox lies between them.
 */
function directlyBelow(upper: Rect, lower: Rect, views: TextboxView[]): boolean {
  const overlap = Math.min(upper.right, lower.right) - Math.max(upper.left, lower.left);
  const narrower = Math.min(upper.right - upper.left, lower.right - lower.left);
  if (overlap < narrower * 0.5 || lower.top < upper.bottom - 4) {
    return false;
  }
  return !views.some(view => {
    const rect = view.rect;
    return (
      rect.top > upper.bottom - 4 &&
      rect.bottom < lower.top + 4 &&
      Math.min(rect.right, upper.right) > Math.max(rect.left, upper.left) &&
      !(rect.top === lower.top && rect.left === lower.left)
    );
  });
}

/**
 * The review's pass 2 on one page (technical-design-mark-dialogue.md §5.1 steps 3, 5, 6): every
 * free stroke read with pass 1, family by family in the order of consumption, and placed.
 * `ownerOf`: the tagged text a stroke is the mark of.
 */
export function resolvePage(
  page: PageStroke[],
  views: TextboxView[],
  options: {ownerOf?: (strokeId: string) => StrokeOwner | undefined} = {},
): PageResult {
  const ownerOf = options.ownerOf ?? (() => undefined);
  const wanted = new Set<string>();
  const want: Want = view => {
    if (!view.measured) {
      wanted.add(view.uuid);
    }
  };
  const viewOf = new Map(views.map(view => [view.uuid, view]));
  const trace: PageResult['trace'] = [];
  const log = (stage: string, payload: Record<string, unknown>) => trace.push({stage, payload});
  const shapeMarks: PageMark[] = [];
  const shapeRefused: Refusal[] = [];
  const lockedViews = new Set<string>();
  const pairedPenEditIds = new Set<string>();
  const consumed = new Set<string>();

  const refOf = new Map(page.map(item => [item.id, {id: item.id, numInPage: item.numInPage}]));
  const refs = (ids: string[]): StrokeRef[] => ids.map(id => refOf.get(id)).filter((ref): ref is StrokeRef => !!ref);
  const refusedFor = (ids: string[], reason: string): Refusal => {
    const parts = refs(ids);
    return {first: parts[0], reason, removable: parts.map(part => part.numInPage)};
  };
  // The shape families read drawn strokes with their points; straight lines only ever strike.
  const strokes = page
    .map(item => item.stroke)
    .filter((stroke): stroke is MarkStroke => !!stroke && !stroke.straightLine && !!stroke.points && stroke.points.length >= 2);
  const free = () => strokes.filter(stroke => !consumed.has(stroke.id));
  const use = (ids: string[]) => ids.forEach(id => consumed.add(id));
  const located = (shape: CaretShape) => {
    const result = locateOnPage(shape.tip, shape.direction, views, want);
    if (result.locked) {
      lockedViews.add(result.locked.uuid);
    }
    return result;
  };

  // 1. Paragraph marks: a < or > between two lines; a step with its second upright.
  const bareSteps: MarkStroke[] = [];
  for (const stroke of strokes) {
    if (consumed.has(stroke.id)) {
      continue;
    }
    const paragraph = readParagraphMark(stroke, free());
    if (!paragraph) {
      continue;
    }
    if (!('reading' in paragraph)) {
      bareSteps.push(stroke);
      continue;
    }
    const reading = paragraph.reading;
    const shape = (reading.shape as {caret: CaretShape}).caret;
    use(reading.strokes);
    const {near, target} = located(shape);
    const view = target?.kind === 'split' ? near.find(item => item.uuid === target.uuid) : undefined;
    log('paragraphMark', {markerNumInPage: stroke.numInPage, direction: shape.direction, secondUpright: refs(reading.strokes)[1]?.numInPage ?? null, tip: shape.tip, target});
    if (target?.kind === 'split' && view) {
      shapeMarks.push({kind: 'split', strokes: refs(reading.strokes), view, offset: target.offset, direction: shape.direction});
      continue;
    }
    const reason =
      target?.kind === 'unclear'
        ? target.reason
        : target?.kind === 'gap'
        ? "It is at a paragraph's start or end, which is already a paragraph break."
        : "It doesn't point between two lines of a paragraph.";
    shapeRefused.push(refusedFor(reading.strokes, reason));
  }

  // 2. A ∧ or V with a filled circle between its legs (punctuation) or a cross at its tip (space).
  const carets = findCarets(free());
  for (const caret of carets) {
    if (caret.legs.some(leg => consumed.has(leg.id))) {
      continue;
    }
    // A caret away from every textbox is ordinary handwriting (a "v" next to an "x").
    const tip = caret.shape.tip;
    if (!views.some(view => pointInRect(tip, {left: view.rect.left - 24, top: view.rect.top - 24, right: view.rect.right + 24, bottom: view.rect.bottom + 24}))) {
      continue;
    }
    const reading = readAtCaret(caret, free());
    if (reading.kind !== 'punct' && reading.kind !== 'space') {
      // An empty circle is the caret's number place: an ordinary caret, which needs tagged text.
      continue;
    }
    use(reading.strokes);
    const {near, target} = located(caret.shape);
    const view = target?.kind === 'text' ? near.find(item => item.uuid === target.uuid) : undefined;
    log(reading.kind === 'punct' ? 'punctuationMark' : 'spaceMark', {markerNums: refs(reading.strokes).map(ref => ref.numInPage), tip, punct: reading.punct ?? null, target});
    if (target?.kind !== 'text' || !view) {
      const fallback = reading.kind === 'punct' ? 'The punctuation mark must point into a line of text.' : 'The space mark must point into a line of text.';
      shapeRefused.push(refusedFor(reading.strokes, target?.kind === 'unclear' ? target.reason : fallback));
      continue;
    }
    if (reading.kind === 'punct') {
      shapeMarks.push({
        kind: 'punct',
        strokes: refs(reading.strokes),
        view,
        offset: target.offset,
        mode: target.mode,
        reading,
        ...(target.uncertain ? {uncertain: target.uncertain} : {}),
      });
      continue;
    }
    const refusal = spaceRefusal(view.text, target.offset);
    if (refusal) {
      shapeRefused.push(refusedFor(reading.strokes, refusal));
      continue;
    }
    shapeMarks.push({kind: 'space', strokes: refs(reading.strokes), view, offset: target.offset, ...(target.uncertain ? {uncertain: target.uncertain} : {})});
  }

  // 3. Swap: each free stroke read as a piece against the lines near it (§13.1 Q1), then paired.
  const placed: PlacedPiece[] = [];
  const boxes = new Map<string, CaretTextbox>();
  for (const stroke of free().filter(isSwapCandidate)) {
    const nearBoxes = readableNear(stroke.rect, views, want);
    const item = placeSwapPiece(stroke.id, stroke.points as NonNullable<MarkStroke['points']>, stroke.rect, nearBoxes);
    if (item) {
      const box = nearBoxes.find(candidate => candidate.uuid === item.boxUuid);
      if (box) {
        boxes.set(box.uuid, box);
      }
      placed.push(item);
    }
  }
  const {swaps, refused: swapRefused} = pairSwapPieces(placed, [...boxes.values()]);
  log('swapPieces', {
    pieces: placed.map(item => ({markerNumInPage: refOf.get(item.uuid)?.numInPage, textbox: viewOf.get(item.boxUuid)?.numInPage, piece: item.piece})),
    swaps: swaps.map(swap => ({zones: swap.zones, strokes: refs(swap.strokeUuids).map(ref => ref.numInPage)})),
    refused: swapRefused,
  });
  for (const swap of swaps) {
    const view = viewOf.get(swap.boxUuid);
    const parts = refs(swap.strokeUuids);
    if (!view || parts.length === 0) {
      continue;
    }
    use(swap.strokeUuids);
    shapeMarks.push({kind: 'swap', strokes: parts, view, lineIndex: swap.lineIndex, zones: swap.zones, ...(swap.uncertain ? {uncertain: swap.uncertain} : {})});
  }
  const strokeById = new Map(strokes.map(stroke => [stroke.id, stroke]));
  for (const entry of swapRefused) {
    const ids = entry.strokeUuids.filter(id => strokeById.has(id) && !consumed.has(id));
    if (ids.length === 0) {
      continue;
    }
    // A swap piece never becomes a strike. Only what lies on a textbox is reported (and offered
    // for Drop); the rest may be handwriting and is left alone.
    use(ids);
    if (ids.every(id => onAnyText((strokeById.get(id) as MarkStroke).rect, views))) {
      shapeRefused.push(refusedFor(ids, entry.reason));
    }
  }
  for (const stepStroke of bareSteps) {
    if (!consumed.has(stepStroke.id)) {
      use([stepStroke.id]);
      shapeRefused.push(refusedFor([stepStroke.id], BARE_STEP_REASON));
    }
  }

  // 4. Close-up: an arc under or over one gap; at a line wrap, an end piece and a start piece.
  type Piece = {stroke: MarkStroke; place: Extract<ArcPlace, {kind: 'end' | 'start'}>; box: CaretTextbox};
  const pieces: Piece[] = [];
  for (const stroke of free()) {
    const reading = readArc(stroke);
    if (!reading || reading.shape.kind !== 'arc') {
      continue;
    }
    const arc = reading.shape.arc;
    let place: ArcPlace | null = null;
    let placedOn: CaretTextbox | null = null;
    for (const box of readableNear(stroke.rect, views, want)) {
      place = placeArc(arc, box);
      if (place) {
        placedOn = box;
        break;
      }
    }
    log('closeUpArc', {markerNumInPage: stroke.numInPage, arc, place});
    if (!place) {
      continue;
    }
    use([stroke.id]);
    const view = viewOf.get(place.uuid);
    if (place.kind === 'refused') {
      shapeRefused.push(refusedFor([stroke.id], place.reason));
    } else if (place.kind === 'gap') {
      if (view) {
        shapeMarks.push({kind: 'closeUp', strokes: refs([stroke.id]), view, start: place.start, end: place.end, where: `line ${place.lineIndex + 1}`});
      }
    } else if (placedOn) {
      pieces.push({stroke, place, box: placedOn});
    }
  }
  const paired = new Set<MarkStroke>();
  for (const end of pieces.filter(piece => piece.place.kind === 'end')) {
    const start = pieces.find(
      piece => piece.place.kind === 'start' && !paired.has(piece.stroke) && piece.place.uuid === end.place.uuid && piece.place.lineIndex === end.place.lineIndex + 1,
    );
    const view = viewOf.get(end.place.uuid);
    const gap = start && view ? gapBetween(view.text, end.place.offset, start.place.offset) : null;
    if (start && gap && view) {
      paired.add(end.stroke);
      paired.add(start.stroke);
      shapeMarks.push({
        kind: 'closeUp',
        strokes: refs([end.stroke.id, start.stroke.id]),
        view,
        start: gap.start,
        end: gap.end,
        where: `lines ${end.place.lineIndex + 1}–${start.place.lineIndex + 1} (line wrap)`,
      });
    }
  }
  // Two paragraphs directly above each other: the end piece after the upper one's last word, the
  // start piece before the lower one's first (fine-marks §7).
  for (const end of pieces.filter(piece => piece.place.kind === 'end' && !paired.has(piece.stroke))) {
    if (end.place.lineIndex !== end.box.lines.length - 1) {
      continue;
    }
    const start = pieces.find(
      piece =>
        piece.place.kind === 'start' &&
        !paired.has(piece.stroke) &&
        piece.place.lineIndex === 0 &&
        piece.box.uuid !== end.box.uuid &&
        directlyBelow(end.box.rect, piece.box.rect, views),
    );
    const upper = viewOf.get(end.box.uuid);
    const lower = start ? viewOf.get(start.box.uuid) : undefined;
    if (!start || !upper || !lower) {
      continue;
    }
    paired.add(end.stroke);
    paired.add(start.stroke);
    shapeMarks.push({kind: 'join', strokes: refs([end.stroke.id, start.stroke.id]), upper, lower, lineIndex: end.place.lineIndex});
  }
  for (const piece of pieces.filter(item => !paired.has(item.stroke))) {
    shapeRefused.push(refusedFor([piece.stroke.id], LINE_END_PIECE));
  }

  // 5. Slash through one letter. A leg of a caret drawn in two strokes is never a slash.
  const caretLegs = new Set(carets.filter(caret => caret.legs.length === 2).flatMap(caret => caret.legs));
  for (const stroke of free()) {
    const reading = consumed.has(stroke.id) ? null : readSlash(stroke, free(), caretLegs);
    if (!reading || reading.shape.kind !== 'slash') {
      continue;
    }
    const {raw} = placeSlashReading(reading, views, want);
    log('slash', {markerNumInPage: stroke.numInPage, rect: reading.shape.slash.rect, angleDeg: reading.shape.slash.angleDeg, place: raw});
    if (!raw) {
      continue;
    }
    use([stroke.id]);
    if (raw.kind === 'refused') {
      shapeRefused.push(refusedFor([stroke.id], raw.reason));
      continue;
    }
    const view = viewOf.get(raw.uuid);
    if (!view) {
      continue;
    }
    const owner = ownerOf(stroke.id);
    if (owner) {
      pairedPenEditIds.add(owner.id);
    }
    // The user's own circle for the number at the slash's top goes with it (fine-marks §2.2).
    use(reading.strokes);
    shapeMarks.push({
      kind: 'slash',
      strokes: refs(reading.strokes),
      view,
      lineIndex: raw.lineIndex,
      offset: raw.offset,
      ...(raw.uncertain ? {uncertain: raw.uncertain} : {}),
      ...(owner ? {owner} : {}),
    });
  }

  // 6. Strikes and replace marks: every stroke still free, in page order.
  const lines = resolveStrikes(page, consumed, views, want, ownerOf, log);
  lines.pairedPenEditIds.forEach(id => pairedPenEditIds.add(id));
  lines.lockedViews.forEach(uuid => lockedViews.add(uuid));

  return {
    marks: [...lines.marks, ...shapeMarks],
    refused: [...shapeRefused, ...lines.refused],
    pairedPenEditIds: [...pairedPenEditIds],
    lockedPenEditIds: lines.lockedPenEditIds,
    lockedViews: [...lockedViews],
    wanted: [...wanted],
    trace,
  };
}

type Candidate = {stroke: MarkStroke; view: TextboxView; lineIndex: number; line: {top: number; bottom: number}; words: StrikeWord[]};

/** Candidates by the stroke's place: top to bottom (1 px slack), then left to right. */
function byMarkerPosition(a: Candidate, b: Candidate): number {
  if (Math.abs(a.stroke.rect.top - b.stroke.rect.top) > 1) {
    return a.stroke.rect.top - b.stroke.rect.top;
  }
  return a.stroke.rect.left - b.stroke.rect.left;
}

/** Candidates of one textbox in text order: by line, first word, place, writing order. */
function byTextOrder(a: Candidate, b: Candidate): number {
  if (a.lineIndex !== b.lineIndex) {
    return a.lineIndex - b.lineIndex;
  }
  const aStart = a.words[0]?.start ?? Number.MAX_SAFE_INTEGER;
  const bStart = b.words[0]?.start ?? Number.MAX_SAFE_INTEGER;
  if (aStart !== bStart) {
    return aStart - bStart;
  }
  if (Math.abs(a.stroke.rect.left - b.stroke.rect.left) > 1) {
    return a.stroke.rect.left - b.stroke.rect.left;
  }
  return a.stroke.numInPage - b.stroke.numInPage;
}

/**
 * Step 6 of `resolvePage`: every free stroke placed as a strike; then, textbox by textbox in text
 * order, its verticals (on its line) or loop among the free strokes, each used once; a strike
 * chosen with Select mark may stand alone. A loop without tagged text has nothing to do; two
 * verticals without text delete exactly between them. Words already taken by an earlier strike
 * are not taken twice.
 */
function resolveStrikes(
  page: PageStroke[],
  consumed: Set<string>,
  views: TextboxView[],
  want: Want,
  ownerOf: (strokeId: string) => StrokeOwner | undefined,
  log: (stage: string, payload: Record<string, unknown>) => void,
): {marks: PageMark[]; refused: Refusal[]; pairedPenEditIds: string[]; lockedPenEditIds: string[]; lockedViews: string[]} {
  const refused: Refusal[] = [];
  const lockedPenEditIds = new Set<string>();
  const lockedViews = new Set<string>();
  const candidates: Candidate[] = [];
  const freeItems = page.filter(item => !consumed.has(item.id));
  for (const item of freeItems) {
    if (!item.stroke) {
      refused.push({first: item, reason: NO_GEOMETRY, removable: null});
      continue;
    }
    const placed = placeStrike(item.stroke, views, strikeShapeRefusal(item.stroke.rect), want);
    log(placed.ok ? 'markerCandidate' : 'markerRejected', {
      markerNumInPage: item.numInPage,
      rect: item.stroke.rect,
      ...(placed.ok ? {textbox: placed.view.numInPage, lineIndex: placed.lineIndex, words: placed.words.map(word => [word.start, word.end])} : {reason: placed.reason, ...(placed.trace ?? {})}),
    });
    if (placed.ok) {
      candidates.push({stroke: item.stroke, view: placed.view, lineIndex: placed.lineIndex, line: placed.line, words: placed.words});
      continue;
    }
    if (placed.locked) {
      lockedViews.add(placed.locked.uuid);
      const owner = ownerOf(item.id);
      if (owner) {
        lockedPenEditIds.add(owner.id);
      }
    }
    refused.push({first: item, reason: placed.reason, removable: placed.removable ? [item.numInPage] : null});
  }
  candidates.sort(byMarkerPosition);

  // The modifiers a strike may take: every free stroke (straight lines too).
  const pool = freeItems.map(item => item.stroke).filter((stroke): stroke is MarkStroke => !!stroke);
  type Info = {pair: MarkStroke[]; numberCircle?: MarkStroke; owner?: StrokeOwner; ignoredReason?: string};
  const info = new Map<string, Info>();
  const pairedPenEditIds = new Set<string>();
  const textboxes = [...new Map(candidates.map(candidate => [candidate.view.uuid, candidate.view])).values()].sort(byReadingOrder);
  for (const view of textboxes) {
    const used = new Set<string>();
    const entries = candidates
      .filter(candidate => candidate.view.uuid === view.uuid)
      .sort(byTextOrder)
      .map(candidate => {
        const verticals = verticalsFor(candidate.stroke, pool.filter(other => onLine(candidate.line, other.rect)));
        const loop = verticals.length === 2 ? null : loopFor(candidate.stroke, pool);
        const pair = verticals.length === 2 ? verticals : loop ? [loop] : [];
        return {candidate, pair};
      })
      .map(entry => ({...entry, numberCircle: entry.pair.length === 2 ? numberCircleAt(entry.pair[1], pool, entry.pair) : undefined}));
    for (const entry of entries) {
      const owner = ownerOf(entry.candidate.stroke.id);
      // A strike selected as a snippet's mark (Select mark) may stand alone: the user said it is a
      // replace mark (technical-design-pen-edits-2.md §4.2).
      const declaredAlone = entry.pair.length === 0 && owner?.mark?.kind === 'replace' && owner.mark.modifierRects.length === 0;
      if (!declaredAlone) {
        if (entry.pair.length === 0 || entry.pair.some(stroke => used.has(stroke.id))) {
          continue;
        }
        entry.pair.forEach(stroke => used.add(stroke.id));
        if (entry.numberCircle) {
          used.add(entry.numberCircle.id);
        }
      }
      if (owner) {
        pairedPenEditIds.add(owner.id);
      }
      // Two verticals mark exact places: without text they delete exactly what is between them
      // (technical-design-fine-marks.md §3.2). A loop without text has nothing to do.
      const verticals = entry.pair.length === 2;
      info.set(entry.candidate.stroke.id, {
        pair: entry.pair,
        ...(entry.numberCircle ? {numberCircle: entry.numberCircle} : {}),
        ...(owner ? {owner} : verticals ? {} : {ignoredReason: REPLACE_WITHOUT_TEXT}),
      });
    }
  }

  const marks: PageMark[] = [];
  const usedRanges = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const strike = {id: candidate.stroke.id, numInPage: candidate.stroke.numInPage};
    const entry = info.get(candidate.stroke.id);
    if (entry?.ignoredReason) {
      refused.push({first: strike, reason: entry.ignoredReason, removable: [strike.numInPage, ...entry.pair.map(stroke => stroke.numInPage)]});
      continue;
    }
    const taken = usedRanges.get(candidate.view.uuid) ?? new Set<string>();
    const words = candidate.words.filter(word => !taken.has(`${word.start}-${word.end}`));
    if (words.length === 0) {
      refused.push({first: strike, reason: DUPLICATE_STRIKE, removable: [strike.numInPage]});
      continue;
    }
    words.forEach(word => taken.add(`${word.start}-${word.end}`));
    usedRanges.set(candidate.view.uuid, taken);
    const pair = entry?.pair ?? [];
    marks.push({
      kind: 'line',
      strike,
      view: candidate.view,
      lineIndex: candidate.lineIndex,
      words,
      span: strikeSpan(words, candidate.stroke.rect, pair.length === 2 ? pair.map(stroke => stroke.rect) : null),
      consumed: [strike.numInPage, ...pair.map(stroke => stroke.numInPage), ...(entry?.numberCircle ? [entry.numberCircle.numInPage] : [])],
      ...(entry?.owner ? {owner: entry.owner} : {}),
    });
  }
  return {marks, refused, pairedPenEditIds: [...pairedPenEditIds], lockedPenEditIds: [...lockedPenEditIds], lockedViews: [...lockedViews]};
}

/**
 * The user's own circle for the number at a replace mark's right vertical: the loop test measured
 * from the vertical's top (technical-design-fine-marks.md §2.2).
 */
function numberCircleAt(rightVertical: MarkStroke, pool: MarkStroke[], taken: MarkStroke[]): MarkStroke | undefined {
  const rect = rightVertical.rect;
  const anchor = anchorRect((rect.left + rect.right) / 2, rect.top);
  return pool.find(other => !taken.includes(other) && isReplaceLoopRect(anchor, other.rect));
}

