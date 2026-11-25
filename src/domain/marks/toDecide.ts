import type {RecognizedEditOperation} from '../markerTypes';
import type {Rect} from '../textboxModel';
import {intersects, type MarkStroke} from './markStroke';
import type {PlaceAt} from './place';
import type {Refusal, StrokeRef} from './pass2';
import type {MarkKind, Reading} from './reading';
import {STROKES_NO_MARK} from './reasons';
import type {TextboxView} from './textboxView';
import type {DecideOption} from './decide';

/**
 * To decide (technical-design-mark-dialogue.md §5.2, decision 6): what the review can't make a
 * change of on its own, one problem one item.
 *
 * - `placeOpen`: a linked mark (it has a number on the page) that didn't place: why, and the
 *   nearest sensible place (`guess`) for ‹ › and Here. Also a linked change another change leaves
 *   out (§13.3 Q5).
 * - `noMark`: tagged text without a mark ("?").
 * - `unclear`: strokes on or over the text that no family placed (and a paragraph mark in the
 *   margin beside it): a picture, the words under them, why, the readings pass 1 found. Strokes
 *   refused by the strike family that lie close together over one line form one item (§13.3 Q7).
 *   Strokes away from the text are handwriting: not listed.
 * - `noParagraph`: a comment or image with no paragraph on its page
 *   (technical-design-comments-images.md §5.3): ‹ › choose one on the pages beside it, or Drop.
 */

/** What Ignore remembers of an unclear item: where it is (± 4 px) and a short hash of its points. */
export type IgnoreKey = {rect: Rect; hash: string};

export type ToDecideItem = {
  kind: 'placeOpen' | 'noMark' | 'unclear' | 'noParagraph';
  /** Unique on its page. */
  key: string;
  /** "Replacement 4", "Text ?", "Insertion 2", or what an unclear mark may be ("Slash"). */
  summary: string;
  reason: string;
  penEditId?: string;
  number?: number | null;
  /** Where it is on the page; null when its mark is gone. */
  rect: Rect | null;
  /** Its strokes as flat x,y lists, for the picture (marks; a text's handwriting is loaded apart). */
  strokes: number[][];
  /** The words under it or at its place. */
  words: string;
  /** Unclear: the readings pass 1 found, offered one button each. */
  readings: Reading[];
  /** Place open: the nearest sensible place. */
  guess: PlaceAt | null;
  /** The strokes Remove may delete from the page (on a textbox only, §13.3 Q6). */
  removableNums?: number[];
  /** Insert right here is offered (text without a usable mark). */
  canPlaceHere?: boolean;
  /** Unclear: what Ignore remembers. */
  ignore?: IgnoreKey;
  /** Unclear: its strokes' numbers (a change that took them along hides the item). */
  strokeNums?: number[];
  /** The text of the textbox at its place (for ‹ › and the result line). */
  text?: string;
  /** Which paragraph of the page it is at (1 = the first in reading order), for its row. */
  paragraph?: number;
  /** Unclear: one option per reading pass 1 found (`decide.ts`). */
  options?: DecideOption[];
};

const KIND_NAMES: Record<MarkKind, string> = {
  strike: 'Strike',
  strikeVerticals: 'Strike with two lines',
  replaceVerticals: 'Strike with two lines and a circle',
  replaceLoop: 'Strike with a loop',
  slash: 'Slash',
  caret: 'Caret',
  step: 'Paragraph mark',
  sideways: 'Paragraph mark',
  space: 'Space mark',
  swap: 'Swap',
  closeUp: 'Close-up arc',
  punct: 'Punctuation',
};

/** What an unclear item may be, for its row: the first reading's name, else plain strokes. */
export function unclearSummary(readings: Reading[]): string {
  return readings[0] ? KIND_NAMES[readings[0].kind] : 'Strokes over the text';
}

/** The largest prime below 2^32: the hash stays a whole number well within a double's range. */
const HASH_MODULUS = 4294967291;

