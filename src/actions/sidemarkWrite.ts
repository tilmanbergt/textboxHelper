import {PluginCommAPI, type Element} from 'sn-plugin-lib';
import {upsertPenEdit, WAITING_RECOGNITION, type NoteInfo, type PenEditEntry, type PenEditMark} from '../domain/penEditModel';
import {snippetBadgeRect, snippetSign, type PenEditKind} from '../domain/penEditTags';
import type {Rect} from '../domain/textboxModel';
import {changePenEditIndex, deletePenEditData, savePenEditData, temporaryPicturePath} from '../storage/penEditStore';
import {readLasso, type LassoSnapshot} from '../supernote/lassoRead';
import {hideLassoBox} from '../supernote/noteElements';
import {insertTagElements, tagUserStrokes, type TagBadge, type TagElementsResult, type TagNumber} from '../supernote/penEditElements';
import {ensurePermissions} from '../supernote/permissions';

/**
 * Writing a sidemark - tagged handwriting beside the text - onto the page, shared by "Insertion or
 * Replacement" (`penEditTag.ts`) and "Comment or Image" (`noteTag.ts`,
 * technical-design-comments-images.md §3.1): the lasso snapshot with its picture, the strokes and
 * picture stored in the plugin folder, the wait after the lasso closes, the tag on the user's
 * strokes, the index entry, and the sign at the handwriting. The index entry is written before the
 * sign, so a sign on the page always has its entry; a sign that can't be placed takes the entry
 * back.
 */

/**
 * How long after closing the lasso the first page change waits. NOTE's reload after the lasso
 * closes took about 0.3 s on the A5 X2; builds that waited about 1 s there never crashed.
 */
export const LASSO_SETTLE_MS = 900;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Closing the lasso makes NOTE reload and redraw the page. A page change sent while it does that
 * crashed NOTE twice (a native crash in NOTE, once in the redraw, once in the change): the first
 * change waits until the redraw is surely over.
 */
export async function settleAfterLasso(lassoHiddenAt: number): Promise<void> {
  const wait = LASSO_SETTLE_MS - (Date.now() - lassoHiddenAt);
  if (wait > 0) {
    await sleep(wait);
  }
}

