import type {Element, TextBox} from 'sn-plugin-lib';
import {buildIgnoredMarker} from '../domain/markerText';
import type {IgnoredEditMarker, OperationDraft, StrokeStats} from '../domain/markerTypes';
import {BARE_STEP_REASON, isSecondUpright} from '../domain/paragraphMarks';
import {
  analyzeCaret,
  analyzeTwoStrokeCaret,
  boundsOf,
  CARET_MAX_SIZE,
  type CaretShape,
  type CaretTextbox,
  type Point,
} from '../domain/penEditCaret';
import {
  findCrossAtCaret,
  spaceRefusal,
  spaceSnippet,
  type ShortStroke,
} from '../domain/spaceMark';
import {analyzeSwapPiece, pairSwapPieces, type PlacedPiece} from '../domain/swapMark';
import {swapSummary} from '../domain/swapText';
import type {Rect} from '../domain/textboxModel';
import {pointInRect} from '../domain/geometry';
import {readStrokePath} from '../supernote/markerStrokeRead';
import {isStraightLineGeometryElement} from '../domain/markerStrokes';
import {logEditMarker} from '../utils/editMarkerLog';
import type {TextboxMeasurer} from './markerMeasure';
import {locateMarkOnPage} from './penEditReview';

/**
 * The marks the review reads from their shape before any delete analysis
 * (technical-design-paragraph-marks.md, technical-design-swap-space-marks.md §6.1), in this order:
 *
 * 1. Paragraph marks: a < or > between two lines; a step with a second upright next to its own.
 * 2. Insert space: a ∧ or V with a cross near its tip.
 * 3. Swap: the one-line mark, or its three pieces across lines.
 *
 * A stroke used by one is used by no other and never reaches the delete analysis. A step alone
 * (no second upright, not part of a swap) is ignored with how to make it either.
 */

type TextElement = Element & {textBox: TextBox};

type Stroke = {
  marker: Element;
  points: Point[];
  rect: Rect;
};

export type ShapeMarkResult = {
  drafts: OperationDraft[];
  ignored: IgnoredEditMarker[];
  /** Marker numbers used or reported here: kept out of the delete analysis. */
  consumedNums: Set<number>;
  /** The textboxes the drafts change. */
  textboxes: Map<string, TextElement>;
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
): Promise<ShapeMarkResult> {
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
      strokes.push({marker, points, rect});
    }
  }
  const free = () => strokes.filter(stroke => !consumed.has(stroke.marker.uuid));
  const use = (items: Stroke[]) => items.forEach(item => consumed.add(item.marker.uuid));

  // 1. Paragraph marks.
  const bareSteps: Stroke[] = [];
  const shapes = new Map<string, CaretShape | null>(
    strokes.map(stroke => [stroke.marker.uuid, analyzeCaret(stroke.points)]),
  );
  for (const stroke of strokes) {
    const shape = shapes.get(stroke.marker.uuid);
    if (!shape || shape.direction === 'up' || shape.direction === 'down' || consumed.has(stroke.marker.uuid)) {
      continue;
    }
    let parts = [stroke];
    if (shape.direction === 'step') {
      const upright = free().find(
        other => other !== stroke && isSecondUpright(shape, other.rect),
      );
      if (!upright) {
        bareSteps.push(stroke);
        continue;
      }
      parts = [stroke, upright];
    }
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

  // 2. Insert space: a ∧ or V (one stroke, or two meeting at the tip) with a cross at its tip.
  const carets: Array<{strokes: Stroke[]; shape: CaretShape}> = [];
  for (const stroke of free()) {
    const shape = shapes.get(stroke.marker.uuid);
    if (shape && (shape.direction === 'up' || shape.direction === 'down')) {
      carets.push({strokes: [stroke], shape});
    }
  }
  // Only strokes of a caret's size can be its legs; handwriting elsewhere is skipped quickly.
  const small = free().filter(
    stroke =>
      !carets.some(caret => caret.strokes.includes(stroke)) &&
      Math.max(stroke.rect.right - stroke.rect.left, stroke.rect.bottom - stroke.rect.top) <= CARET_MAX_SIZE,
  );
  for (let i = 0; i < small.length; i += 1) {
    for (let j = i + 1; j < small.length; j += 1) {
      const shape = analyzeTwoStrokeCaret(small[i].points, small[j].points);
      if (shape && (shape.direction === 'up' || shape.direction === 'down')) {
        carets.push({strokes: [small[i], small[j]], shape});
      }
    }
  }
  for (const caret of carets) {
    if (caret.strokes.some(stroke => consumed.has(stroke.marker.uuid))) {
      continue;
    }
    // A caret away from every textbox is ordinary handwriting (a "v" next to an "x").
    const tip = caret.shape.tip;
    if (!pageTextboxes.some(textbox => pointInRect(tip, inflate(textbox.textBox.textRect, 24)))) {
      continue;
    }
    const reach = 160;
    const legs: ShortStroke[] = free()
      .filter(
        stroke =>
          !caret.strokes.includes(stroke) &&
          stroke.rect.left <= tip.x + reach &&
          stroke.rect.right >= tip.x - reach &&
          stroke.rect.top <= tip.y + reach &&
          stroke.rect.bottom >= tip.y - reach,
      )
      .map(stroke => ({
        uuid: stroke.marker.uuid,
        numInPage: stroke.marker.numInPage,
        rect: stroke.rect,
        points: stroke.points,
      }));
    const cross = findCrossAtCaret(caret.shape, legs);
    if (!cross) {
      continue;
    }
    const crossStrokes = free().filter(stroke => cross.some(leg => leg.uuid === stroke.marker.uuid));
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
  for (const stroke of free()) {
    for (const textbox of pageTextboxes) {
      const rect = textbox.textBox.textRect;
      if (
        stroke.rect.right < rect.left - 40 ||
        stroke.rect.left > rect.right + 40 ||
        stroke.rect.bottom < rect.top - 60 ||
        stroke.rect.top > rect.bottom + 60
      ) {
        continue;
      }
      const measured = await measurer.measure(textbox);
      if (!measured || !measured.fontReadable) {
        // Marks on an unreadable font are reported by the delete analysis.
        continue;
      }
      const piece = analyzeSwapPiece(stroke.points, measured.box, stroke.rect);
      if (piece) {
        boxes.set(textbox.uuid, measured.box);
        placed.push({uuid: stroke.marker.uuid, boxUuid: textbox.uuid, piece, rect: stroke.rect});
        break;
      }
    }
  }
  const {swaps, refused} = pairSwapPieces(placed, [...boxes.values()]);
  const byUuid = new Map(strokes.map(stroke => [stroke.marker.uuid, stroke]));
  const strokesOf = (uuids: string[]) =>
    uuids.map(uuid => byUuid.get(uuid)).filter((stroke): stroke is Stroke => !!stroke);
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
    // Only what lies on a textbox is reported (and offered for Drop); the rest may be handwriting.
    const onText = parts.every(part =>
      pageTextboxes.some(textbox => intersects(part.rect, textbox.textBox.textRect)),
    );
    if (parts.length === 0 || !onText) {
      continue;
    }
    use(parts);
    ignored.push(ignoredFor(parts.map(part => part.marker), entry.reason));
  }
  for (const step of bareSteps) {
    if (!consumed.has(step.marker.uuid)) {
      use([step]);
      ignored.push(ignoredFor([step.marker], BARE_STEP_REASON));
    }
  }

  const consumedNums = new Set(
    strokes.filter(stroke => consumed.has(stroke.marker.uuid)).map(stroke => stroke.marker.numInPage),
  );
  return {drafts, ignored, consumedNums, textboxes};
}
