import type {Element} from 'sn-plugin-lib';
import {buildRecognizeRect} from '../domain/markerStrokes';
import type {InsertionDraft, PenEditView, PenTextState} from '../domain/markerTypes';
import {
  updatePenEdit,
  type PenEditEntry,
  type PenEditReview,
  type PenEditStrokeData,
} from '../domain/penEditModel';
import {placeInsertion} from '../domain/penEditInsertion';
import {parsePenEditUserData} from '../domain/penEditTags';
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
  /** Snippet strokes and our own elements: never marker candidates. */
  excludedUuids: Set<string>;
  byStrike: Map<string, PenEditEntry>;
  states: Record<string, PenTextState>;
  views: PenEditView[];
  warning: string | null;
};

export const EMPTY_PEN_EDIT_CONTEXT: PenEditContext = {
  entries: [],
  excludedUuids: new Set(),
  byStrike: new Map(),
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

/**
 * The active pen edits whose tag icon is on the page. With a lasso, only those whose icon or
 * paired strike is in the lasso.
 */
export async function loadPenEditContext(
  pageElements: Element[],
  lassoElements: Element[] | null,
): Promise<PenEditContext> {
  const idsOnPage = new Set<string>();
  const excludedUuids = new Set<string>();
  for (const element of pageElements) {
    const tag = parsePenEditUserData(element.userData);
    if (tag) {
      excludedUuids.add(element.uuid);
      if (tag.role === 'snippet') {
        idsOnPage.add(tag.id);
      }
    }
  }
  if (idsOnPage.size === 0) {
    return EMPTY_PEN_EDIT_CONTEXT;
  }
  let index;
  let warning: string | null = null;
  try {
    const read = await readPenEditIndex();
    index = read.index;
    warning = read.warning;
  } catch (error) {
    console.warn('[PenEditReview] index not read', String(error));
    return {...EMPTY_PEN_EDIT_CONTEXT, excludedUuids, warning: 'The tagged replacements could not be read.'};
  }
  const lassoUuids = lassoElements ? new Set(lassoElements.map(element => element.uuid)) : null;
  const lassoIds = new Set(
    (lassoElements ?? []).map(element => parsePenEditUserData(element.userData)?.id).filter((id): id is string => !!id),
  );
  const onPage = index.entries.filter(entry => entry.state === 'active' && idsOnPage.has(entry.id));
  // Every tagged snippet's strokes stay out of the markers, also outside the lasso.
  onPage.forEach(entry => entry.strokeUuids.forEach(uuid => excludedUuids.add(uuid)));
  const entries = onPage
    .filter(entry => !lassoUuids || lassoIds.has(entry.id) || (entry.mark && lassoUuids.has(entry.mark.strikeUuid)))
    .sort((a, b) => a.number - b.number);
  const byStrike = new Map<string, PenEditEntry>();
  const states: Record<string, PenTextState> = {};
  const views: PenEditView[] = [];
  for (const entry of entries) {
    if (entry.mark?.kind === 'replace') {
      byStrike.set(entry.mark.strikeUuid, entry);
    }
    states[entry.id] = stateOf(entry);
    views.push({
      id: entry.id,
      kind: entry.kind,
      number: entry.number,
      pictureUri: entry.hasPicture ? await penEditPictureUri(entry.id) : null,
    });
  }
  return {entries, excludedUuids, byStrike, states, views, warning};
}

/** The snippet's current place: its strokes' rects on the page, else where it was tagged. */
export function snippetRect(entry: PenEditEntry, pageElements: Element[]): Rect {
  const strokeUuids = new Set(entry.strokeUuids);
  let rect: Rect | null = null;
  for (const element of pageElements) {
    if (!strokeUuids.has(element.uuid)) {
      continue;
    }
    const own = buildRecognizeRect(element.recognizeResult);
    if (!own) {
      continue;
    }
    rect = rect
      ? {
          left: Math.min(rect.left, own.left),
          top: Math.min(rect.top, own.top),
          right: Math.max(rect.right, own.right),
          bottom: Math.max(rect.bottom, own.bottom),
        }
      : own;
  }
  return rect ?? entry.rect;
}

/** Where each insertion goes; one without a textbox in its column comes back as unplaced. */
export function placeInsertions(
  entries: PenEditEntry[],
  pageElements: Element[],
  pageTextboxes: TextElementData[],
): {drafts: InsertionDraft[]; unplaced: PenEditEntry[]} {
  const ordered = sortTextElements(pageTextboxes);
  const drafts: InsertionDraft[] = [];
  const unplaced: PenEditEntry[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'insertion') {
      continue;
    }
    const placement = placeInsertion(snippetRect(entry, pageElements), ordered);
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
  if (ids.length === 0) {
    return;
  }
  await changePenEditIndex(current => {
    let next = current;
    for (const id of ids) {
      next = updatePenEdit(next, id, entry => ({...entry, state: 'applied'}));
    }
    return next;
  });
}

/** The element numbers to remove for applied pen edits: their strokes, icon and numbers. */
export function penEditElementNums(ids: string[], entries: PenEditEntry[], pageElements: Element[]): number[] {
  const idSet = new Set(ids);
  const strokeUuids = new Set(entries.filter(entry => idSet.has(entry.id)).flatMap(entry => entry.strokeUuids));
  const nums: number[] = [];
  const counts = new Map<number, number>();
  pageElements.forEach(element => counts.set(element.numInPage, (counts.get(element.numInPage) ?? 0) + 1));
  for (const element of pageElements) {
    const tag = parsePenEditUserData(element.userData);
    const ours = (tag && idSet.has(tag.id)) || strokeUuids.has(element.uuid);
    // Kept GTD's rule: remove by number only when the number is unique on the page.
    if (ours && counts.get(element.numInPage) === 1) {
      nums.push(element.numInPage);
    }
  }
  return nums;
}
