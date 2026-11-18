import {
  upsertPenEdit,
  activePenEditsOnPage,
  takenStrikeUuids,
  WAITING_RECOGNITION,
  type PenEditEntry,
  type PenEditMark,
} from '../domain/penEditModel';
import {findReplaceMarkInWindow, lookBackNumbers, type WindowStroke} from '../domain/penEditPairing';
import {
  markNumberRect,
  newPenEditId,
  nextPenEditNumber,
  snippetNumberRect,
  tagIconRect,
  type PenEditKind,
} from '../domain/penEditTags';
import type {Rect} from '../domain/textboxModel';
import {changePenEditIndex, readPenEditIndex, savePenEditData, temporaryPicturePath} from '../storage/penEditStore';
import {readLasso} from '../supernote/lassoRead';
import {hideLassoBox} from '../supernote/noteElements';
import {insertTagElements, type TagNumber} from '../supernote/penEditElements';
import {readLookBackWindow} from '../supernote/penEditPageRead';
import {ensurePermissions} from '../supernote/permissions';

/**
 * The "Replacement" and "Insertion" lasso buttons (technical-design-pen-edits.md §3.4): store the
 * lassoed handwriting, pair a replacement with the replace mark written just before it, put the
 * tag icon and numbers on the page. No recognition here, and no plugin screen unless something
 * went wrong: the outcome is kept here for App's small result screen.
 */

export type PenEditTagOutcome =
  | {kind: 'tagged'; tagKind: PenEditKind; number: number}
  | {kind: 'noMark'; number: number}
  | {kind: 'empty'}
  | {kind: 'busy'}
  | {kind: 'failed'; detail: string};

let outcome: PenEditTagOutcome | null = null;
const listeners = new Set<() => void>();

export function getPenEditOutcome(): PenEditTagOutcome | null {
  return outcome;
}

export function setPenEditOutcome(next: PenEditTagOutcome | null): void {
  outcome = next;
  Array.from(listeners).forEach(listener => listener());
}

export function subscribePenEditOutcome(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Success shows nothing but the icon on the page; everything else opens the result screen. */
export function outcomeNeedsScreen(result: PenEditTagOutcome): boolean {
  return result.kind !== 'tagged' && result.kind !== 'busy';
}

function boundsOfPoints(points: number[][]): Rect | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const flat of points) {
    for (let index = 0; index + 1 < flat.length; index += 2) {
      left = Math.min(left, flat[index]);
      right = Math.max(right, flat[index]);
      top = Math.min(top, flat[index + 1]);
      bottom = Math.max(bottom, flat[index + 1]);
    }
  }
  return Number.isFinite(left) ? {left, top, right, bottom} : null;
}

let running = false;

export async function tagPenEdit(tagKind: PenEditKind): Promise<PenEditTagOutcome> {
  if (running) {
    console.warn('[PenEdit] tag already running - press ignored');
    return {kind: 'busy'};
  }
  running = true;
  const start = Date.now();
  const steps: Record<string, number> = {};
  let last = start;
  const step = (name: string) => {
    const now = Date.now();
    steps[name] = now - last;
    last = now;
  };
  const id = newPenEditId(new Date());
  try {
    const snap = await readLasso({picturePath: temporaryPicturePath(id)});
    step('lasso');
    if (!snap.path || snap.page === null) {
      return {kind: 'failed', detail: 'Could not tell which note and page the lasso is on.'};
    }
    if (snap.strokes.length === 0) {
      return {kind: 'empty'};
    }
    const notePath = snap.path;
    const page = snap.page;

    await hideLassoBox('[PenEdit]');
    step('lassoGone');

    if (!(await ensurePermissions())) {
      return {kind: 'failed', detail: 'Missing permission: allow file read and write access for this plugin.'};
    }
    step('permissions');

    const {index} = await readPenEditIndex();
    const number = nextPenEditNumber(activePenEditsOnPage(index, notePath, page).map(entry => entry.number));
    step('index');

    let mark: PenEditMark | null = null;
    let strike: WindowStroke | undefined;
    let lookBack = {read: 0, ms: 0};
    if (tagKind === 'replacement') {
      const lowest = Math.min(...snap.strokeNums);
      const result = await readLookBackWindow(notePath, page, lookBackNumbers(lowest));
      lookBack = {read: result.read, ms: result.ms};
      mark = findReplaceMarkInWindow(result.window, takenStrikeUuids(index));
      strike = mark ? result.window.find(item => item.uuid === mark?.strikeUuid) : undefined;
      step('lookBack');
    }

    const lassoRect = snap.rect ?? boundsOfPoints(snap.strokes.map(stroke => stroke.points));
    if (!lassoRect) {
      return {kind: 'failed', detail: 'Could not tell where the lassoed handwriting is.'};
    }
    const iconRect = tagIconRect(lassoRect);
    const numbers: TagNumber[] = [{role: 'snippetnum', rect: snippetNumberRect(iconRect), number}];
    if (strike) {
      numbers.push({role: 'marknum', rect: markNumberRect(strike.stats.rect, snap.pageSize?.width ?? 0), number});
    }
    const placed = await insertTagElements({page, id, kind: tagKind, iconRect, numbers});
    step('elements');
    if (!placed.placed) {
      // Without its icon the entry would never be found on the page again: store nothing.
      return {kind: 'failed', detail: `Could not put the tag on the page (${placed.error ?? 'unknown error'}). Nothing was tagged; please try again.`};
    }

    const hasPicture = await savePenEditData({version: 1, id, pageSize: snap.pageSize, strokes: snap.strokes}, snap.picture);
    const entry: PenEditEntry = {
      id,
      kind: tagKind,
      notePath,
      page,
      number,
      createdAt: new Date().toISOString(),
      rect: lassoRect,
      strokeUuids: snap.strokeUuids,
      mark,
      hasPicture,
      recognition: WAITING_RECOGNITION,
      correctedText: null,
      review: 'open',
      state: 'active',
    };
    await changePenEditIndex(current => upsertPenEdit(current, entry));
    step('stored');

    console.log(
      '[PenEdit] tag',
      JSON.stringify({
        id,
        kind: tagKind,
        page,
        number,
        strokes: snap.strokes.length,
        strokeNums: [Math.min(...snap.strokeNums), Math.max(...snap.strokeNums)],
        paired: !!mark,
        lookBack,
        hasPicture,
        saved: placed.saved,
        retried: placed.retried,
        lassoTimings: snap.timingsMs,
        steps,
        totalMs: Date.now() - start,
      }),
    );
    if (tagKind === 'replacement' && !mark) {
      return {kind: 'noMark', number};
    }
    return {kind: 'tagged', tagKind, number};
  } catch (error) {
    console.error('[PenEdit] tag failed', JSON.stringify({id, steps, error: String(error)}));
    return {kind: 'failed', detail: error instanceof Error ? error.message : 'The tag could not be saved.'};
  } finally {
    running = false;
  }
}
