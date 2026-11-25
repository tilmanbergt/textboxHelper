import {PluginCommAPI, type Element} from 'sn-plugin-lib';
import {
  activePenEditsOnPage,
  awaitingEntry,
  kindOfMark,
  MAX_DECLARED_MARK_STROKES,
  takenCaretRects,
  takenStrikeRects,
  updatePenEdit,
  upsertPenEdit,
  WAITING_RECOGNITION,
  type PenEditEntry,
  type PenEditMark,
} from '../domain/penEditModel';
import {lookBackNumbers, ownedRects, withoutOwned} from '../domain/penEditPairing';
import type {MarkStroke} from '../domain/marks/markStroke';
import {readDeclared, readLookBack, readLookBackReplace} from '../domain/marks/pass1';
import {idsWithRole, rectsWithRole, type Reading} from '../domain/marks/reading';
import {caretNumberCenter} from '../domain/marks/shapes/caret';
import {storedMarkOf} from '../domain/marks/storedMark';
import {
  BADGE_SIZE_PX,
  badgeNumberRect,
  circlePolygon,
  markBadgeRect,
  newPenEditId,
  nextPenEditNumber,
  parsePenEditUserData,
  snippetBadgePolygon,
  snippetBadgeRect,
  type PenEditKind,
} from '../domain/penEditTags';
import type {Rect} from '../domain/textboxModel';
import {
  changePenEditIndex,
  deletePenEditData,
  readPenEditIndex,
  savePenEditData,
  temporaryPicturePath,
} from '../storage/penEditStore';
import {readLasso, type LassoSnapshot} from '../supernote/lassoRead';
import {hideLassoBox} from '../supernote/noteElements';
import {insertTagElements, tagUserStrokes, type TagBadge, type TagNumber} from '../supernote/penEditElements';
import {readLookBackWindow, recycleWindow, withLookBackPoints} from '../supernote/penEditPageRead';
import {ensurePermissions} from '../supernote/permissions';

/**
 * The "Insertion or Replacement" lasso button (technical-design-pen-edits.md §3.4,
 * technical-design-pen-edits-2.md §3, §4): store the lassoed handwriting, pair it with the mark
 * written just before it (a replace mark makes it a replacement, a caret an insertion), put the
 * badges and numbers on the page, and write the tag onto the user's strokes. While a snippet waits
 * for its mark (Select mark), a lasso of a few strokes becomes that mark instead. No recognition
 * here, and no plugin screen unless something needs a word: the outcome is kept here for App.
 */

/** Which change the review opens at after a mark was selected from it. */
export type ReviewFocus = {notePath: string; page: number; penEditId: string; number: number; kind: PenEditKind};

export type PenEditTagOutcome =
  | {kind: 'tagged'; tagKind: PenEditKind; number: number}
  /** `saving`: shown as soon as the search found no mark, while the tag is still being stored. */
  | {kind: 'noMark'; id: string; number: number; saving?: boolean}
  | {kind: 'markAttached'; tagKind: PenEditKind; number: number; fromReview: boolean; focus: ReviewFocus}
  | {kind: 'markNotRead'; number: number}
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

let reviewFocus: ReviewFocus | null = null;
const focusListeners = new Set<() => void>();

export function getReviewFocus(): ReviewFocus | null {
  return reviewFocus;
}

export function setReviewFocus(next: ReviewFocus | null): void {
  reviewFocus = next;
  Array.from(focusListeners).forEach(listener => listener());
}

export function subscribeReviewFocus(listener: () => void): () => void {
  focusListeners.add(listener);
  return () => {
    focusListeners.delete(listener);
  };
}

/**
 * The card for a tag whose search found no mark, shown while the tag is still being stored. Its
 * buttons wait for the final outcome, which `presentTagOutcome` puts in its place.
 */
export function presentEarlyNoMark(notice: {id: string; number: number}): void {
  setPenEditOutcome({kind: 'noMark', id: notice.id, number: notice.number, saving: true});
}

/**
 * Hands the outcome to App and says whether the plugin view must open: a tag or a mark selected
 * from the tag card shows nothing but the numbers on the page; a mark selected from the review
 * opens the review again at that change; everything else opens the result card.
 */
