import type {Element} from 'sn-plugin-lib';
import {buildRecognizeRect, isSupportedEditMarkerElement} from '../domain/markerStrokes';
import {matchByRects, rectShift, rectsMatch, shiftRect} from '../domain/penEditMatching';
import type {InsertionDraft, PenEditView, PenTextState} from '../domain/markerTypes';
import {
  updatePenEdit,
  type PenEditEntry,
  type PenEditReview,
  type PenEditStrokeData,
} from '../domain/penEditModel';
import {locateCaret, type CaretDirection, type CaretInsertMode, type CaretTextbox} from '../domain/penEditCaret';
import {boundsOfPoints, isPenEditDecoration, parsePenEditUserData} from '../domain/penEditTags';
import {normalizeRecognizedText} from '../domain/penEditText';
import {textLeftX, type TextboxMeasurementCalibration} from '../domain/textboxLayout';
import {DEFAULT_FONT_SIZE, type Rect, type TextElementData} from '../domain/textboxModel';
import {
  changePenEditIndex,
  penEditPictureUri,
  readPenEditIndex,
  readPenEditStrokes,
} from '../storage/penEditStore';
import {recognizeStrokes} from '../supernote/strokeRecognition';
import {measureDetailedTextLayout} from '../supernote/textboxMetrics';

/**
 * The pen edits' side of the edit-marker review (technical-design-pen-edits.md §3.6–§3.9):
 * which tagged snippets are on the page, their stored text, recognizing one and storing the
 * result, skips and corrections, and what apply has to remove or keep.
 */

export type PenEditContext = {
  entries: PenEditEntry[];
  /** True for the pen edits' badges, numbers and snippet strokes: never marker candidates. */
  isExcluded: (element: Element) => boolean;
  /** The pen edit whose replace mark has this strike, if any. */
  strikeOwner: (element: Element) => PenEditEntry | undefined;
  /** Each entry's snippet on the page now (its strokes' bounds, or where it was tagged, shifted). */
  snippetRects: Map<string, Rect>;
  /** Each insertion's caret as it is on the page now: its tip moved with the caret. */
  carets: Map<string, {tip: {x: number; y: number}; direction: CaretDirection}>;
  states: Record<string, PenTextState>;
  views: PenEditView[];
  warning: string | null;
};

export const EMPTY_PEN_EDIT_CONTEXT: PenEditContext = {
  entries: [],
  isExcluded: element => isPenEditDecoration(element),
  strikeOwner: () => undefined,
  snippetRects: new Map(),
  carets: new Map(),
  states: {},
  views: [],
  warning: null,
};

export function stateOf(entry: PenEditEntry): PenTextState {
  return {
    status: entry.recognition.status,
    text: entry.recognition.text,
    correctedText: entry.correctedText,
    review: entry.review,
  };
}

/** An element's rect: the host's recognize rect, or a straight line's or polygon's points. */
export function elementRect(element: Element): Rect | null {
  return buildRecognizeRect(element.recognizeResult) ?? boundsOfPoints(element.geometry?.points ?? []);
}

/** A pen edit as found on the page now. */
export type ResolvedPenEdit = {
  badge: Element | null;
  /** The badges and numbers of this entry. */
  decorations: Element[];
  strokes: Element[];
  strike: Element | null;
  /** The strike and its verticals, when they carry the tag. */
  markElements: Element[];
  shift: {dx: number; dy: number};
};

function unionRects(rects: Rect[]): Rect | null {
  return rects.reduce<Rect | null>(
    (all, rect) =>
      all
        ? {
            left: Math.min(all.left, rect.left),
            top: Math.min(all.top, rect.top),
            right: Math.max(all.right, rect.right),
            bottom: Math.max(all.bottom, rect.bottom),
          }
        : {...rect},
    null,
  );
}

/**
 * Finds an entry's parts among `elements`: by their `userData` first, by place as a fallback (the
 * snippet's strokes shifted like its badge; the strike where it was).
 */
