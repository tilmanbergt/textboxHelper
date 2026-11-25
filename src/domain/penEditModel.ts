import {isNoShift, type EdgeShift} from './edgeShift';
import type {PenEditKind} from './penEditTags';
import type {Rect} from './textboxModel';

/**
 * The stored pen edits (technical-design-pen-edits.md §3.3): one small index of every entry, and
 * per entry the handwriting it was tagged with. Parsing never throws: an unreadable index is
 * reported as such and the caller keeps the broken file aside.
 */

export const PEN_EDIT_INDEX_VERSION = 1;

/** One handwritten stroke as stored: page-size pixels, x/y pairs flattened. */
export type StoredStroke = {
  thickness: number | null;
  penColor: number | null;
  penType: number | null;
  layerNum: number | null;
  points: number[];
  pressures: number[];
};

export type PageSize = {width: number; height: number};

/** `<id>/strokes.json`: read only for recognition and backups. */
export type PenEditStrokeData = {
  version: number;
  id: string;
  pageSize: PageSize | null;
  strokes: StoredStroke[];
};

/**
 * What a pen edit is paired with. A tagged union so later mark kinds (the caret of
 * technical-design-pen-edits.md §8) need no change to stored entries.
 */
export type PenEditMark =
  | {
      kind: 'replace';
      strikeRect: Rect;
      modifierRects: Rect[];
      /**
       * 'exact' for a strike with two verticals or a slash: the mark says exactly which letters
       * (technical-design-fine-marks.md §3, §4); missing on a loop and on older entries: whole words.
       */
      bounds?: 'exact';
      /** Set for a slash through one letter: `strikeRect` is the slash. */
      slash?: boolean;
      /** The user's own circle for the number, drawn with the mark (§2.2). */
      numberRect?: Rect;
    }
  | {
      kind: 'caret';
      /** The caret stroke's rect at tag time. */
      caretRect: Rect;
      /** Where its tip was: the place in the text. */
      tip: {x: number; y: number};
      /** Where the tip points: 'down' for a V, 'up' for a ∧, 'left' for a <, 'right' for a >. */
      direction: 'down' | 'up' | 'left' | 'right' | 'step';
    };

export type RecognitionStatus = 'waiting' | 'done' | 'empty' | 'failed';

export type PenEditRecognition = {
  status: RecognitionStatus;
  text: string;
  error: string | null;
  ms: number;
};

export type PenEditState = 'active' | 'applied' | 'dropped';

export type PenEditEntry = {
  id: string;
  kind: PenEditKind;
  notePath: string;
  /** 0-based page the tag icon was last found on. */
  page: number;
  /**
   * The number on the page: given when the text is linked to its mark, counting only the linked
   * texts of the page; null while it has none ("?", technical-design-mark-dialogue.md §4.4).
   */
  number: number | null;
  /** ISO time of the tag. */
  createdAt: string;
  /** The lasso rect at tag time, page pixels. */
  rect: Rect;
  /**
   * Where the snippet's strokes and the tag icon were at tag time (the strokes' recognize rects).
   * Element uuids change with every read, so these and the `userData` written onto the strokes
   * are how the snippet is found again; a move is followed through the icon's shift.
   */
  strokeRects: Rect[];
  iconRect: Rect;
  /** True when the snippet strokes and the mark carry this entry's `userData`. */
  strokesTagged: boolean;
  mark: PenEditMark | null;
  /** True when the picture was saved next to the strokes. */
  hasPicture: boolean;
  recognition: PenEditRecognition;
  correctedText: string | null;
  state: PenEditState;
  /** ISO time the entry was applied or dropped; housekeeping removes it some days after. */
  doneAt?: string | null;
  /**
   * Set while the user is asked to draw or lasso this snippet's mark (Select mark,
   * technical-design-pen-edits-2.md §4): the next tap on a few strokes becomes its mark.
   */
  awaitingMark: AwaitingMark | null;
  /** The user's character nudges of the change's edges (review, §6): one entry per edge. */
  edges: EdgeShift | null;
  /**
   * 'here': the user chose "Insert right here" for text without a usable mark: it goes in as a new
   * paragraph where its handwriting starts (technical-design-fine-marks.md §8). Missing: by its mark.
   */
  placement?: 'here';
};

