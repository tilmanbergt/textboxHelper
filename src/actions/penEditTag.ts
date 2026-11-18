import {PluginCommAPI, type Element} from 'sn-plugin-lib';
import {
  activePenEditsOnPage,
  takenStrikeRects,
  upsertPenEdit,
  WAITING_RECOGNITION,
  type PenEditEntry,
} from '../domain/penEditModel';
import {findReplaceMarkInWindow, lookBackNumbers, storedMark, type WindowMark} from '../domain/penEditPairing';
import {
  badgeNumberRect,
  circlePolygon,
  markBadgeRect,
  newPenEditId,
  nextPenEditNumber,
  snippetBadgePolygon,
  snippetBadgeRect,
  type PenEditKind,
} from '../domain/penEditTags';
import type {Rect} from '../domain/textboxModel';
import {changePenEditIndex, readPenEditIndex, savePenEditData, temporaryPicturePath} from '../storage/penEditStore';
import {readLasso, type LassoSnapshot} from '../supernote/lassoRead';
import {hideLassoBox} from '../supernote/noteElements';
import {insertTagElements, tagUserStrokes, type TagBadge, type TagNumber} from '../supernote/penEditElements';
import {readLookBackWindow, recycleWindow} from '../supernote/penEditPageRead';
import {ensurePermissions} from '../supernote/permissions';

/**
 * The "Replacement" and "Insertion" lasso buttons (technical-design-pen-edits.md §3.4): store the
 * lassoed handwriting, pair a replacement with the replace mark written just before it, put the
 * badges and numbers on the page, and write the tag onto the user's strokes. No recognition here, and no plugin screen unless something
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

function boundsOfFlatPoints(points: number[][]): Rect | null {
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
  let snap: LassoSnapshot | null = null;
  let windowElements: Map<string, Element> | null = null;
  try {
    snap = await readLasso({picturePath: await temporaryPicturePath(id), keepStrokeElements: true});
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

    let found: WindowMark | null = null;
    let lookBack = {read: 0, ms: 0};
    if (tagKind === 'replacement') {
      const lowest = Math.min(...snap.strokeNums);
      const taken = takenStrikeRects(index, notePath, page);
      // Stops as soon as a mark is complete: its strike is read after its loop or verticals.
      const result = await readLookBackWindow(notePath, page, lookBackNumbers(lowest), window =>
        findReplaceMarkInWindow(window, taken) !== null,
      );
      windowElements = result.elements;
      lookBack = {read: result.read, ms: result.ms};
      found = findReplaceMarkInWindow(result.window, taken);
      step('lookBack');
    }

    const lassoRect = snap.rect ?? boundsOfFlatPoints(snap.strokes.map(stroke => stroke.points));
    if (!lassoRect) {
      return {kind: 'failed', detail: 'Could not tell where the lassoed handwriting is.'};
    }

    // The tag goes onto the user's strokes before anything is inserted: inserting renumbers the
    // page, and the elements read so far belong to this moment.
    const strokesToTag: Array<{element: Element; role: 'stroke' | 'mark'}> = snap.strokeElements.map(element => ({
      element,
      role: 'stroke' as const,
    }));
    if (found && windowElements) {
      for (const item of [found.strike, ...found.modifiers]) {
        const element = windowElements.get(item.uuid);
        if (element) {
          strokesToTag.push({element, role: 'mark'});
        }
      }
    }
    const tagged = await tagUserStrokes(page, id, strokesToTag);
    step('tagStrokes');

    const badge = snippetBadgeRect(lassoRect);
    const badges: TagBadge[] = [{role: 'snippet', points: snippetBadgePolygon(tagKind, badge)}];
    const numbers: TagNumber[] = [{role: 'snippetnum', rect: badgeNumberRect(badge, number), number}];
    if (found?.loop) {
      // The user drew the circle: the number goes inside it.
      numbers.push({role: 'marknum', rect: badgeNumberRect(found.loop.stats.rect, number), number});
    } else if (found) {
      const markBadge = markBadgeRect(
        found.modifiers.map(item => item.stats.rect),
        found.strike.stats.rect,
        snap.pageSize?.width ?? 0,
      );
      badges.push({role: 'markring', points: circlePolygon(markBadge)});
      numbers.push({role: 'marknum', rect: badgeNumberRect(markBadge, number), number});
    }
    const placed = await insertTagElements({page, id, badges, numbers});
    step('elements');
    if (!placed.placed) {
      // Without its badge the entry would never be found on the page again: store nothing.
      return {kind: 'failed', detail: `Could not put the tag on the page (${placed.error ?? 'unknown error'}). Nothing was tagged; please try again.`};
    }

    const picture = await savePenEditData({version: 1, id, pageSize: snap.pageSize, strokes: snap.strokes}, snap.picture);
    const hasPicture = picture.kept;
    const entry: PenEditEntry = {
      id,
      kind: tagKind,
      notePath,
      page,
      number,
      createdAt: new Date().toISOString(),
      rect: lassoRect,
      strokeRects: snap.strokeRects,
      iconRect: badge,
      strokesTagged: tagged.tagged,
      mark: found ? storedMark(found) : null,
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
        paired: !!found,
        markKind: found ? (found.loop ? 'loop' : 'verticals') : null,
        lookBack,
        strokesTagged: tagged.tagged,
        tagError: tagged.error,
        tagMs: tagged.ms,
        hasPicture,
        pictureError: picture.error,
        saved: placed.saved,
        createMs: placed.createMs,
        insertMs: placed.insertMs,
        saveMs: placed.saveMs,
        retried: placed.retried,
        lassoTimings: snap.timingsMs,
        steps,
        totalMs: Date.now() - start,
      }),
    );
    if (tagKind === 'replacement' && !found) {
      return {kind: 'noMark', number};
    }
    return {kind: 'tagged', tagKind, number};
  } catch (error) {
    console.error('[PenEdit] tag failed', JSON.stringify({id, steps, error: String(error)}));
    return {kind: 'failed', detail: error instanceof Error ? error.message : 'The tag could not be saved.'};
  } finally {
    running = false;
    snap?.strokeElements.forEach(element => {
      try {
        PluginCommAPI.recycleElement(element.uuid);
      } catch {
        // silent: a failed recycle only keeps a cached element a little longer
      }
    });
    if (windowElements) {
      recycleWindow(windowElements);
    }
  }
}