/** A short hash of strokes' points (polynomial, whole pixels), to know them again. */
export function strokeHash(strokes: number[][]): string {
  let hash = 17;
  for (const points of strokes) {
    for (const value of points) {
      hash = (hash * 31 + (Math.round(value) + 65536)) % HASH_MODULUS;
    }
    hash = (hash * 31 + 7) % HASH_MODULUS;
  }
  return hash.toString(36);
}

export const IGNORE_SLACK_PX = 4;

/** Whether an item is one the user ignored on this page: the same hash, its rect within 4 px. */
export function isIgnored(key: IgnoreKey, ignored: IgnoreKey[]): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) <= IGNORE_SLACK_PX;
  return ignored.some(
    item =>
      item.hash === key.hash &&
      near(item.rect.left, key.rect.left) &&
      near(item.rect.top, key.rect.top) &&
      near(item.rect.right, key.rect.right) &&
      near(item.rect.bottom, key.rect.bottom),
  );
}

function union(rects: Rect[]): Rect {
  return rects.reduce((all, rect) => ({
    left: Math.min(all.left, rect.left),
    top: Math.min(all.top, rect.top),
    right: Math.max(all.right, rect.right),
    bottom: Math.max(all.bottom, rect.bottom),
  }));
}

/** The words of the textboxes under a rect: on the lines it overlaps, the words it reaches. */
export function wordsUnder(rect: Rect, views: TextboxView[]): string {
  const words: string[] = [];
  for (const view of views) {
    const layout = view.layout;
    if (!layout || !intersects(rect, view.rect)) {
      continue;
    }
    const lines = new Set(layout.lines.filter(line => line.bottom > rect.top && line.top < rect.bottom).map(line => line.index));
    layout.words
      .filter(word => lines.has(word.lineIndex) && word.right > rect.left && word.left < rect.right)
      .forEach(word => words.push(view.text.slice(word.start, word.end)));
  }
  return words.join(' ');
}

/** A stroke's points as a flat list; a straight line (no points read) as its rect's middle line. */
function flat(stroke: MarkStroke): number[] {
  if (stroke.points && stroke.points.length > 0) {
    return stroke.points.flatMap(point => [point.x, point.y]);
  }
  const y = (stroke.rect.top + stroke.rect.bottom) / 2;
  return [stroke.rect.left, y, stroke.rect.right, y];
}

/** How far beside a textbox a paragraph mark is drawn (the < > margin, a step's runs), pixels. */
const MARGIN_REACH_X = 120;
const MARGIN_REACH_Y = 60;

/**
 * Whether refused strokes are an unclear mark rather than handwriting: on or over a textbox, or
 * a paragraph mark (< > or a step, read by pass 1) in the margin beside one.
 */
function onOrBeside(parts: MarkStroke[], refusal: Refusal, views: TextboxView[]): boolean {
  if (parts.some(part => views.some(view => intersects(part.rect, view.rect)))) {
    return true;
  }
  if (!refusal.readings.some(reading => reading.kind === 'sideways' || reading.kind === 'step')) {
    return false;
  }
  return parts.some(part =>
    views.some(view =>
      intersects(part.rect, {
        left: view.rect.left - MARGIN_REACH_X,
        top: view.rect.top - MARGIN_REACH_Y,
        right: view.rect.right + MARGIN_REACH_X,
        bottom: view.rect.bottom + MARGIN_REACH_Y,
      }),
    ),
  );
}

/** How close (pixels) strokes refused by the strike family must be to form one item: a letter. */
function letterGap(rect: Rect, views: TextboxView[]): number {
  const view = views.find(item => intersects(rect, item.rect));
  const line = view?.layout?.lines[0];
  return view?.layout?.xHeight ?? (line ? (line.bottom - line.top) * 0.5 : 24);
}