/** Where Select mark was started: the tag's result card, or the review (which opens again). */
export type AwaitingMark = {since: string; from: 'tag' | 'review'};

export type PenEditIndex = {version: number; entries: PenEditEntry[]};

export const EMPTY_PEN_EDIT_INDEX: PenEditIndex = {version: PEN_EDIT_INDEX_VERSION, entries: []};

export const WAITING_RECOGNITION: PenEditRecognition = {status: 'waiting', text: '', error: null, ms: 0};

export type ParsedPenEditIndex = {index: PenEditIndex; broken: boolean; dropped: number};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function parseRect(value: unknown): Rect | null {
  if (!isRecord(value)) {
    return null;
  }
  const {left, top, right, bottom} = value;
  return isFiniteNumber(left) && isFiniteNumber(top) && isFiniteNumber(right) && isFiniteNumber(bottom)
    ? {left, top, right, bottom}
    : null;
}

function parseRects(value: unknown): Rect[] {
  return Array.isArray(value) ? value.map(parseRect).filter((rect): rect is Rect => rect !== null) : [];
}

function parseMark(value: unknown): PenEditMark | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.kind === 'caret') {
    const caretRect = parseRect(value.caretRect);
    const tip = isRecord(value.tip) && isFiniteNumber(value.tip.x) && isFiniteNumber(value.tip.y) ? {x: value.tip.x, y: value.tip.y} : null;
    const direction =
      value.direction === 'up' ||
      value.direction === 'down' ||
      value.direction === 'left' ||
      value.direction === 'right' ||
      value.direction === 'step'
        ? value.direction
        : null;
    return caretRect && tip && direction ? {kind: 'caret', caretRect, tip, direction} : null;
  }
  if (value.kind !== 'replace') {
    return null;
  }
  const strikeRect = parseRect(value.strikeRect);
  if (!strikeRect) {
    return null;
  }
  const numberRect = parseRect(value.numberRect);
  return {
    kind: 'replace',
    strikeRect,
    modifierRects: parseRects(value.modifierRects),
    ...(value.bounds === 'exact' ? {bounds: 'exact' as const} : {}),
    ...(value.slash === true ? {slash: true} : {}),
    ...(numberRect ? {numberRect} : {}),
  };
}

function parseRecognition(value: unknown): PenEditRecognition {
  if (!isRecord(value)) {
    return WAITING_RECOGNITION;
  }
  const statuses: RecognitionStatus[] = ['waiting', 'done', 'empty', 'failed'];
  const status = statuses.includes(value.status as RecognitionStatus) ? (value.status as RecognitionStatus) : 'waiting';
  return {
    status,
    text: isString(value.text) ? value.text : '',
    error: isString(value.error) ? value.error : null,
    ms: isFiniteNumber(value.ms) ? value.ms : 0,
  };
}

/** One entry, or null when a required field is missing or wrong. */
export function parsePenEditEntry(value: unknown): PenEditEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  const rect = parseRect(value.rect);
  const kind =
    value.kind === 'replacement' || value.kind === 'insertion' || value.kind === 'unpaired' ? value.kind : null;
  if (
    !isString(value.id) ||
    !kind ||
    !isString(value.notePath) ||
    !isFiniteNumber(value.page) ||
    !rect
  ) {
    return null;
  }
  const states: PenEditState[] = ['active', 'applied', 'dropped'];
  return {
    id: value.id,
    kind,
    notePath: value.notePath,
    page: value.page,
    // Text without a mark has no number: entries stored with one are read as "?".
    number: kind !== 'unpaired' && isFiniteNumber(value.number) ? value.number : null,
    createdAt: isString(value.createdAt) ? value.createdAt : '',
    rect,
    strokeRects: parseRects(value.strokeRects),
    iconRect: parseRect(value.iconRect) ?? rect,
    strokesTagged: value.strokesTagged === true,
    mark: parseMark(value.mark),
    hasPicture: value.hasPicture === true,
    recognition: parseRecognition(value.recognition),
    correctedText: isString(value.correctedText) ? value.correctedText : null,
    state: states.includes(value.state as PenEditState) ? (value.state as PenEditState) : 'active',
    doneAt: isString(value.doneAt) ? value.doneAt : null,
    awaitingMark: parseAwaitingMark(value.awaitingMark),
    edges: parseEdges(value.edges),
    ...(value.placement === 'here' ? {placement: 'here' as const} : {}),
  };
}

