import type {Element} from 'sn-plugin-lib';
import {
  activePenEditsOnPage,
  awaitingEntry,
  kindOfMark,
  linkedNumbersOnPage,
  linkPenEdit,
  MAX_DECLARED_MARK_STROKES,
  takenCaretRects,
  takenStrikeRects,
  updatePenEdit,
  type PenEditEntry,
  type PenEditMark,
} from '../domain/penEditModel';
import {lookBackNumbers, ownedRects, withoutOwned} from '../domain/penEditPairing';
import type {MarkStroke} from '../domain/marks/markStroke';
import {readDeclared, readLookBack, readLookBackReplace} from '../domain/marks/pass1';
import {idsWithRole, rectsWithRole, type Reading} from '../domain/marks/reading';
import {caretNumberCenter} from '../domain/marks/shapes/caret';
import {NO_MARK_REASON} from '../domain/marks/reasons';
import {storedMarkOf} from '../domain/marks/storedMark';
import {
  BADGE_SIZE_PX,
  badgeNumberRect,
  circlePolygon,
  markBadgeRect,
  newPenEditId,
  nextPenEditNumber,
  parsePenEditUserData,
  penEditNumberText,
  type PenEditKind,
} from '../domain/penEditTags';
import {changePenEditIndex, readPenEditIndex} from '../storage/penEditStore';
import type {LassoSnapshot} from '../supernote/lassoRead';
import {insertTagElements, setSnippetNumber, tagUserStrokes, type TagBadge, type TagNumber} from '../supernote/penEditElements';
import {readLookBackWindow, recycleWindow, withLookBackPoints} from '../supernote/penEditPageRead';
import {startTiming} from '../utils/perf';
import {
  discardSidemarkData,
  readSidemarkLasso,
  recycleLasso,
  settleAfterLasso,
  storeSidemarkData,
  writeSidemark,
  type SidemarkStoring,
} from './sidemarkWrite';

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
  | {kind: 'noMark'; id: string; saving?: boolean}
  | {kind: 'markAttached'; tagKind: PenEditKind; number: number; fromReview: boolean; focus: ReviewFocus}
  /** Select mark read no mark that takes text: the strokes (flat x,y lists) and pass 1's reason. */
  | {kind: 'markNotClear'; id: string; strokes: number[][]; reason: string}
  /** "Comment or Image" read the lasso: the card asks which (`noteTag.ts`). */
  | {kind: 'chooseNote'}
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
export function presentEarlyNoMark(notice: {id: string}): void {
  setPenEditOutcome({kind: 'noMark', id: notice.id, saving: true});
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

let running = false;

/**
 * `onNoMark` is called as soon as the search found no mark, before the slow part of the tag
 * (writing onto the page and saving the note): the card can open right away and wait there.
 */
export async function tagPenEdit(
  options: {onNoMark?: (notice: {id: string}) => void} = {},
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
  let storing: SidemarkStoring | null = null;
  let stored = false;
  const indexRead = readPenEditIndex().catch(error => {
    console.warn('[PenEdit] early index read failed', String(error));
    return null;
  });
  try {
    const read = await readSidemarkLasso(id, '[PenEdit]');
    snap = read.snap;
    step('lasso');
    if (!read.lasso.ok) {
      return read.lasso.empty ? {kind: 'empty'} : {kind: 'failed', detail: read.lasso.detail};
    }
    const lasso = read.lasso;
    const {notePath, page} = lasso;
    const lassoSnap = lasso.snap;

    const {index} = (await indexRead) ?? (await readPenEditIndex());
    step('index');

    // A snippet waiting for its mark (Select mark): a lasso of a few strokes, none of them tagged
    // already, is that mark rather than new text.
    const waiting = awaitingEntry(index, notePath, page, new Date());
    if (
      waiting &&
      lassoSnap.strokes.length <= MAX_DECLARED_MARK_STROKES &&
      !lassoSnap.strokeElements.some(element => parsePenEditUserData(element.userData) !== null)
    ) {
      return await attachSelectedMark(lassoSnap, waiting, lasso.hiddenAt);
    }

    storing = storeSidemarkData(id, lassoSnap);

    // Both marks are looked for; the snippet belongs to the one written last before it
    // (pass 1, `readLookBack`). The read stops once a whole replace mark is in the window:
    // everything newer was read before it, so a newer caret is in the window too. Points are read
    // only for caret-sized strokes and the two newest that may be a slash.
    // Strokes that already belong to tagged text (its handwriting or its mark) are never the mark
    // of this text: skipped by their tag while reading, and by their stored place here.
    const lowest = Math.min(...lassoSnap.strokeNums);
    const taken = {strikes: takenStrikeRects(index, notePath, page), carets: takenCaretRects(index, notePath, page)};
    const owned = ownedRects(activePenEditsOnPage(index, notePath, page));
    // A slash alone never ends the reads early: it may be a leg of a caret read next.
    const result = await readLookBackWindow(notePath, page, lookBackNumbers(lowest), window =>
      readLookBackReplace(withoutOwned(window, owned), taken.strikes, {slash: false}) !== null,
    );
    windowElements = result.elements;
    const window = await withLookBackPoints(withoutOwned(result.window, owned), result.elements, taken);
    const endPass1 = startTiming('tag.pass1', {page});
    const reading = readLookBack(window, taken);
    endPass1({found: reading?.kind ?? null});
    const lookBack = {read: result.read, ms: Date.now() - last};
    step('lookBack');
    const mark: PenEditMark | null = reading ? storedMarkOf(reading) : null;
    const tagKind = kindOfMark(mark);
    // Numbers are given at link time and count only the page's linked texts; text without a mark
    // shows "?" (technical-design-mark-dialogue.md §4.1).
    const number = mark ? nextPenEditNumber(linkedNumbersOnPage(index, notePath, page)) : null;
    if (!mark && options.onNoMark) {
      try {
        options.onNoMark({id});
      } catch (error) {
        console.warn('[PenEdit] early no-mark notice failed', String(error));
      }
      step('noMarkShown');
    }

    const strokesToTag: Array<{element: Element; role: 'stroke' | 'mark'}> = lassoSnap.strokeElements.map(element => ({
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
    const written = await writeSidemark(
      {
        id,
        kind: tagKind,
        lasso,
        number,
        mark,
        strokes: strokesToTag,
        extra: markBadges(reading, number, lassoSnap.pageSize?.width ?? 0),
        storing,
      },
      step,
    );
    if (!written.ok) {
      return {kind: 'failed', detail: written.detail};
    }
    stored = true;

    console.log(
      '[PenEdit] tag',
      JSON.stringify({
        id,
        kind: tagKind,
        page,
        number,
        strokes: lassoSnap.strokes.length,
        strokeNums: [Math.min(...lassoSnap.strokeNums), Math.max(...lassoSnap.strokeNums)],
        paired: !!mark,
        markKind: reading ? markKindOf(reading) : null,
        ownCircle: !!reading?.numberPlace,
        lookBack,
        strokesTagged: written.tagged.tagged,
        tagError: written.tagged.error,
        tagMs: written.tagged.ms,
        hasPicture: written.picture.kept,
        pictureError: written.picture.error,
        saved: written.placed.saved,
        createMs: written.placed.createMs,
        insertMs: written.placed.insertMs,
        saveMs: written.placed.saveMs,
        retried: written.placed.retried,
        lassoTimings: lassoSnap.timingsMs,
        steps,
        totalMs: Date.now() - start,
      }),
    );
    if (!mark || number === null) {
      return {kind: 'noMark', id};
    }
    return {kind: 'tagged', tagKind, number};
  } catch (error) {
    console.error('[PenEdit] tag failed', JSON.stringify({id, steps, error: String(error)}));
    return {kind: 'failed', detail: error instanceof Error ? error.message : 'The tag could not be saved.'};
  } finally {
    if (storing && !stored) {
      // Nothing was tagged: the stored handwriting would belong to no entry.
      await discardSidemarkData(id, storing);
    }
    running = false;
    recycleLasso(snap);
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
function markBadges(reading: Reading | null, number: number | null, pageWidth: number): {badges: TagBadge[]; numbers: TagNumber[]} {
  const half = BADGE_SIZE_PX / 2;
  if (!reading) {
    return {badges: [], numbers: []};
  }
  // A circle the user drew for the number holds it (technical-design-fine-marks.md §2.2).
  if (reading.numberPlace) {
    return {badges: [], numbers: [{role: 'marknum', rect: badgeNumberRect(reading.numberPlace, number), text: penEditNumberText(number)}]};
  }
  const strike = rectsWithRole(reading, 'mark')[0];
  if (reading.kind === 'slash') {
    const box = markBadgeRect([strike], strike, pageWidth);
    return {
      badges: [{role: 'markring', points: circlePolygon(box)}],
      numbers: [{role: 'marknum', rect: badgeNumberRect(box, number), text: penEditNumberText(number)}],
    };
  }
  if (reading.shape.kind === 'caret') {
    const center = caretNumberCenter(reading.shape.caret);
    const box = {left: center.x - half, top: center.y - half, right: center.x + half, bottom: center.y + half};
    return {badges: [], numbers: [{role: 'marknum', rect: badgeNumberRect(box, number), text: penEditNumberText(number)}]};
  }
  if (reading.kind === 'replaceLoop') {
    return {badges: [], numbers: [{role: 'marknum', rect: badgeNumberRect(rectsWithRole(reading, 'modifier')[0], number), text: penEditNumberText(number)}]};
  }
  const cy = (strike.top + strike.bottom) / 2;
  let left = Math.round(strike.right + 6);
  if (pageWidth > 0) {
    left = Math.min(left, pageWidth - BADGE_SIZE_PX);
  }
  const box = {left, top: Math.round(cy - half), right: left + BADGE_SIZE_PX, bottom: Math.round(cy + half)};
  return {
    badges: [{role: 'markring', points: circlePolygon(box)}],
    numbers: [{role: 'marknum', rect: badgeNumberRect(box, number), text: penEditNumberText(number)}],
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
 * Select mark (technical-design-mark-dialogue.md §4.2): the lassoed strokes become the waiting
 * text's mark (pass 1, `readDeclared`). The index first - the mark, its kind and the next number
 * of the page - then the page: the text's "?" becomes its number, the mark gets its ring and
 * number, the strokes the text's `mark` tag. If the page can't be changed, the index is set back.
 * A lasso that reads as no mark that takes text writes nothing; the card shows the strokes and why.
 */
async function attachSelectedMark(
  snap: LassoSnapshot,
  waiting: PenEditEntry,
  lassoHiddenAt: number,
): Promise<PenEditTagOutcome> {
  const endTotal = startTiming('selectMark.total', {page: waiting.page});
  const page = waiting.page;
  const declared = readDeclared(declaredStrokes(snap));
  const reading = declared.readings.length === 1 ? declared.readings[0] : null;
  const mark = reading ? storedMarkOf(reading) : null;
  if (!reading || !mark) {
    console.log(
      '[PenEdit] select mark',
      JSON.stringify({id: waiting.id, result: 'notClear', strokes: snap.strokes.length, readings: declared.readings.length}),
    );
    endTotal({result: 'notClear'});
    return {
      kind: 'markNotClear',
      id: waiting.id,
      strokes: snap.strokes.map(stroke => stroke.points).filter(points => points.length >= 4),
      reason: declared.reason ?? NO_MARK_REASON,
    };
  }
  const {index} = await readPenEditIndex();
  const number = waiting.number ?? nextPenEditNumber(linkedNumbersOnPage(index, waiting.notePath, page));
  const before = waiting;
  await changePenEditIndex(current => linkPenEdit(current, waiting.id, mark, number));
  const setBack = async (detail: string): Promise<PenEditTagOutcome> => {
    await changePenEditIndex(current => updatePenEdit(current, waiting.id, () => before)).catch(error =>
      console.warn('[PenEdit] select mark not set back', String(error)),
    );
    endTotal({result: 'failed'});
    return {kind: 'failed', detail};
  };

  const elementsByUuid = new Map(snap.strokeElements.map(element => [element.uuid, element]));
  await settleAfterLasso(lassoHiddenAt);
  const tagged = await tagUserStrokes(
    page,
    waiting.id,
    reading.strokes
      .map(strokeId => elementsByUuid.get(strokeId))
      .filter((element): element is Element => !!element)
      .map(element => ({element, role: 'mark' as const})),
  );
  const renumbered = await setSnippetNumber(waiting.notePath, page, waiting.id, number);
  if (!renumbered.changed) {
    console.warn('[PenEdit] select mark: "?" not changed', JSON.stringify({id: waiting.id, error: renumbered.error}));
  }
  const markTags = markBadges(reading, number, snap.pageSize?.width ?? 0);
  const placed = await insertTagElements({page, id: waiting.id, badges: markTags.badges, numbers: markTags.numbers});
  if (!placed.placed) {
    if (renumbered.changed) {
      await setSnippetNumber(waiting.notePath, page, waiting.id, waiting.number);
    }
    return setBack(`Could not put the number on the mark (${placed.error ?? 'unknown error'}). Please try again.`);
  }
  if (!tagged.tagged) {
    await changePenEditIndex(current => updatePenEdit(current, waiting.id, entry => ({...entry, strokesTagged: false})));
  }
  const tagKind = kindOfMark(mark);
  const fromReview = waiting.awaitingMark?.from === 'review';
  console.log(
    '[PenEdit] select mark',
    JSON.stringify({
      id: waiting.id,
      result: 'attached',
      markKind: markKindOf(reading),
      number,
      questionMarkChanged: renumbered.changed,
      strokes: snap.strokes.length,
      markStrokes: reading.strokes.length,
      numberCircle: idsWithRole(reading, 'number').length > 0,
      strokesTagged: tagged.tagged,
      fromReview,
    }),
  );
  endTotal({result: 'attached'});
  return {
    kind: 'markAttached',
    tagKind,
    number,
    fromReview,
    focus: {notePath: waiting.notePath, page, penEditId: waiting.id, number, kind: tagKind},
  };
}
