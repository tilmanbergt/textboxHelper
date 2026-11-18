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
import {placeInsertion} from '../domain/penEditInsertion';
import {boundsOfPoints, isPenEditDecoration, parsePenEditUserData} from '../domain/penEditTags';
import {normalizeRecognizedText} from '../domain/penEditText';
import {sortTextElements} from '../domain/textboxEditPlan';
import type {Rect, TextElementData} from '../domain/textboxModel';
import {
  changePenEditIndex,
  penEditPictureUri,
  readPenEditIndex,
  readPenEditStrokes,
} from '../storage/penEditStore';
import {recognizeStrokes} from '../supernote/strokeRecognition';

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
  states: Record<string, PenTextState>;
  views: PenEditView[];
  warning: string | null;
};

export const EMPTY_PEN_EDIT_CONTEXT: PenEditContext = {
  entries: [],
  isExcluded: element => isPenEditDecoration(element),
  strikeOwner: () => undefined,
  snippetRects: new Map(),
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
    const strikeRect = entry.mark.strikeRect;
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
  for (const entry of onPage) {
    const resolved = resolvePenEdit(entry, pageElements);
    const rects = resolved.strokes.map(elementRect).filter((rect): rect is Rect => rect !== null);
    excludedRects.push(...rects);
    snippetRects.set(entry.id, unionRects(rects) ?? shiftRect(entry.rect, resolved.shift.dx, resolved.shift.dy));
    const strikeRect = resolved.strike ? elementRect(resolved.strike) : null;
    if (entry.mark && strikeRect) {
      strikeRects.set(entry.id, strikeRect);
    }
  }
  const byId = new Map(onPage.map(entry => [entry.id, entry]));

  const isExcluded = (element: Element): boolean => {
    const tag = parsePenEditUserData(element.userData);
    if (tag) {
      return tag.role !== 'mark';
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
  return {entries, isExcluded, strikeOwner, snippetRects, states, views, warning};
}

/** Where each insertion goes; one without a textbox in its column comes back as unplaced. */
export function placeInsertions(
  entries: PenEditEntry[],
  snippetRects: Map<string, Rect>,
  pageTextboxes: TextElementData[],
): {drafts: InsertionDraft[]; unplaced: PenEditEntry[]} {
  const ordered = sortTextElements(pageTextboxes);
  const drafts: InsertionDraft[] = [];
  const unplaced: PenEditEntry[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'insertion') {
      continue;
    }
    const placement = placeInsertion(snippetRects.get(entry.id) ?? entry.rect, ordered);
    if (!placement) {
      unplaced.push(entry);
      continue;
    }
    drafts.push({
      penEditId: entry.id,
      number: entry.number,
      left: placement.left,
      top: placement.top,
      width: placement.width,
      style: {...placement.styleSource.textBox},
      aboveNumInPage: placement.above?.numInPage ?? null,
      belowNumInPage: placement.below?.numInPage ?? null,
      belowTop: placement.below?.textBox.textRect.top ?? null,
    });
  }
  return {drafts, unplaced};
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
    for (const element of [...resolved.decorations, ...resolved.strokes]) {
      // Kept GTD's rule: remove by number only when the number is unique on the page.
      if (counts.get(element.numInPage) === 1) {
        nums.push(element.numInPage);
      }
    }
  }
  return [...new Set(nums)];
}