/** Edge nudges: a list of character counts; entries from before 1–3 edges were `{start, end}`. */
function parseEdges(value: unknown): EdgeShift | null {
  const edges = Array.isArray(value)
    ? value
    : isRecord(value)
    ? [value.start, value.end]
    : null;
  if (!edges || !edges.every(isFiniteNumber)) {
    return null;
  }
  return isNoShift(edges as number[]) ? null : (edges as number[]);
}

function parseAwaitingMark(value: unknown): AwaitingMark | null {
  if (!isRecord(value) || !isString(value.since) || (value.from !== 'tag' && value.from !== 'review')) {
    return null;
  }
  return {since: value.since, from: value.from};
}

/**
 * The index file's text -> entries. A missing file (null) is an empty index; text that isn't an
 * index of a known version is `broken` (the caller keeps it aside and starts a new one). Single
 * unreadable entries are dropped and counted.
 */
export function parsePenEditIndex(json: string | null): ParsedPenEditIndex {
  if (json === null || json.trim() === '') {
    return {index: {...EMPTY_PEN_EDIT_INDEX, entries: []}, broken: false, dropped: 0};
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    // silent: reported to the caller as broken
    return {index: {...EMPTY_PEN_EDIT_INDEX, entries: []}, broken: true, dropped: 0};
  }
  if (!isRecord(raw) || raw.version !== PEN_EDIT_INDEX_VERSION || !Array.isArray(raw.entries)) {
    return {index: {...EMPTY_PEN_EDIT_INDEX, entries: []}, broken: true, dropped: 0};
  }
  const entries: PenEditEntry[] = [];
  let dropped = 0;
  for (const item of raw.entries) {
    const entry = parsePenEditEntry(item);
    if (entry) {
      entries.push(entry);
    } else {
      dropped += 1;
    }
  }
  return {index: {version: PEN_EDIT_INDEX_VERSION, entries}, broken: false, dropped};
}

export function serializePenEditIndex(index: PenEditIndex): string {
  return JSON.stringify({version: PEN_EDIT_INDEX_VERSION, entries: index.entries}, null, 1);
}

/** Adds the entry, replacing one with the same id. */
export function upsertPenEdit(index: PenEditIndex, entry: PenEditEntry): PenEditIndex {
  const others = index.entries.filter(existing => existing.id !== entry.id);
  return {version: PEN_EDIT_INDEX_VERSION, entries: [...others, entry]};
}

/** Changes one entry; an unknown id leaves the index as it is. */
export function updatePenEdit(
  index: PenEditIndex,
  id: string,
  change: (entry: PenEditEntry) => PenEditEntry,
): PenEditIndex {
  return {
    version: PEN_EDIT_INDEX_VERSION,
    entries: index.entries.map(entry => (entry.id === id ? change(entry) : entry)),
  };
}

/** Caret rects of the active insertions on a page: a caret pairs with one snippet only. */
export function takenCaretRects(index: PenEditIndex, notePath: string, page: number): Rect[] {
  return activePenEditsOnPage(index, notePath, page)
    .map(entry => (entry.mark?.kind === 'caret' ? entry.mark.caretRect : null))
    .filter((rect): rect is Rect => rect !== null);
}