export function resolvePenEdit(entry: PenEditEntry, elements: Element[]): ResolvedPenEdit {
  let badge: Element | null = null;
  const decorations: Element[] = [];
  const taggedStrokes: Element[] = [];
  const markElements: Element[] = [];
  const untagged: Array<{element: Element; rect: Rect | null}> = [];
  for (const element of elements) {
    const tag = parsePenEditUserData(element.userData);
    if (!tag) {
      if (isSupportedEditMarkerElement(element)) {
        untagged.push({element, rect: elementRect(element)});
      }
      continue;
    }
    if (tag.id !== entry.id) {
      continue;
    }
    if (tag.role === 'snippet') {
      badge = element;
      decorations.push(element);
    } else if (tag.role === 'stroke') {
      taggedStrokes.push(element);
    } else if (tag.role === 'mark') {
      markElements.push(element);
    } else {
      decorations.push(element);
    }
  }
  const shift = rectShift(entry.iconRect, badge ? elementRect(badge) : null);
  const strokes =
    taggedStrokes.length > 0
      ? taggedStrokes
      : matchByRects(entry.strokeRects, untagged, shift).map(item => item.element);
  let strike: Element | null = null;
  if (entry.mark) {
    const strikeRect = entry.mark.kind === 'replace' ? entry.mark.strikeRect : entry.mark.caretRect;
    const candidates =
      markElements.length > 0
        ? markElements.map(element => ({element, rect: elementRect(element)}))
        : untagged;
    strike = matchByRects([strikeRect], candidates)[0]?.element ?? null;
    if (!strike && markElements.length > 0) {
      // Tagged but moved: the widest tagged stroke is the strike.
      strike = [...markElements].sort((a, b) => width(elementRect(b)) - width(elementRect(a)))[0];
    }
  }
  return {badge, decorations, strokes, strike, markElements, shift};
}

function width(rect: Rect | null): number {
  return rect ? rect.right - rect.left : 0;
}

/**
 * Brings the stored entries in line with the page as it is now: an active entry of this page
 * whose badge is gone (erased, or tagged by an earlier build) is dropped, so the next tag's number
 * counts only what is on the page; an entry whose badge is on this page but stored elsewhere (the
 * page moved) gets this page. Returns the new index when something changed.
 */
async function syncPenEditsWithPage(notePath: string, page: number, idsOnPage: Set<string>) {
  const {index} = await readPenEditIndex();
  const stale = index.entries.filter(
    entry => entry.state === 'active' && entry.notePath === notePath && entry.page === page && !idsOnPage.has(entry.id),
  );
  const moved = index.entries.filter(
    entry => entry.state === 'active' && idsOnPage.has(entry.id) && (entry.notePath !== notePath || entry.page !== page),
  );
  if (stale.length === 0 && moved.length === 0) {
    return null;
  }
  console.log('[PenEditReview] synced with page', JSON.stringify({page, dropped: stale.length, moved: moved.length}));
  return changePenEditIndex(current => {
    let next = current;
    stale.forEach(entry => {
      next = updatePenEdit(next, entry.id, item => ({...item, state: 'dropped'}));
    });
    moved.forEach(entry => {
      next = updatePenEdit(next, entry.id, item => ({...item, notePath, page}));
    });
    return next;
  });
}

/**
 * The active pen edits whose badge is on the page. With a lasso, only those with a tagged part
 * (or their strike) in the lasso.
 */
