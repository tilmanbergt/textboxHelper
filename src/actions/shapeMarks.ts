import type {Element, TextBox} from 'sn-plugin-lib';
import {buildIgnoredMarker} from '../domain/markerText';
import type {IgnoredEditMarker, OperationDraft, StrokeStats} from '../domain/markerTypes';
import type {CaretTextbox} from '../domain/penEditCaret';
import {spaceRefusal, spaceSnippet} from '../domain/spaceMark';
import {pairSwapPieces, placeSwapPiece, type PlacedPiece} from '../domain/swapMark';
import {closeUpSnippet, gapBetween, placeArc, punctuationAtGap, type ArcPlace} from '../domain/closeUpMark';
import {bracketSnippet} from '../domain/exactBounds';
import {formatOperationSnippet} from '../domain/markerText';
import {BARE_STEP_REASON} from '../domain/paragraphMarks';
import type {PenEditEntry} from '../domain/penEditModel';
import {trailingDash} from '../domain/paragraphJoin';
import {breakCommaTie} from '../domain/punctText';
import {placeSlash} from '../domain/slashMark';
import {swapSummary} from '../domain/swapText';
import type {Rect} from '../domain/textboxModel';
import {pointInRect} from '../domain/geometry';
import {readStrokePath} from '../supernote/markerStrokeRead';
import {isStraightLineGeometryElement} from '../domain/markerStrokes';
import {logEditMarker} from '../utils/editMarkerLog';
import type {TextboxMeasurer} from './markerMeasure';
import {locateMarkOnPage} from './penEditReview';
import type {CaretShape} from '../domain/marks/shapes/caret';
import {boundsOf, type MarkStroke, type Point} from '../domain/marks/markStroke';
import {findCarets, readArc, readAtCaret, readParagraphMark, readSlash} from '../domain/marks/pass1';
import {idsWithRole, type Reading} from '../domain/marks/reading';
import {isSwapCandidate} from '../domain/marks/shapes/swap';

/**
 * The marks the review reads from their shape before any delete analysis
 * (technical-design-paragraph-marks.md, technical-design-swap-space-marks.md §6.1,
 * technical-design-fine-marks.md §2.4), in this order:
 *
 * 1. Paragraph marks: a < or > between two lines; a step with a second upright next to its own.
 * 2. A ∧ or V with a filled circle between its legs (punctuation), or with a cross near its tip
 *    (insert space).
 * 3. Swap: the one-line mark, or its three pieces across lines.
 * 4. Close-up: an arc under or over one word gap; two arcs across a line wrap.
 * 5. Slash: a short steep stroke through one letter (deleted, or replaced by tagged text).
 *
 * What the strokes are is pass 1's (`domain/marks/pass1.ts`), read among the strokes still free at
 * each stage; where they act in the text is placed here. A stroke used by one is used by no other
 * and never reaches the delete analysis; a reading that doesn't place leaves its strokes free for
 * the later stages. A step alone (no second upright, not part of a swap) is ignored with how to
 * make it either.
 */

type TextElement = Element & {textBox: TextBox};

type Stroke = {
  marker: Element;
  points: Point[];
  rect: Rect;
  /** The stroke as pass 1 reads it. */
  mark: MarkStroke;
};

export type ShapeMarkResult = {
  drafts: OperationDraft[];
  ignored: IgnoredEditMarker[];
  /** Marker numbers used or reported here: kept out of the delete analysis. */
  consumedNums: Set<number>;
  /** The textboxes the drafts change. */
  textboxes: Map<string, TextElement>;
  /** Tagged replacements whose mark (a slash) was found here. */
  pairedPenEditIds: Set<string>;
};

export type ShapeMarkOptions = {
  /** The tagged replacement whose mark this stroke is, if any (a slash with text after it). */
  strikeOwner?: (element: Element) => PenEditEntry | undefined;
};