/** Two rects over one line, at most `gap` apart side by side. */
function together(a: Rect, b: Rect, gap: number): boolean {
  const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  const smaller = Math.min(a.bottom - a.top, b.bottom - b.top);
  const apart = Math.max(a.left, b.left) - Math.min(a.right, b.right);
  return overlap >= smaller * 0.5 && apart <= gap;
}

/**
 * The unclear items of a page from pass 2's refusals: only strokes on or over a textbox; strokes
 * the strike family refused stroke by stroke are joined when close together over one line.
 * `consumed`: strokes a change took along (a loop, a vertical), whose own refusal isn't shown.
 */
export function unclearItems(
  refusals: Refusal[],
  strokes: Map<string, MarkStroke>,
  views: TextboxView[],
  consumed: Set<number> = new Set(),
): ToDecideItem[] {
  type Group = {refusals: Refusal[]; parts: MarkStroke[]};
  const groups: Group[] = [];
  // A stroke a refused mark holds (a loop without text) has its own strike refusal too: one
  // problem, one item.
  const held = new Set(refusals.filter(item => !item.strike).flatMap(item => item.strokes.map(ref => ref.id)));
  for (const refusal of refusals) {
    if (refusal.strike && refusal.strokes.every(ref => held.has(ref.id))) {
      continue;
    }
    const parts = refusal.strokes
      .filter(ref => !consumed.has(ref.numInPage))
      .map(ref => strokes.get(ref.id))
      .filter((stroke): stroke is MarkStroke => !!stroke);
    if (parts.length === 0 || !onOrBeside(parts, refusal, views)) {
      continue;
    }
    const rect = union(parts.map(part => part.rect));
    const joinable = refusal.strike
      ? groups.find(group => group.refusals.every(item => item.strike) && together(union(group.parts.map(part => part.rect)), rect, letterGap(rect, views)))
      : undefined;
    if (joinable) {
      joinable.refusals.push(refusal);
      joinable.parts.push(...parts);
    } else {
      groups.push({refusals: [refusal], parts});
    }
  }
  return groups.map(group => {
    const rect = union(group.parts.map(part => part.rect));
    const pictures = group.parts.map(flat);
    const reasons = [...new Set(group.refusals.map(item => item.reason))];
    const readings = group.refusals.flatMap(item => item.readings);
    const removable = [...new Set(group.refusals.flatMap(item => item.removable ?? []))].filter(num => !consumed.has(num));
    return {
      kind: 'unclear' as const,
      key: `unclear:${group.refusals[0].first.numInPage}`,
      summary: unclearSummary(group.refusals.length === 1 ? readings : []),
      reason: reasons.length === 1 ? reasons[0] : STROKES_NO_MARK,
      rect,
      strokes: pictures,
      words: wordsUnder(rect, views),
      readings: group.refusals.length === 1 ? readings : [],
      guess: null,
      ...(removable.length > 0 ? {removableNums: removable} : {}),
      ignore: {rect, hash: strokeHash(pictures)},
      strokeNums: group.parts.map(part => part.numInPage),
    };
  });
}

/** A change the assembly leaves out (§13.3 Q5): linked -> place open at its place; plain -> unclear. */
export function leftOutItem(
  operation: RecognizedEditOperation,
  reason: string,
  points: Record<number, number[]>,
): ToDecideItem {
  const strokes = operation.consumedMarkerNums.map(num => points[num]).filter((item): item is number[] => !!item && item.length >= 2);
  const rect = strokes.length > 0 ? boundsOfFlat(strokes) : null;
  const place: PlaceAt = {
    uuid: operation.targetTextboxUuid,
    numInPage: operation.targetTextboxNumInPage,
    lineIndex: operation.lineIndex,
    start: operation.textStart,
    end: operation.textStart,
  };
  return operation.penEditId
    ? {
        kind: 'placeOpen',
        key: `open:${operation.id}`,
        summary: operation.summary,
        reason,
        penEditId: operation.penEditId,
        number: operation.penEditNumber ?? null,
        rect,
        strokes,
        words: operation.words.join(' '),
        readings: [],
        guess: place,
      }
    : {
        kind: 'unclear',
        key: `left:${operation.id}`,
        summary: operation.summary,
        reason,
        rect,
        strokes,
        words: operation.words.join(' '),
        readings: [],
        guess: null,
        ...(operation.consumedMarkerNums.length > 0 ? {removableNums: operation.consumedMarkerNums} : {}),
        ...(rect ? {ignore: {rect, hash: strokeHash(strokes)}} : {}),
      };
}