export async function loadPenEditContext(
  notePath: string,
  page: number,
  pageElements: Element[],
  lassoElements: Element[] | null,
): Promise<PenEditContext> {
  const idsOnPage = new Set<string>();
  for (const element of pageElements) {
    const tag = parsePenEditUserData(element.userData);
    if (tag?.role === 'snippet') {
      idsOnPage.add(tag.id);
    }
  }
  let index;
  const warning: string | null = null;
  try {
    index = (await syncPenEditsWithPage(notePath, page, idsOnPage)) ?? (await readPenEditIndex()).index;
  } catch (error) {
    console.warn('[PenEditReview] index not read', String(error));
    return idsOnPage.size === 0 ? EMPTY_PEN_EDIT_CONTEXT : {...EMPTY_PEN_EDIT_CONTEXT, warning: 'The tagged replacements could not be read.'};
  }
  if (idsOnPage.size === 0) {
    return EMPTY_PEN_EDIT_CONTEXT;
  }
  const onPage = index.entries.filter(entry => entry.state === 'active' && idsOnPage.has(entry.id));

  // Every tagged snippet's strokes stay out of the markers, also outside the lasso. Element uuids
  // differ between the page read and the lasso read, so the fallback compares places.
  const excludedRects: Rect[] = [];
  const snippetRects = new Map<string, Rect>();
  const strikeRects = new Map<string, Rect>();
  const carets: PenEditContext['carets'] = new Map();
  for (const entry of onPage) {
    const resolved = resolvePenEdit(entry, pageElements);
    const rects = resolved.strokes.map(elementRect).filter((rect): rect is Rect => rect !== null);
    excludedRects.push(...rects);
    snippetRects.set(entry.id, unionRects(rects) ?? shiftRect(entry.rect, resolved.shift.dx, resolved.shift.dy));
    const markRect = resolved.strike ? elementRect(resolved.strike) : null;
    if (entry.mark?.kind === 'replace' && markRect) {
      strikeRects.set(entry.id, markRect);
    }
    const caretRect =
      entry.mark?.kind === 'caret'
        ? unionRects(resolved.markElements.map(elementRect).filter((rect): rect is Rect => rect !== null))
        : null;
    if (entry.mark?.kind === 'caret' && caretRect) {
      // A caret (one stroke or two) is never a delete marker; its tip moves with it.
      resolved.markElements.forEach(element => {
        const rect = elementRect(element);
        if (rect) {
          excludedRects.push(rect);
        }
      });
      const {dx, dy} = rectShift(entry.mark.caretRect, caretRect);
      carets.set(entry.id, {tip: {x: entry.mark.tip.x + dx, y: entry.mark.tip.y + dy}, direction: entry.mark.direction});
    }
  }
  const caretIds = new Set(onPage.filter(entry => entry.mark?.kind === 'caret').map(entry => entry.id));
  const byId = new Map(onPage.map(entry => [entry.id, entry]));

  const isExcluded = (element: Element): boolean => {
    const tag = parsePenEditUserData(element.userData);
    if (tag) {
      return tag.role !== 'mark' || caretIds.has(tag.id);
    }
    const rect = elementRect(element);
    return !!rect && excludedRects.some(other => rectsMatch(rect, other));
  };
  const strikeOwner = (element: Element): PenEditEntry | undefined => {
    const tag = parsePenEditUserData(element.userData);
    if (tag?.role === 'mark' && strikeRects.has(tag.id)) {
      return byId.get(tag.id);
    }
    const rect = elementRect(element);
    if (!rect) {
      return undefined;
    }
    for (const [id, strikeRect] of strikeRects) {
      if (rectsMatch(rect, strikeRect)) {
        return byId.get(id);
      }
    }
    return undefined;
  };

  const lassoIds = new Set<string>();
  const lassoRects: Rect[] = [];
  for (const element of lassoElements ?? []) {
    const tag = parsePenEditUserData(element.userData);
    if (tag) {
      lassoIds.add(tag.id);
    }
    const rect = elementRect(element);
    if (rect) {
      lassoRects.push(rect);
    }
  }
  const inLasso = (entry: PenEditEntry): boolean => {
    if (!lassoElements || lassoIds.has(entry.id)) {
      return true;
    }
    const strikeRect = strikeRects.get(entry.id);
    return !!strikeRect && lassoRects.some(rect => rectsMatch(rect, strikeRect));
  };

  const entries = onPage.filter(inLasso).sort((a, b) => a.number - b.number);
  const states: Record<string, PenTextState> = {};
  const views: PenEditView[] = [];
  for (const entry of entries) {
    states[entry.id] = stateOf(entry);
    views.push({
      id: entry.id,
      kind: entry.kind,
      number: entry.number,
      pictureUri: entry.hasPicture ? await penEditPictureUri(entry.id) : null,
    });
  }
  return {entries, isExcluded, strikeOwner, snippetRects, carets, states, views, warning};
}

/** An insertion whose caret points into a paragraph: the text goes in there. */
export type CaretInline = {entry: PenEditEntry; textbox: TextElementData; offset: number; mode: CaretInsertMode};

/**
 * Where each insertion goes (technical-design-pen-edits.md As built, caret): into the paragraph
 * its caret points to, or as a new paragraph in the space between two. Only the textboxes in the
 * caret's column near its tip are measured. An insertion without a usable caret comes back with
 * the reason.
 */