function inflate(rect: Rect, by: number): Rect {
  return {left: rect.left - by, top: rect.top - by, right: rect.right + by, bottom: rect.bottom + by};
}

function intersects(a: Rect, b: Rect): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function ignoredFor(markers: Element[], reason: string): IgnoredEditMarker {
  return {
    ...buildIgnoredMarker(markers[0], reason),
    removableNums: markers.map(marker => marker.numInPage),
  };
}

export async function findShapeMarks(
  markers: Element[],
  strokeStatsByUuid: Map<string, StrokeStats>,
  pageTextboxes: TextElement[],
  measurer: TextboxMeasurer,
  options: ShapeMarkOptions = {},
): Promise<ShapeMarkResult> {
  const pairedPenEditIds = new Set<string>();
  const drafts: OperationDraft[] = [];
  const ignored: IgnoredEditMarker[] = [];
  const consumed = new Set<string>();
  const textboxes = new Map<string, TextElement>();
  const textboxByUuid = new Map(pageTextboxes.map(textbox => [textbox.uuid, textbox]));

  const strokes: Stroke[] = [];
  for (const marker of markers) {
    if (isStraightLineGeometryElement(marker)) {
      continue;
    }
    const points = await readStrokePath(marker);
    const rect = strokeStatsByUuid.get(marker.uuid)?.rect ?? boundsOf(points);
    if (points.length >= 2 && rect) {
      strokes.push({marker, points, rect, mark: {id: marker.uuid, numInPage: marker.numInPage, rect, points, straightLine: false}});
    }
  }
  const byUuid = new Map(strokes.map(stroke => [stroke.marker.uuid, stroke]));
  const strokesOf = (uuids: string[]) =>
    uuids.map(uuid => byUuid.get(uuid)).filter((stroke): stroke is Stroke => !!stroke);
  const free = () => strokes.filter(stroke => !consumed.has(stroke.marker.uuid));
  const freeMarks = () => free().map(stroke => stroke.mark);
  const use = (items: Stroke[]) => items.forEach(item => consumed.add(item.marker.uuid));

  const measuredNear = async (rect: Rect): Promise<CaretTextbox[]> => {
    const boxes: CaretTextbox[] = [];
    for (const textbox of pageTextboxes) {
      const box = textbox.textBox.textRect;
      if (rect.right < box.left - 40 || rect.left > box.right + 40 || rect.bottom < box.top - 60 || rect.top > box.bottom + 60) {
        continue;
      }
      const measured = await measurer.measure(textbox);
      // Marks on an unreadable font are reported by the delete analysis.
      if (measured && measured.fontReadable) {
        boxes.push(measured.box);
      }
    }
    return boxes;
  };

  const addPunctuation = async (caret: {strokes: Stroke[]; shape: CaretShape}, punct: Reading) => {
    const parts = strokesOf(punct.strokes);
    use(parts);
    const {near: nearBoxes, target} = await locateMarkOnPage(caret.shape.tip, caret.shape.direction, pageTextboxes, measurer);
    const textbox = target?.kind === 'text' ? nearBoxes.find(item => item.uuid === target.uuid) : undefined;
    if (target?.kind !== 'text' || !textbox) {
      ignored.push(
        ignoredFor(
          parts.map(part => part.marker),
          target?.kind === 'unclear' ? target.reason : 'The punctuation mark must point into a line of text.',
        ),
      );
      return;
    }
    // Read by the plugin only: a circle it can't read waits for the user's pick in the review
    // (no recognizer, which would slow the page down; technical-design-fine-marks.md As built).
    const reading = punct.punct ?? {char: null, tie: false};
    const char = reading.tie ? breakCommaTie(target.mode) : reading.char;
    const source: 'own' | 'none' = char ? 'own' : 'none';
    logEditMarker('punctuationMark', {
      markerNums: parts.map(part => part.marker.numInPage),
      tip: caret.shape.tip,
      circle: strokesOf(idsWithRole(punct, 'modifier')).map(item => item.rect),
      contents: strokesOf(idsWithRole(punct, 'content')).map(item => item.rect),
      reading,
      char,
      source,
      target,
    });
    textboxes.set(textbox.uuid, textbox);
    drafts.push({
      range: {kind: 'replace', start: target.offset, end: target.offset},
      operation: {
        id: `punct:${caret.strokes[0].marker.uuid}`,
        kind: 'punct',
        markerUuid: caret.strokes[0].marker.uuid,
        markerNumInPage: caret.strokes[0].marker.numInPage,
        consumedMarkerNums: parts.map(part => part.marker.numInPage),
        targetTextboxUuid: textbox.uuid,
        targetTextboxNumInPage: textbox.numInPage,
        lineIndex: 0,
        summary: 'Insert punctuation',
        detail: `Textbox ${textbox.numInPage}`,
        words: [],
        textStart: target.offset,
        punct: {offset: target.offset, mode: target.mode, char, source, tie: reading.tie},
        ...(target.uncertain ? {uncertain: target.uncertain} : {}),
      },
    });
  };

  // 1. Paragraph marks.
  const bareSteps: Stroke[] = [];
  for (const stroke of strokes) {
    if (consumed.has(stroke.marker.uuid)) {
      continue;
    }
    const paragraph = readParagraphMark(stroke.mark, freeMarks());
    if (!paragraph) {
      continue;
    }
    if (!('reading' in paragraph)) {
      bareSteps.push(stroke);
      continue;
    }
    const shape = (paragraph.reading.shape as {caret: CaretShape}).caret;
    const parts = strokesOf(paragraph.reading.strokes);
    use(parts);
    const {near, target} = await locateMarkOnPage(shape.tip, shape.direction, pageTextboxes, measurer);
    const textbox = target?.kind === 'split' ? near.find(item => item.uuid === target.uuid) : undefined;
    logEditMarker('paragraphMark', {
      markerNumInPage: stroke.marker.numInPage,
      direction: shape.direction,
      secondUpright: parts[1]?.marker.numInPage ?? null,
      tip: shape.tip,
      target,
    });
    if (target?.kind === 'split' && textbox) {
      textboxes.set(textbox.uuid, textbox);
      drafts.push({
        range: {kind: 'replace', start: target.offset, end: target.offset},
        operation: {
          id: `split:${stroke.marker.uuid}`,
          kind: 'split',
          markerUuid: stroke.marker.uuid,
          markerNumInPage: stroke.marker.numInPage,
          consumedMarkerNums: parts.map(part => part.marker.numInPage),
          targetTextboxUuid: textbox.uuid,
          targetTextboxNumInPage: textbox.numInPage,
          lineIndex: 0,
          summary: 'Paragraph break',
          detail: `Textbox ${textbox.numInPage} · ${shape.direction === 'step' ? 'at a word gap' : 'between two lines'}`,
          words: [],
          textStart: target.offset,
        },
      });
      continue;
    }
    const reason =
      target?.kind === 'unclear'
        ? target.reason
        : target?.kind === 'gap'
        ? "It is at a paragraph's start or end, which is already a paragraph break."
        : "It doesn't point between two lines of a paragraph.";
    ignored.push(ignoredFor(parts.map(part => part.marker), reason));
  }

  // 2. Insert space: a ∧ or V (one stroke, or two meeting at the tip) with a cross at its tip;
  // punctuation: with a filled circle between its legs.
  const carets = findCarets(freeMarks()).map(caret => ({strokes: strokesOf(caret.legs.map(leg => leg.id)), shape: caret.shape}));
  for (const caret of carets) {
    if (caret.strokes.some(stroke => consumed.has(stroke.marker.uuid))) {
      continue;
    }
    // A caret away from every textbox is ordinary handwriting (a "v" next to an "x").
    const tip = caret.shape.tip;
    if (!pageTextboxes.some(textbox => pointInRect(tip, inflate(textbox.textBox.textRect, 24)))) {
      continue;
    }
    const atCaret = readAtCaret({legs: caret.strokes.map(stroke => stroke.mark), shape: caret.shape}, freeMarks());
    if (atCaret.kind === 'punct') {
      await addPunctuation(caret, atCaret);
      continue;
    }
    // An empty circle is the caret's number place: an ordinary caret, which needs tagged text.
    if (atCaret.kind !== 'space') {
      continue;
    }
    const crossStrokes = strokesOf(idsWithRole(atCaret, 'modifier'));
    const parts = [...caret.strokes, ...crossStrokes];
    use(parts);
    const {near, target} = await locateMarkOnPage(caret.shape.tip, caret.shape.direction, pageTextboxes, measurer);
    logEditMarker('spaceMark', {
      markerNums: parts.map(part => part.marker.numInPage),
      tip: caret.shape.tip,
      target,
    });
    const textbox = target?.kind === 'text' ? near.find(item => item.uuid === target.uuid) : undefined;
    if (target?.kind !== 'text' || !textbox) {
      ignored.push(
        ignoredFor(
          parts.map(part => part.marker),
          target?.kind === 'unclear' ? target.reason : 'The space mark must point into a line of text.',
        ),
      );
      continue;
    }
    const text = textbox.textBox.textContentFull || '';
    const refusal = spaceRefusal(text, target.offset);
    if (refusal) {
      ignored.push(ignoredFor(parts.map(part => part.marker), refusal));
      continue;
    }
    textboxes.set(textbox.uuid, textbox);
    drafts.push({
      range: {kind: 'replace', start: target.offset, end: target.offset, replacementText: ' '},
      operation: {
        id: `space:${caret.strokes[0].marker.uuid}`,
        kind: 'space',
        markerUuid: caret.strokes[0].marker.uuid,
        markerNumInPage: caret.strokes[0].marker.numInPage,
        consumedMarkerNums: parts.map(part => part.marker.numInPage),
        targetTextboxUuid: textbox.uuid,
        targetTextboxNumInPage: textbox.numInPage,
        lineIndex: 0,
        summary: `Space · ${spaceSnippet(text, target.offset)}`,
        detail: `Textbox ${textbox.numInPage} · ${spaceSnippet(text, target.offset)}`,
        words: [],
        textStart: target.offset,
        ...(target.uncertain ? {uncertain: target.uncertain} : {}),
      },
    });
  }

  // 3. Swap: pieces on readable textboxes, then paired.
  const placed: PlacedPiece[] = [];
  const boxes = new Map<string, CaretTextbox>();
  for (const stroke of free().filter(item => isSwapCandidate(item.mark))) {
    const nearBoxes = await measuredNear(stroke.rect);
    const item = placeSwapPiece(stroke.marker.uuid, stroke.points, stroke.rect, nearBoxes);
    if (item) {
      const box = nearBoxes.find(candidate => candidate.uuid === item.boxUuid);
      if (box) {
        boxes.set(box.uuid, box);
      }
      placed.push(item);
    }
  }
  const {swaps, refused} = pairSwapPieces(placed, [...boxes.values()]);
  logEditMarker('swapPieces', {
    pieces: placed.map(item => ({
      markerNumInPage: byUuid.get(item.uuid)?.marker.numInPage,
      textbox: textboxByUuid.get(item.boxUuid)?.numInPage,
      piece: item.piece,
    })),
    swaps: swaps.map(swap => ({zones: swap.zones, strokes: strokesOf(swap.strokeUuids).map(s => s.marker.numInPage)})),
    refused,
  });
  for (const swap of swaps) {
    const parts = strokesOf(swap.strokeUuids);
    const textbox = textboxByUuid.get(swap.boxUuid);
    if (!textbox || parts.length === 0) {
      continue;
    }
    use(parts);
    textboxes.set(textbox.uuid, textbox);
    const text = textbox.textBox.textContentFull || '';
    const {a0, a1, b0, b1} = swap.zones;
    const a = text.slice(a0, a1);
    const b = text.slice(b0, b1);
    drafts.push({
      range: {kind: 'replace', start: a0, end: b1, replacementText: `${b}${text.slice(a1, b0)}${a}`},
      operation: {
        id: `swap:${parts[0].marker.uuid}`,
        kind: 'swap',
        markerUuid: parts[0].marker.uuid,
        markerNumInPage: parts[0].marker.numInPage,
        consumedMarkerNums: parts.map(part => part.marker.numInPage),
        targetTextboxUuid: textbox.uuid,
        targetTextboxNumInPage: textbox.numInPage,
        lineIndex: swap.lineIndex,
        summary: `Swap · ${swapSummary(a, b)}`,
        detail: `Textbox ${textbox.numInPage} · line ${swap.lineIndex + 1}`,
        words: [a, b],
        textStart: a0,
        swap: {zones: swap.zones, fixCase: true, capsAvailable: false},
        ...(swap.uncertain ? {uncertain: swap.uncertain} : {}),
      },
    });
  }
  for (const entry of refused) {
    const parts = strokesOf(entry.strokeUuids).filter(stroke => !consumed.has(stroke.marker.uuid));
    if (parts.length === 0) {
      continue;
    }
    // A swap piece never becomes a delete. Only what lies on a textbox is reported (and offered
    // for Drop); the rest may be handwriting and is left alone.
    use(parts);
    const onText = parts.every(part =>
      pageTextboxes.some(textbox => intersects(part.rect, textbox.textBox.textRect)),
    );
    if (onText) {
      ignored.push(ignoredFor(parts.map(part => part.marker), entry.reason));
    }
  }
  for (const step of bareSteps) {
    if (!consumed.has(step.marker.uuid)) {
      use([step]);
      ignored.push(ignoredFor([step.marker], BARE_STEP_REASON));
    }
  }

  // 4. Close-up: an arc under or over one gap; at a line wrap, an end piece and a start piece.
  const pieces: Array<{stroke: Stroke; place: Extract<ArcPlace, {kind: 'end' | 'start'}>; box: CaretTextbox}> = [];
  for (const stroke of free()) {
    const arcReading = readArc(stroke.mark);
    if (!arcReading || arcReading.shape.kind !== 'arc') {
      continue;
    }
    const arc = arcReading.shape.arc;
    let place: ArcPlace | null = null;
    let placedOn: CaretTextbox | null = null;
    for (const box of await measuredNear(stroke.rect)) {
      place = placeArc(arc, box);
      if (place) {
        placedOn = box;
        break;
      }
    }
    logEditMarker('closeUpArc', {markerNumInPage: stroke.marker.numInPage, arc, place});
    if (!place) {
      continue;
    }
    use([stroke]);
    if (place.kind === 'refused') {
      ignored.push(ignoredFor([stroke.marker], place.reason));
    } else if (place.kind === 'gap') {
      addCloseUp([stroke], place.uuid, place.start, place.end, `line ${place.lineIndex + 1}`);
    } else if (placedOn) {
      pieces.push({stroke, place, box: placedOn});
    }
  }
  const pairedPieces = new Set<Stroke>();
  for (const end of pieces.filter(piece => piece.place.kind === 'end')) {
    const start = pieces.find(
      piece =>
        piece.place.kind === 'start' &&
        !pairedPieces.has(piece.stroke) &&
        piece.place.uuid === end.place.uuid &&
        piece.place.lineIndex === end.place.lineIndex + 1,
    );
    const text = textboxByUuid.get(end.place.uuid)?.textBox.textContentFull || '';
    const gap = start ? gapBetween(text, end.place.offset, start.place.offset) : null;
    if (start && gap) {
      pairedPieces.add(end.stroke);
      pairedPieces.add(start.stroke);
      addCloseUp(
        [end.stroke, start.stroke],
        end.place.uuid,
        gap.start,
        gap.end,
        `lines ${end.place.lineIndex + 1}–${start.place.lineIndex + 1} (line wrap)`,
      );
    }
  }
  // Two paragraphs directly above each other: the end piece after the upper one's last word, the
  // start piece before the lower one's first (fine-marks §7).
  for (const end of pieces.filter(piece => piece.place.kind === 'end' && !pairedPieces.has(piece.stroke))) {
    if (end.place.lineIndex !== end.box.lines.length - 1) {
      continue;
    }
    const start = pieces.find(
      piece =>
        piece.place.kind === 'start' &&
        !pairedPieces.has(piece.stroke) &&
        piece.place.lineIndex === 0 &&
        piece.box.uuid !== end.box.uuid &&
        directlyBelow(end.box.rect, piece.box.rect, pageTextboxes),
    );
    const upper = textboxByUuid.get(end.box.uuid);
    const lower = start ? textboxByUuid.get(start.box.uuid) : undefined;
    if (!start || !upper || !lower) {
      continue;
    }
    pairedPieces.add(end.stroke);
    pairedPieces.add(start.stroke);
    use([end.stroke, start.stroke]);
    textboxes.set(upper.uuid, upper);
    textboxes.set(lower.uuid, lower);
    const upperText = upper.textBox.textContentFull || '';
    const lowerText = lower.textBox.textContentFull || '';
    drafts.push({
      range: {kind: 'replace', start: upperText.length, end: upperText.length},
      operation: {
        id: `join:${end.stroke.marker.uuid}`,
        kind: 'join',
        markerUuid: end.stroke.marker.uuid,
        markerNumInPage: end.stroke.marker.numInPage,
        consumedMarkerNums: [end.stroke.marker.numInPage, start.stroke.marker.numInPage],
        targetTextboxUuid: upper.uuid,
        targetTextboxNumInPage: upper.numInPage,
        lineIndex: end.place.lineIndex,
        summary: `Join · "…${upperText.trimEnd().slice(-16)}" + "${lowerText.trimStart().slice(0, 16)}…"`,
        detail: `Textboxes ${upper.numInPage} + ${lower.numInPage}`,
        words: [],
        textStart: upperText.length,
        join: {
          belowUuid: lower.uuid,
          belowNumInPage: lower.numInPage,
          hyphen: trailingDash(upperText),
          removeHyphen: false,
        },
      },
    });
  }
  for (const piece of pieces.filter(item => !pairedPieces.has(item.stroke))) {
    ignored.push(
      ignoredFor(
        [piece.stroke.marker],
        'A close-up at a line end needs two arcs: one after the last word of the line, one before the first word of the next. Two paragraphs join only when one is directly above the other.',
      ),
    );
  }

  // 5. Slash through one letter. A leg of a caret drawn in two strokes is never a slash.
  const caretLegs = new Set(carets.filter(caret => caret.strokes.length === 2).flatMap(caret => caret.strokes.map(leg => leg.mark)));
  for (const stroke of free()) {
    const reading = consumed.has(stroke.marker.uuid) ? null : readSlash(stroke.mark, freeMarks(), caretLegs);
    if (!reading || reading.shape.kind !== 'slash') {
      continue;
    }
    const slash = reading.shape.slash;
    let place: ReturnType<typeof placeSlash> = null;
    for (const box of await measuredNear(stroke.rect)) {
      place = placeSlash(slash, box);
      if (place) {
        break;
      }
    }
    logEditMarker('slash', {markerNumInPage: stroke.marker.numInPage, rect: slash.rect, angleDeg: slash.angleDeg, place});
    if (!place) {
      continue;
    }
    use([stroke]);
    if (place.kind === 'refused') {
      ignored.push(ignoredFor([stroke.marker], place.reason));
      continue;
    }
    const textbox = textboxByUuid.get(place.uuid);
    if (!textbox) {
      continue;
    }
    const owner = options.strikeOwner?.(stroke.marker);
    if (owner) {
      pairedPenEditIds.add(owner.id);
    }
    // The user's own circle for the number at the slash's top goes with it (fine-marks §2.2).
    const parts = strokesOf(reading.strokes);
    use(parts);
    const text = textbox.textBox.textContentFull || '';
    const shown = bracketSnippet(text, place.offset, place.offset + 1);
    const kind = owner ? 'replace' : 'delete';
    textboxes.set(textbox.uuid, textbox);
    drafts.push({
      range: {kind, start: place.offset, end: place.offset + 1},
      operation: {
        id: `${stroke.marker.uuid}:${textbox.uuid}`,
        kind,
        markerUuid: stroke.marker.uuid,
        markerNumInPage: stroke.marker.numInPage,
        consumedMarkerNums: parts.map(part => part.marker.numInPage),
        targetTextboxUuid: textbox.uuid,
        targetTextboxNumInPage: textbox.numInPage,
        lineIndex: place.lineIndex,
        summary: formatOperationSnippet(kind, [shown]),
        detail: `Textbox ${textbox.numInPage}, line ${place.lineIndex + 1} - 1 letter`,
        words: [shown],
        textStart: place.offset,
        ...(place.uncertain ? {uncertain: place.uncertain} : {}),
        ...(owner ? {penEditId: owner.id, penEditNumber: owner.number} : {}),
      },
    });
  }

  const consumedNums = new Set(
    strokes.filter(stroke => consumed.has(stroke.marker.uuid)).map(stroke => stroke.marker.numInPage),
  );
  return {drafts, ignored, consumedNums, textboxes, pairedPenEditIds};

  function addCloseUp(parts: Stroke[], uuid: string, start: number, end: number, where: string): void {
    const textbox = textboxByUuid.get(uuid);
    if (!textbox) {
      return;
    }
    const text = textbox.textBox.textContentFull || '';
    textboxes.set(uuid, textbox);
    drafts.push({
      range: {kind: 'replace', start, end, replacementText: '', joins: true},
      operation: {
        id: `closeUp:${parts[0].marker.uuid}`,
        kind: 'closeUp',
        markerUuid: parts[0].marker.uuid,
        markerNumInPage: parts[0].marker.numInPage,
        consumedMarkerNums: parts.map(part => part.marker.numInPage),
        targetTextboxUuid: uuid,
        targetTextboxNumInPage: textbox.numInPage,
        lineIndex: 0,
        summary: `Close up · ${closeUpSnippet(text, start, end)}`,
        detail: `Textbox ${textbox.numInPage} · ${where}`,
        words: [],
        textStart: start,
        closeUp: {gapStart: start, gapEnd: end, punct: punctuationAtGap(text, start, end), removePunct: false},
      },
    });
  }
}

/**
 * Whether `lower` is the paragraph directly below `upper`: they overlap by half the narrower one's
 * width, it starts below the upper one, and no other textbox lies between them.
 */
function directlyBelow(upper: Rect, lower: Rect, textboxes: TextElement[]): boolean {
  const overlap = Math.min(upper.right, lower.right) - Math.max(upper.left, lower.left);
  const narrower = Math.min(upper.right - upper.left, lower.right - lower.left);
  if (overlap < narrower * 0.5 || lower.top < upper.bottom - 4) {
    return false;
  }
  return !textboxes.some(textbox => {
    const rect = textbox.textBox.textRect;
    return (
      rect.top > upper.bottom - 4 &&
      rect.bottom < lower.top + 4 &&
      Math.min(rect.right, upper.right) > Math.max(rect.left, upper.left) &&
      !(rect.top === lower.top && rect.left === lower.left)
    );
  });
}