/** Bounds of flat x,y point lists. */
export function boundsOfFlat(strokes: number[][]): Rect {
  const xs = strokes.flatMap(points => points.filter((_, index) => index % 2 === 0));
  const ys = strokes.flatMap(points => points.filter((_, index) => index % 2 === 1));
  return {left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys)};
}

/** The strokes of a page by id, for the pictures. */
export function strokesById(page: Array<StrokeRef & {stroke: MarkStroke | null}>): Map<string, MarkStroke> {
  return new Map(page.filter(item => item.stroke).map(item => [item.id, item.stroke as MarkStroke]));
}

/** The Ignore file: per note and page, the unclear items the user ignored. */
export type IgnoredMarks = {version: 1; notes: Record<string, Record<string, IgnoreKey[]>>};

export const EMPTY_IGNORED_MARKS: IgnoredMarks = {version: 1, notes: {}};

const isRect = (value: unknown): value is Rect =>
  typeof value === 'object' &&
  value !== null &&
  ['left', 'top', 'right', 'bottom'].every(key => typeof (value as Record<string, unknown>)[key] === 'number');

/** The file's text -> its entries; anything unreadable is left out (never throws). */
export function parseIgnoredMarks(json: string | null): IgnoredMarks {
  try {
    const raw = json ? JSON.parse(json) : null;
    if (!raw || raw.version !== 1 || typeof raw.notes !== 'object' || raw.notes === null) {
      return {version: 1, notes: {}};
    }
    const notes: IgnoredMarks['notes'] = {};
    for (const [note, pages] of Object.entries(raw.notes as Record<string, unknown>)) {
      if (typeof pages !== 'object' || pages === null) {
        continue;
      }
      notes[note] = {};
      for (const [page, keys] of Object.entries(pages as Record<string, unknown>)) {
        notes[note][page] = Array.isArray(keys)
          ? keys.filter((key): key is IgnoreKey => isRect(key?.rect) && typeof key?.hash === 'string')
          : [];
      }
    }
    return {version: 1, notes};
  } catch {
    // silent: an unreadable file means nothing is ignored
    return {version: 1, notes: {}};
  }
}

/** The ignored items of one page. */
export function ignoredOnPage(file: IgnoredMarks, notePath: string, page: number): IgnoreKey[] {
  return file.notes[notePath]?.[String(page)] ?? [];
}

/** The file with one more item ignored on a page. */
export function withIgnored(file: IgnoredMarks, notePath: string, page: number, key: IgnoreKey): IgnoredMarks {
  const pages = file.notes[notePath] ?? {};
  const keys = pages[String(page)] ?? [];
  return {version: 1, notes: {...file.notes, [notePath]: {...pages, [String(page)]: [...keys, key]}}};
}

/** Which paragraph of the page (1-based, in reading order) a rect or place is at; undefined when none. */
export function paragraphOf(at: {rect?: Rect | null; uuid?: string}, views: TextboxView[]): number | undefined {
  const ordered = [...views].sort((a, b) => (Math.abs(a.rect.top - b.rect.top) > 1 ? a.rect.top - b.rect.top : a.rect.left - b.rect.left));
  const index = at.uuid
    ? ordered.findIndex(view => view.uuid === at.uuid)
    : at.rect
    ? ordered.findIndex(view => intersects(at.rect as Rect, view.rect))
    : -1;
  return index >= 0 ? index + 1 : undefined;
}