export async function placeCaretInsertions<T extends TextElementData>(
  entries: PenEditEntry[],
  carets: PenEditContext['carets'],
  pageTextboxes: T[],
  calibration: TextboxMeasurementCalibration,
): Promise<{inline: Array<CaretInline & {textbox: T}>; gaps: InsertionDraft[]; ignored: Array<{entry: PenEditEntry; reason: string}>}> {
  const inline: Array<CaretInline & {textbox: T}> = [];
  const gaps: InsertionDraft[] = [];
  const ignored: Array<{entry: PenEditEntry; reason: string}> = [];
  const measured = new Map<string, CaretTextbox>();
  for (const entry of entries) {
    if (entry.kind !== 'insertion') {
      continue;
    }
    const caret = carets.get(entry.id);
    if (!caret) {
      ignored.push({
        entry,
        reason:
          entry.mark?.kind === 'caret'
            ? 'Its caret is no longer on the page.'
            : 'No caret was found just before it when it was tagged: draw a caret (V, ∧, < or >) where it goes and tag it again.',
      });
      continue;
    }
    const near = pageTextboxes.filter(textbox => {
      const rect = textbox.textBox.textRect;
      return caret.tip.x >= rect.left - 120 && caret.tip.x <= rect.right + 120 && caret.tip.y >= rect.top - 400 && caret.tip.y <= rect.bottom + 400;
    });
    const boxes: CaretTextbox[] = [];
    for (const textbox of near) {
      const known = measured.get(textbox.uuid) ?? (await measureCaretTextbox(textbox, calibration));
      if (known) {
        measured.set(textbox.uuid, known);
        boxes.push(known);
      }
    }
    const target = locateCaret(caret.tip, caret.direction, boxes);
    if (!target) {
      ignored.push({entry, reason: "Its caret doesn't point at a line of text or the space between two paragraphs."});
      continue;
    }
    if (target.kind === 'text') {
      const textbox = near.find(item => item.uuid === target.uuid);
      if (textbox) {
        inline.push({entry, textbox, offset: target.offset, mode: target.mode});
      }
      continue;
    }
    const above = near.find(item => item.uuid === target.above) ?? null;
    const below = near.find(item => item.uuid === target.below) ?? null;
    const styleSource = above ?? below;
    if (!styleSource) {
      continue;
    }
    const rect = styleSource.textBox.textRect;
    gaps.push({
      penEditId: entry.id,
      number: entry.number,
      left: rect.left,
      width: rect.right - rect.left,
      style: {...styleSource.textBox},
      aboveNumInPage: above?.numInPage ?? null,
      belowNumInPage: below?.numInPage ?? null,
      aboveRect: above ? {...above.textBox.textRect} : null,
      belowRect: below ? {...below.textBox.textRect} : null,
    });
  }
  return {inline, gaps, ignored};
}

async function measureCaretTextbox(
  textbox: TextElementData,
  calibration: TextboxMeasurementCalibration,
): Promise<CaretTextbox | null> {
  const rect = textbox.textBox.textRect;
  const text = textbox.textBox.textContentFull || '';
  const measurement = await measureDetailedTextLayout(
    text,
    rect.right - rect.left,
    textbox.textBox.fontSize || DEFAULT_FONT_SIZE,
    textbox.textBox.fontPath || undefined,
    calibration,
  );
  if (!measurement) {
    return null;
  }
  const x = textLeftX(rect.left, calibration);
  const y = rect.top + calibration.offsetY;
  return {
    uuid: textbox.uuid,
    numInPage: textbox.numInPage,
    rect: {...rect},
    text,
    lines: measurement.lines.map(line => ({index: line.index, start: line.start, end: line.end, top: y + line.top, bottom: y + line.bottom})),
    words: measurement.words.map(word => ({start: word.start, end: word.end, lineIndex: word.lineIndex, left: x + word.left, right: x + word.right})),
  };
}

