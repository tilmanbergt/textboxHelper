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
import {
  findReplaceMarkInWindow,
  lookBackNumbers,
  ownedRects,
  pickNewestMark,
  readDeclaredMark,
  storedMark,
  type DeclaredStroke,
  type WindowMark,
  withoutOwned,
} from '../domain/penEditPairing';
import {buildStrokeStats} from '../domain/markerStrokes';
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
import {findCaretInWindow, readLookBackWindow, recycleWindow} from '../supernote/penEditPageRead';
import {caretNumberCenter, type CaretShape} from '../domain/penEditCaret';
import type {WindowStroke} from '../domain/penEditPairing';
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

    // Both marks are looked for; the snippet belongs to the one written last before it. The read
    // stops once a whole replace mark is in the window: everything newer was read before it, so a
    // newer caret is in the window too. Points are read only for caret-sized strokes.
    // Strokes that already belong to tagged text (its handwriting or its mark) are never the mark
    // of this text: skipped by their tag while reading, and by their stored place here.
    const lowest = Math.min(...snap.strokeNums);
    const taken = takenStrikeRects(index, notePath, page);
    const owned = ownedRects(activePenEditsOnPage(index, notePath, page));
    const result = await readLookBackWindow(notePath, page, lookBackNumbers(lowest), window =>
      findReplaceMarkInWindow(withoutOwned(window, owned), taken) !== null,
    );
    windowElements = result.elements;
    const window = withoutOwned(result.window, owned);
    let found: WindowMark | null = findReplaceMarkInWindow(window, taken);
    let caret: {strokes: WindowStroke[]; rect: Rect; shape: CaretShape} | null = await findCaretInWindow(
      window,
      result.elements,
      takenCaretRects(index, notePath, page),
    );
    const choice = pickNewestMark(window, found, caret?.strokes ?? null);
    if (choice !== 'replace') {
      found = null;
    }
    if (choice !== 'caret') {
      caret = null;
    }
    const lookBack = {read: result.read, ms: Date.now() - last};
    step('lookBack');
    const mark: PenEditMark | null = caret
      ? {kind: 'caret', caretRect: {...caret.rect}, tip: {...caret.shape.tip}, direction: caret.shape.direction}
      : found
        ? storedMark(found)
        : null;
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
    if (caret && windowElements) {
      for (const stroke of caret.strokes) {
        const element = windowElements.get(stroke.uuid);
        if (element) {
          strokesToTag.push({element, role: 'mark'});
        }
      }
    }
    if (found && windowElements) {
      for (const item of [found.strike, ...found.modifiers]) {
        const element = windowElements.get(item.uuid);
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
    const markTags = markBadges(found, caret, number, snap.pageSize?.width ?? 0);
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
      review: 'open',
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
        paired: !!found || !!caret,
        markKind: caret ? `caret-${caret.shape.direction}` : found ? (found.loop ? 'loop' : 'verticals') : null,
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

/**
 * The number at a mark: inside the loop the user drew, between a caret's legs, or in a ring over a
 * replace mark's vertical lines. A strike drawn alone (a mark selected with Select mark) gets its
 * ring just right of its end, so nothing lands on the text above or below.
 */
function markBadges(
  found: WindowMark | null,
  caret: {shape: CaretShape} | null,
  number: number,
  pageWidth: number,
): {badges: TagBadge[]; numbers: TagNumber[]} {
  const half = BADGE_SIZE_PX / 2;
  if (caret) {
    const center = caretNumberCenter(caret.shape);
    const box = {left: center.x - half, top: center.y - half, right: center.x + half, bottom: center.y + half};
    return {badges: [], numbers: [{role: 'marknum', rect: badgeNumberRect(box, number), number}]};
  }
  if (found?.loop) {
    return {badges: [], numbers: [{role: 'marknum', rect: badgeNumberRect(found.loop.stats.rect, number), number}]};
  }
  if (found && found.modifiers.length === 0) {
    const strike = found.strike.stats.rect;
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
  if (found) {
    const box = markBadgeRect(
      found.modifiers.map(item => item.stats.rect),
      found.strike.stats.rect,
      pageWidth,
    );
    return {
      badges: [{role: 'markring', points: circlePolygon(box)}],
      numbers: [{role: 'marknum', rect: badgeNumberRect(box, number), number}],
    };
  }
  return {badges: [], numbers: []};
}

/** The lasso's strokes with their points, as a selected mark is read from them. */
function declaredStrokes(snap: LassoSnapshot): DeclaredStroke[] {
  const strokes: DeclaredStroke[] = [];
  snap.strokes.forEach((stroke, index) => {
    const element = snap.strokeElements[index];
    const rect = snap.strokeRects[index];
    const points: Array<{x: number; y: number}> = [];
    for (let i = 0; i + 1 < stroke.points.length; i += 2) {
      points.push({x: stroke.points[i], y: stroke.points[i + 1]});
    }
    const base = buildStrokeStats(points);
    if (!element || !rect || !base) {
      return;
    }
    // The recognize rect, as everywhere marks are matched on the page again.
    strokes.push({
      uuid: element.uuid,
      numInPage: snap.strokeNums[index],
      isStraightLine: false,
      stats: {...base, rect: {...rect}, width: rect.right - rect.left, height: rect.bottom - rect.top},
      points,
    });
  });
  return strokes;
}

/**
 * Select mark (technical-design-pen-edits-2.md §4.2): the lassoed strokes become the waiting
 * snippet's mark. Its number goes on the mark, the strokes get the snippet's `mark` tag, and the
 * entry takes the mark and the kind that follows from it. The snippet's own files stay as they
 * are. A lasso that reads as no mark leaves everything as it was, and the snippet keeps waiting.
 */
async function attachSelectedMark(
  snap: LassoSnapshot,
  waiting: PenEditEntry,
  lassoHiddenAt: number,
): Promise<PenEditTagOutcome> {
  const start = Date.now();
  const page = waiting.page;
  const declared = readDeclaredMark(declaredStrokes(snap));
  if (!declared) {
    console.log('[PenEdit] select mark', JSON.stringify({id: waiting.id, result: 'notRead', strokes: snap.strokes.length}));
    return {kind: 'markNotRead', number: waiting.number};
  }
  const found = declared.kind === 'replace' ? declared.mark : null;
  const caret = declared.kind === 'caret' ? declared : null;
  const markStrokes = found ? [found.strike, ...found.modifiers] : caret ? caret.strokes : [];
  const elementsByUuid = new Map(snap.strokeElements.map(element => [element.uuid, element]));
  const settle = LASSO_SETTLE_MS - (Date.now() - lassoHiddenAt);
  if (settle > 0) {
    await sleep(settle);
  }
  const tagged = await tagUserStrokes(
    page,
    waiting.id,
    markStrokes
      .map(stroke => elementsByUuid.get(stroke.uuid))
      .filter((element): element is Element => !!element)
      .map(element => ({element, role: 'mark' as const})),
  );
  const markTags = markBadges(found, caret, waiting.number, snap.pageSize?.width ?? 0);
  const placed = await insertTagElements({page, id: waiting.id, badges: markTags.badges, numbers: markTags.numbers});
  if (!placed.placed) {
    return {
      kind: 'failed',
      detail: `Could not put the number on the mark (${placed.error ?? 'unknown error'}). Please try again.`,
    };
  }
  const mark: PenEditMark = caret
    ? {kind: 'caret', caretRect: {...caret.rect}, tip: {...caret.shape.tip}, direction: caret.shape.direction}
    : storedMark(found as WindowMark);
  const tagKind = kindOfMark(mark);
  const fromReview = waiting.awaitingMark?.from === 'review';
  await changePenEditIndex(current =>
    updatePenEdit(current, waiting.id, entry => ({
      ...entry,
      kind: tagKind,
      mark,
      strokesTagged: entry.strokesTagged && tagged.tagged,
      awaitingMark: null,
      review: 'open',
    })),
  );
  console.log(
    '[PenEdit] select mark',
    JSON.stringify({
      id: waiting.id,
      result: 'attached',
      markKind: caret ? `caret-${caret.shape.direction}` : found?.loop ? 'loop' : found?.modifiers.length ? 'verticals' : 'strike',
      strokes: snap.strokes.length,
      markStrokes: markStrokes.length,
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