export function boundsOfFlatPoints(points: number[][]): Rect | null {
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

/** The lassoed handwriting, read and with the lasso closed; or why there is nothing to tag. */
export type SidemarkLasso =
  | {ok: true; snap: LassoSnapshot; notePath: string; page: number; lassoRect: Rect; hiddenAt: number}
  | {ok: false; empty: boolean; detail: string};

/**
 * Reads the lasso (strokes, their elements and the picture, written to the plugin folder under
 * `id`), closes it and checks the file permissions. `snap` is returned whenever it was read, so the
 * caller recycles its elements.
 */
export async function readSidemarkLasso(
  id: string,
  log: string,
): Promise<{lasso: SidemarkLasso; snap: LassoSnapshot | null}> {
  const snap = await readLasso({picturePath: await temporaryPicturePath(id), keepStrokeElements: true});
  if (!snap.path || snap.page === null) {
    return {snap, lasso: {ok: false, empty: false, detail: 'Could not tell which note and page the lasso is on.'}};
  }
  if (snap.strokes.length === 0) {
    return {snap, lasso: {ok: false, empty: true, detail: ''}};
  }
  await hideLassoBox(log);
  const hiddenAt = Date.now();
  const lassoRect = snap.rect ?? boundsOfFlatPoints(snap.strokes.map(stroke => stroke.points));
  if (!lassoRect) {
    return {snap, lasso: {ok: false, empty: false, detail: 'Could not tell where the lassoed handwriting is.'}};
  }
  if (!(await ensurePermissions())) {
    return {snap, lasso: {ok: false, empty: false, detail: 'Missing permission: allow file read and write access for this plugin.'}};
  }
  return {snap, lasso: {ok: true, snap, notePath: snap.path, page: snap.page, lassoRect, hiddenAt}};
}

/** The stored strokes and picture, settled into a value at once (a failing write never goes unhandled). */
export type SidemarkStoring = Promise<{kept: boolean; error: string | null; failure: unknown}>;

/** Starts storing the lassoed strokes and picture under `id`, while the host works. */
export function storeSidemarkData(id: string, snap: LassoSnapshot): SidemarkStoring {
  return savePenEditData({version: 1, id, pageSize: snap.pageSize, strokes: snap.strokes}, snap.picture).then(
    result => ({...result, failure: null}),
    failure => ({kept: false, error: String(failure), failure: failure ?? 'write failed'}),
  );
}

/** Removes stored data that belongs to no entry (the tag didn't make it onto the page). */
export async function discardSidemarkData(id: string, storing: SidemarkStoring): Promise<void> {
  await storing;
  await deletePenEditData(id).catch(error => console.warn('[Sidemark] stored data not removed', String(error)));
}

/** Gives the lasso snapshot's cached elements back to the host. */
export function recycleLasso(snap: LassoSnapshot | null): void {
  snap?.strokeElements.forEach(element => {
    try {
      PluginCommAPI.recycleElement(element.uuid);
    } catch {
      // silent: a failed recycle only keeps a cached element a little longer
    }
  });
}

/** The sign at the handwriting: a ring with the number or "?", a bubble with "C", a frame. */
export function snippetSignElements(kind: PenEditKind, badge: Rect, number: number | null): {badges: TagBadge[]; numbers: TagNumber[]} {
  const sign = snippetSign(kind, badge, number);
  return {
    badges: [{role: 'snippet', points: sign.points}],
    numbers: sign.text !== null && sign.textRect ? [{role: 'snippetnum', rect: sign.textRect, text: sign.text}] : [],
  };
}

export type SidemarkWrite = {
  id: string;
  kind: PenEditKind;
  lasso: Extract<SidemarkLasso, {ok: true}>;
  number: number | null;
  mark: PenEditMark | null;
  note?: NoteInfo;
  /** The handwriting's strokes, and those of its mark (role `mark`). */
  strokes: Array<{element: Element; role: 'stroke' | 'mark'}>;
  /** More signs and numbers (at the mark). */
  extra: {badges: TagBadge[]; numbers: TagNumber[]};
  storing: SidemarkStoring;
};

export type SidemarkWritten =
  | {ok: true; entry: PenEditEntry; tagged: Awaited<ReturnType<typeof tagUserStrokes>>; picture: {kept: boolean; error: string | null}; placed: TagElementsResult}
  | {ok: false; detail: string};

/**
 * Tags the strokes, stores the entry, puts the signs on the page and saves. The tag goes onto the
 * user's strokes before anything is inserted: inserting renumbers the page, and the elements read
 * so far belong to this moment. Throws when the strokes couldn't be stored (without them the entry
 * could never be recognized).
 */
export async function writeSidemark(write: SidemarkWrite, step: (name: string) => void = () => undefined): Promise<SidemarkWritten> {
  const {id, kind, lasso, number, mark} = write;
  await settleAfterLasso(lasso.hiddenAt);
  step('settle');
  const tagged = await tagUserStrokes(lasso.page, id, write.strokes);
  step('tagStrokes');
  const picture = await write.storing;
  if (picture.failure) {
    throw picture.failure instanceof Error ? picture.failure : new Error(String(picture.failure));
  }
  const badge = snippetBadgeRect(lasso.lassoRect);
  const entry: PenEditEntry = {
    id,
    kind,
    notePath: lasso.notePath,
    page: lasso.page,
    number,
    createdAt: new Date().toISOString(),
    rect: lasso.lassoRect,
    strokeRects: lasso.snap.strokeRects,
    iconRect: badge,
    strokesTagged: tagged.tagged,
    mark,
    hasPicture: picture.kept,
    recognition: WAITING_RECOGNITION,
    correctedText: null,
    state: 'active',
    awaitingMark: null,
    edges: null,
    ...(write.note ? {note: write.note} : {}),
  };
  await changePenEditIndex(current => upsertPenEdit(current, entry));
  step('stored');
  const sign = snippetSignElements(kind, badge, number);
  const placed = await insertTagElements({
    page: lasso.page,
    id,
    badges: [...sign.badges, ...write.extra.badges],
    numbers: [...sign.numbers, ...write.extra.numbers],
  });
  step('elements');
  if (!placed.placed) {
    // Without its sign the entry would never be found on the page again: it is taken back.
    await changePenEditIndex(current => ({...current, entries: current.entries.filter(item => item.id !== id)}));
    return {ok: false, detail: `Could not put the tag on the page (${placed.error ?? 'unknown error'}). Nothing was tagged; please try again.`};
  }
  return {ok: true, entry, tagged, picture: {kept: picture.kept, error: picture.error}, placed};
}