/** Recognizes one pen edit from its stored strokes and stores the result. Never throws. */
export async function recognizePenEdit(id: string, page: number): Promise<PenTextState | null> {
  const data = await readPenEditStrokes(id);
  if (!data) {
    const failed = {status: 'failed' as const, text: '', error: 'stored handwriting missing', ms: 0};
    await storeRecognition(id, failed);
    return null;
  }
  const result = await recognizeStrokes(data.strokes, data.pageSize, page);
  const text = normalizeRecognizedText(result.text);
  const recognition = result.error
    ? {status: 'failed' as const, text: '', error: result.error, ms: result.ms}
    : {status: text ? ('done' as const) : ('empty' as const), text, error: null, ms: result.ms};
  const next = await storeRecognition(id, recognition);
  return next ? stateOf(next) : null;
}

async function storeRecognition(id: string, recognition: PenEditEntry['recognition']): Promise<PenEditEntry | null> {
  try {
    const index = await changePenEditIndex(current => updatePenEdit(current, id, entry => ({...entry, recognition})));
    return index.entries.find(entry => entry.id === id) ?? null;
  } catch (error) {
    console.warn('[PenEditReview] recognition not stored', JSON.stringify({id, error: String(error)}));
    return null;
  }
}

/** Marks a pen edit as waiting to be recognized again. */
export async function resetRecognition(id: string): Promise<void> {
  await changePenEditIndex(current =>
    updatePenEdit(current, id, entry => ({...entry, recognition: {status: 'waiting', text: '', error: null, ms: 0}})),
  );
}

export async function setPenEditReview(id: string, review: PenEditReview): Promise<void> {
  await changePenEditIndex(current => updatePenEdit(current, id, entry => ({...entry, review})));
}

export async function setPenEditCorrection(id: string, correctedText: string | null): Promise<void> {
  await changePenEditIndex(current => updatePenEdit(current, id, entry => ({...entry, correctedText})));
}

/** The stored handwriting of the applied pen edits, for the backup. */
export async function penEditBackupData(ids: string[]): Promise<{entries: PenEditEntry[]; strokes: PenEditStrokeData[]}> {
  const {index} = await readPenEditIndex();
  const entries = index.entries.filter(entry => ids.includes(entry.id));
  const strokes: PenEditStrokeData[] = [];
  for (const id of ids) {
    const data = await readPenEditStrokes(id);
    if (data) {
      strokes.push(data);
    }
  }
  return {entries, strokes};
}

/** After apply: the applied pen edits are done. */
export async function markPenEditsApplied(ids: string[]): Promise<void> {
  await setPenEditsState(ids, 'applied');
}

/** Removed from the page without applying; the stored handwriting and picture stay on disk. */
export async function markPenEditsDropped(ids: string[]): Promise<void> {
  await setPenEditsState(ids, 'dropped');
}

async function setPenEditsState(ids: string[], state: PenEditEntry['state']): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await changePenEditIndex(current => {
    let next = current;
    for (const id of ids) {
      next = updatePenEdit(next, id, entry => ({...entry, state}));
    }
    return next;
  });
}

/** The element numbers to remove for applied pen edits: their strokes, badges and numbers. */
export function penEditElementNums(ids: string[], entries: PenEditEntry[], pageElements: Element[]): number[] {
  const counts = new Map<number, number>();
  pageElements.forEach(element => counts.set(element.numInPage, (counts.get(element.numInPage) ?? 0) + 1));
  const nums: number[] = [];
  for (const entry of entries.filter(item => ids.includes(item.id))) {
    const resolved = resolvePenEdit(entry, pageElements);
    // The caret goes with its insertion; a replace mark is removed as a marker.
    const marks = entry.mark?.kind === 'caret' ? resolved.markElements : [];
    for (const element of [...resolved.decorations, ...resolved.strokes, ...marks]) {
      // Kept GTD's rule: remove by number only when the number is unique on the page.
      if (counts.get(element.numInPage) === 1) {
        nums.push(element.numInPage);
      }
    }
  }
  return [...new Set(nums)];
}

/** A pen edit's stored strokes as flat x,y point lists, for drawing them; null when missing. */
export async function loadPenEditStrokePoints(id: string): Promise<number[][] | null> {
  const data = await readPenEditStrokes(id);
  return data ? data.strokes.map(stroke => stroke.points).filter(points => points.length >= 2) : null;
}