/** Active entries of one note page. */
export function activePenEditsOnPage(index: PenEditIndex, notePath: string, page: number): PenEditEntry[] {
  return index.entries.filter(entry => entry.state === 'active' && entry.notePath === notePath && entry.page === page);
}

/** Strike rects of the active replacements on a page: a strike pairs with one snippet only. */
export function takenStrikeRects(index: PenEditIndex, notePath: string, page: number): Rect[] {
  return activePenEditsOnPage(index, notePath, page)
    .map(entry => (entry.mark?.kind === 'replace' ? entry.mark.strikeRect : null))
    .filter((rect): rect is Rect => rect !== null);
}

/** The text a pen edit puts into the note: the correction if there is one, else the recognition. */
export function penEditText(entry: PenEditEntry): string {
  if (entry.correctedText !== null) {
    return entry.correctedText;
  }
  return entry.recognition.status === 'done' ? entry.recognition.text : '';
}

/**
 * How long a snippet waits for its mark after Select mark. Later, a tap on a few strokes is an
 * ordinary new tag again: reading it as a mark long after the request would surprise the user.
 */
export const AWAIT_MARK_MS = 5 * 60 * 1000;

/** The most strokes a lasso may hold to be read as the waiting snippet's mark. */
export const MAX_DECLARED_MARK_STROKES = 3;

/**
 * `id` waits for its mark from now on; every other entry stops waiting (only one snippet waits at
 * a time, so the next mark can't be meant for another).
 */
export function setAwaitingMark(
  index: PenEditIndex,
  id: string,
  from: AwaitingMark['from'],
  now: Date,
): PenEditIndex {
  return {
    ...index,
    entries: index.entries.map(entry =>
      entry.id === id
        ? {...entry, awaitingMark: {since: now.toISOString(), from}}
        : entry.awaitingMark
          ? {...entry, awaitingMark: null}
          : entry,
    ),
  };
}

/**
 * "Insert right here" (technical-design-fine-marks.md §8): the text goes in as a new paragraph
 * where its handwriting starts, as an insertion; it stops waiting for a mark.
 */
export function setPlaceHere(index: PenEditIndex, id: string): PenEditIndex {
  return updatePenEdit(index, id, entry => ({
    ...entry,
    kind: 'insertion',
    placement: 'here',
    awaitingMark: null,
  }));
}

/** The active entry of this page still waiting for its mark, if its wait hasn't run out. */
export function awaitingEntry(
  index: PenEditIndex,
  notePath: string,
  page: number,
  now: Date,
): PenEditEntry | null {
  return (
    index.entries.find(entry => {
      if (
        !entry.awaitingMark ||
        entry.state !== 'active' ||
        entry.notePath !== notePath ||
        entry.page !== page
      ) {
        return false;
      }
      const since = Date.parse(entry.awaitingMark.since);
      return Number.isFinite(since) && now.getTime() - since >= 0 && now.getTime() - since <= AWAIT_MARK_MS;
    }) ?? null
  );
}

/** The numbers of the page's linked texts; the next link gets one more than the highest. */
export function linkedNumbersOnPage(index: PenEditIndex, notePath: string, page: number): number[] {
  return activePenEditsOnPage(index, notePath, page)
    .map(entry => entry.number)
    .filter((number): number is number => number !== null);
}

/** The text is linked to its mark: it takes the mark, its kind and its number, and stops waiting. */
export function linkPenEdit(index: PenEditIndex, id: string, mark: PenEditMark, number: number): PenEditIndex {
  return updatePenEdit(index, id, entry => ({
    ...entry,
    kind: kindOfMark(mark),
    mark,
    number,
    awaitingMark: null,
    placement: undefined,
  }));
}

/** The snippet's kind follows from its mark. */
export function kindOfMark(mark: PenEditMark | null): PenEditKind {
  if (!mark) {
    return 'unpaired';
  }
  return mark.kind === 'replace' ? 'replacement' : 'insertion';
}