export function presentTagOutcome(result: PenEditTagOutcome): boolean {
  if (result.kind === 'busy') {
    return false;
  }
  if (result.kind === 'tagged') {
    // A card opened early for this tag can't be right any more; it never is for a found mark.
    return false;
  }
  if (result.kind === 'markAttached') {
    if (!result.fromReview) {
      return false;
    }
    setReviewFocus(result.focus);
    return true;
  }
  setPenEditOutcome(result);
  return true;
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

/**
 * How long after closing the lasso the first page change waits. NOTE's reload after the lasso
 * closes took about 0.3 s on the A5 X2; builds that waited about 1 s there never crashed.
 */
export const LASSO_SETTLE_MS = 900;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * `onNoMark` is called as soon as the search found no mark, before the slow part of the tag
 * (writing onto the page and saving the note): the card can open right away and wait there.
 */
export async function tagPenEdit(
  options: {onNoMark?: (notice: {id: string; number: number}) => void} = {},
): Promise<PenEditTagOutcome> {
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
  // Plugin-file work runs while the host works: the index is read during the lasso read, and the
  // strokes and picture are stored during inserting. Only the index entry waits for
  // the badge to be on the page.
  let storing: Promise<{kept: boolean; error: string | null; failure: unknown}> | null = null;
  let stored = false;
  const indexRead = readPenEditIndex().catch(error => {
    console.warn('[PenEdit] early index read failed', String(error));
    return null;
  });
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
    const lassoHiddenAt = Date.now();
    step('lassoGone');

    if (!(await ensurePermissions())) {
      return {kind: 'failed', detail: 'Missing permission: allow file read and write access for this plugin.'};
    }
    step('permissions');

    const {index} = (await indexRead) ?? (await readPenEditIndex());
    step('index');

    // A snippet waiting for its mark (Select mark): a lasso of a few strokes, none of them tagged
    // already, is that mark rather than new text.
    const waiting = awaitingEntry(index, notePath, page, new Date());
    if (
      waiting &&
      snap.strokes.length <= MAX_DECLARED_MARK_STROKES &&
      !snap.strokeElements.some(element => parsePenEditUserData(element.userData) !== null)
    ) {
      return await attachSelectedMark(snap, waiting, lassoHiddenAt);
    }

    // Settled into a value at once, so a failing write is never an unhandled rejection meanwhile.
    storing = savePenEditData({version: 1, id, pageSize: snap.pageSize, strokes: snap.strokes}, snap.picture).then(
      result => ({...result, failure: null}),
      failure => ({kept: false, error: String(failure), failure: failure ?? 'write failed'}),
    );

    const number = nextPenEditNumber(activePenEditsOnPage(index, notePath, page).map(entry => entry.number));

    // Both marks are looked for; the snippet belongs to the one written last before it
    // (pass 1, `readLookBack`). The read stops once a whole replace mark is in the window:
    // everything newer was read before it, so a newer caret is in the window too. Points are read
    // only for caret-sized strokes and the two newest that may be a slash.
    // Strokes that already belong to tagged text (its handwriting or its mark) are never the mark
    // of this text: skipped by their tag while reading, and by their stored place here.
    const lowest = Math.min(...snap.strokeNums);
    const taken = {strikes: takenStrikeRects(index, notePath, page), carets: takenCaretRects(index, notePath, page)};
    const owned = ownedRects(activePenEditsOnPage(index, notePath, page));
    // A slash alone never ends the reads early: it may be a leg of a caret read next.
    const result = await readLookBackWindow(notePath, page, lookBackNumbers(lowest), window =>
      readLookBackReplace(withoutOwned(window, owned), taken.strikes, {slash: false}) !== null,
    );
    windowElements = result.elements;
    const window = await withLookBackPoints(withoutOwned(result.window, owned), result.elements, taken);
    const reading = readLookBack(window, taken);
    const lookBack = {read: result.read, ms: Date.now() - last};
    step('lookBack');
    const mark: PenEditMark | null = reading ? storedMarkOf(reading) : null;
    const tagKind = kindOfMark(mark);
    if (!mark && options.onNoMark) {
      try {
        options.onNoMark({id, number});
      } catch (error) {
        console.warn('[PenEdit] early no-mark notice failed', String(error));
      }
      step('noMarkShown');
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
    if (reading && windowElements) {
      for (const strokeId of reading.strokes) {
        const element = windowElements.get(strokeId);
        if (element) {
          strokesToTag.push({element, role: 'mark'});
        }
      }
    }
    // Closing the lasso makes NOTE reload and redraw the page. A page change sent while it does
    // that crashed NOTE twice (a native crash in NOTE, once in the redraw, once in the change):
    // the first change waits until the redraw is surely over.
    const settle = LASSO_SETTLE_MS - (Date.now() - lassoHiddenAt);
    if (settle > 0) {
      await sleep(settle);
    }
    step('settle');
    const tagged = await tagUserStrokes(page, id, strokesToTag);
    step('tagStrokes');

    const badge = snippetBadgeRect(lassoRect);
    const badges: TagBadge[] = [{role: 'snippet', points: snippetBadgePolygon(badge)}];
    const numbers: TagNumber[] = [{role: 'snippetnum', rect: badgeNumberRect(badge, number), number}];
    const markTags = markBadges(reading, number, snap.pageSize?.width ?? 0);
    badges.push(...markTags.badges);
    numbers.push(...markTags.numbers);
    const placed = await insertTagElements({page, id, badges, numbers});
    step('elements');
    if (!placed.placed) {
      // Without its badge the entry would never be found on the page again: store nothing.
      return {kind: 'failed', detail: `Could not put the tag on the page (${placed.error ?? 'unknown error'}). Nothing was tagged; please try again.`};
    }

    const picture = await storing;
    if (picture.failure) {
      // Without its strokes the entry could never be recognized.
      throw picture.failure instanceof Error ? picture.failure : new Error(String(picture.failure));
    }
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
      mark,
      hasPicture,
      recognition: WAITING_RECOGNITION,
      correctedText: null,
      state: 'active',
      awaitingMark: null,
      edges: null,
    };
    await changePenEditIndex(current => upsertPenEdit(current, entry));
    stored = true;
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
        markKind: reading ? markKindOf(reading) : null,
        ownCircle: !!reading?.numberPlace,
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
    if (!mark) {
      return {kind: 'noMark', id, number};
    }
    return {kind: 'tagged', tagKind, number};
  } catch (error) {
    console.error('[PenEdit] tag failed', JSON.stringify({id, steps, error: String(error)}));
    return {kind: 'failed', detail: error instanceof Error ? error.message : 'The tag could not be saved.'};
  } finally {
    if (storing && !stored) {
      // Nothing was tagged: the stored handwriting would belong to no entry.
      await storing;
      await deletePenEditData(id).catch(error => console.warn('[PenEdit] stored data not removed', String(error)));
    }
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

/** The mark's kind for the log: `caret-down`, `slash`, `loop`, `strike`. */
function markKindOf(reading: Reading): string {
  return reading.direction ? `caret-${reading.direction}` : reading.kind === 'replaceLoop' ? 'loop' : reading.kind;
}

/**
 * The number at a mark: in the circle the user drew for it, inside the loop, between a caret's
 * legs, or in a ring beside a slash. A strike drawn alone (a mark selected with Select mark) gets
 * its ring just right of its end, so nothing lands on the text above or below.
 */
function markBadges(reading: Reading | null, number: number, pageWidth: number): {badges: TagBadge[]; numbers: TagNumber[]} {
  const half = BADGE_SIZE_PX / 2;
  if (!reading) {
    return {badges: [], numbers: []};
  }
  // A circle the user drew for the number holds it (technical-design-fine-marks.md §2.2).
  if (reading.numberPlace) {
    return {badges: [], numbers: [{role: 'marknum', rect: badgeNumberRect(reading.numberPlace, number), number}]};
  }
  const strike = rectsWithRole(reading, 'mark')[0];
  if (reading.kind === 'slash') {
    const box = markBadgeRect([strike], strike, pageWidth);
    return {
      badges: [{role: 'markring', points: circlePolygon(box)}],
      numbers: [{role: 'marknum', rect: badgeNumberRect(box, number), number}],
    };
  }
  if (reading.shape.kind === 'caret') {
    const center = caretNumberCenter(reading.shape.caret);
    const box = {left: center.x - half, top: center.y - half, right: center.x + half, bottom: center.y + half};
    return {badges: [], numbers: [{role: 'marknum', rect: badgeNumberRect(box, number), number}]};
  }
  if (reading.kind === 'replaceLoop') {
    return {badges: [], numbers: [{role: 'marknum', rect: badgeNumberRect(rectsWithRole(reading, 'modifier')[0], number), number}]};
  }
  const cy = (strike.top + strike.bottom) / 2;
  let left = Math.round(strike.right + 6);
  if (pageWidth > 0) {
    left = Math.min(left, pageWidth - BADGE_SIZE_PX);
  }
  const box = {left, top: Math.round(cy - half), right: left + BADGE_SIZE_PX, bottom: Math.round(cy + half)};
  return {
    badges: [{role: 'markring', points: circlePolygon(box)}],
    numbers: [{role: 'marknum', rect: badgeNumberRect(box, number), number}],
  };
}

/** The lasso's strokes with their points and recognize rects, as a selected mark is read from them. */
function declaredStrokes(snap: LassoSnapshot): MarkStroke[] {
  const strokes: MarkStroke[] = [];
  snap.strokes.forEach((stroke, index) => {
    const element = snap.strokeElements[index];
    const rect = snap.strokeRects[index];
    const points: Array<{x: number; y: number}> = [];
    for (let i = 0; i + 1 < stroke.points.length; i += 2) {
      points.push({x: stroke.points[i], y: stroke.points[i + 1]});
    }
    if (!element || !rect || points.length < 2) {
      return;
    }
    // The recognize rect, as everywhere marks are matched on the page again.
    strokes.push({id: element.uuid, numInPage: snap.strokeNums[index], rect: {...rect}, points, straightLine: false});
  });
  return strokes;
}

/**
 * Select mark (technical-design-pen-edits-2.md §4.2): the lassoed strokes become the waiting
 * snippet's mark (pass 1, `readDeclared`). Its number goes on the mark, the strokes get the
 * snippet's `mark` tag, and the entry takes the mark and the kind that follows from it. The
 * snippet's own files stay as they are. A lasso that reads as no mark that takes text leaves
 * everything as it was, and the snippet keeps waiting.
 */
async function attachSelectedMark(
  snap: LassoSnapshot,
  waiting: PenEditEntry,
  lassoHiddenAt: number,
): Promise<PenEditTagOutcome> {
  const start = Date.now();
  const page = waiting.page;
  const declared = readDeclared(declaredStrokes(snap));
  const reading = declared.readings[0] ?? null;
  const mark = reading ? storedMarkOf(reading) : null;
  if (!reading || !mark) {
    console.log(
      '[PenEdit] select mark',
      JSON.stringify({id: waiting.id, result: 'notRead', strokes: snap.strokes.length, reason: declared.reason}),
    );
    return {kind: 'markNotRead', number: waiting.number};
  }
  const elementsByUuid = new Map(snap.strokeElements.map(element => [element.uuid, element]));
  const settle = LASSO_SETTLE_MS - (Date.now() - lassoHiddenAt);
  if (settle > 0) {
    await sleep(settle);
  }
  const tagged = await tagUserStrokes(
    page,
    waiting.id,
    reading.strokes
      .map(strokeId => elementsByUuid.get(strokeId))
      .filter((element): element is Element => !!element)
      .map(element => ({element, role: 'mark' as const})),
  );
  const markTags = markBadges(reading, waiting.number, snap.pageSize?.width ?? 0);
  const placed = await insertTagElements({page, id: waiting.id, badges: markTags.badges, numbers: markTags.numbers});
  if (!placed.placed) {
    return {
      kind: 'failed',
      detail: `Could not put the number on the mark (${placed.error ?? 'unknown error'}). Please try again.`,
    };
  }
  const tagKind = kindOfMark(mark);
  const fromReview = waiting.awaitingMark?.from === 'review';
  await changePenEditIndex(current =>
    updatePenEdit(current, waiting.id, entry => ({
      ...entry,
      kind: tagKind,
      mark,
      strokesTagged: entry.strokesTagged && tagged.tagged,
      awaitingMark: null,
      placement: undefined,
    })),
  );
  console.log(
    '[PenEdit] select mark',
    JSON.stringify({
      id: waiting.id,
      result: 'attached',
      markKind: markKindOf(reading),
      strokes: snap.strokes.length,
      markStrokes: reading.strokes.length,
      numberCircle: idsWithRole(reading, 'number').length > 0,
      strokesTagged: tagged.tagged,
      fromReview,
      totalMs: Date.now() - start,
    }),
  );
  return {
    kind: 'markAttached',
    tagKind,
    number: waiting.number,
    fromReview,
    focus: {notePath: waiting.notePath, page, penEditId: waiting.id, number: waiting.number, kind: tagKind},
  };
}
