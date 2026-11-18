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
export type PenEditMark = {kind: 'replace'; strikeUuid: string; modifierUuids: string[]};

export type RecognitionStatus = 'waiting' | 'done' | 'empty' | 'failed';

export type PenEditRecognition = {
  status: RecognitionStatus;
  text: string;
  error: string | null;
  ms: number;
};

export type PenEditReview = 'open' | 'accepted' | 'skipped';
export type PenEditState = 'active' | 'applied' | 'dropped';

export type PenEditEntry = {
  id: string;
  kind: PenEditKind;
  notePath: string;
  /** 0-based page the tag icon was last found on. */
  page: number;
  number: number;
  /** ISO time of the tag. */
  createdAt: string;
  /** The lasso rect at tag time, page pixels. */
  rect: Rect;
  strokeUuids: string[];
  iconUuid: string | null;
  numberUuids: string[];
  mark: PenEditMark | null;
  /** True when the picture was saved next to the strokes. */
  hasPicture: boolean;
  recognition: PenEditRecognition;
  correctedText: string | null;
  review: PenEditReview;
  state: PenEditState;
};

export type PenEditIndex = {version: number; entries: PenEditEntry[]};

export const EMPTY_PEN_EDIT_INDEX: PenEditIndex = {version: PEN_EDIT_INDEX_VERSION, entries: []};

export const WAITING_RECOGNITION: PenEditRecognition = {status: 'waiting', text: '', error: null, ms: 0};

export type ParsedPenEditIndex = {index: PenEditIndex; broken: boolean; dropped: number};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);

function parseRect(value: unknown): Rect | null {
  if (!isRecord(value)) {
    return null;
  }
  const {left, top, right, bottom} = value;
  return isFiniteNumber(left) && isFiniteNumber(top) && isFiniteNumber(right) && isFiniteNumber(bottom)
    ? {left, top, right, bottom}
    : null;
}

function parseMark(value: unknown): PenEditMark | null {
  if (!isRecord(value) || value.kind !== 'replace' || !isString(value.strikeUuid)) {
    return null;
  }
  return {kind: 'replace', strikeUuid: value.strikeUuid, modifierUuids: isStringArray(value.modifierUuids) ? value.modifierUuids : []};
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
  const kind = value.kind === 'replacement' || value.kind === 'insertion' ? value.kind : null;
  if (
    !isString(value.id) ||
    !kind ||
    !isString(value.notePath) ||
    !isFiniteNumber(value.page) ||
    !isFiniteNumber(value.number) ||
    !rect
  ) {
    return null;
  }
  const reviews: PenEditReview[] = ['open', 'accepted', 'skipped'];
  const states: PenEditState[] = ['active', 'applied', 'dropped'];
  return {
    id: value.id,
    kind,
    notePath: value.notePath,
    page: value.page,
    number: value.number,
    createdAt: isString(value.createdAt) ? value.createdAt : '',
    rect,
    strokeUuids: isStringArray(value.strokeUuids) ? value.strokeUuids : [],
    iconUuid: isString(value.iconUuid) ? value.iconUuid : null,
    numberUuids: isStringArray(value.numberUuids) ? value.numberUuids : [],
    mark: parseMark(value.mark),
    hasPicture: value.hasPicture === true,
    recognition: parseRecognition(value.recognition),
    correctedText: isString(value.correctedText) ? value.correctedText : null,
    review: reviews.includes(value.review as PenEditReview) ? (value.review as PenEditReview) : 'open',
    state: states.includes(value.state as PenEditState) ? (value.state as PenEditState) : 'active',
  };
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

/** Active entries of one note page. */
export function activePenEditsOnPage(index: PenEditIndex, notePath: string, page: number): PenEditEntry[] {
  return index.entries.filter(entry => entry.state === 'active' && entry.notePath === notePath && entry.page === page);
}

/** Strike uuids already paired with an active replacement: a strike pairs with one snippet only. */
export function takenStrikeUuids(index: PenEditIndex): Set<string> {
  const taken = new Set<string>();
  for (const entry of index.entries) {
    if (entry.state === 'active' && entry.mark?.kind === 'replace') {
      taken.add(entry.mark.strikeUuid);
    }
  }
  return taken;
}

/** The text a pen edit puts into the note: the correction if there is one, else the recognition. */
export function penEditText(entry: PenEditEntry): string {
  if (entry.correctedText !== null) {
    return entry.correctedText;
  }
  return entry.recognition.status === 'done' ? entry.recognition.text : '';
}
