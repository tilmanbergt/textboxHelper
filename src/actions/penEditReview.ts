import type {Element} from 'sn-plugin-lib';
import {
  buildRecognizeRect,
  isSupportedEditMarkerElement,
} from '../domain/markerStrokes';
import {
  matchByRects,
  rectShift,
  rectsMatch,
  shiftRect,
} from '../domain/penEditMatching';
import type {
  InsertionDraft,
  PenEditView,
  PenTextState,
} from '../domain/markerTypes';
import {
  updatePenEdit,
  type PenEditEntry,
  setAwaitingMark,
  setPlaceHere,
  type PenEditStrokeData,
} from '../domain/penEditModel';
import {
  boundsOfPoints,
  isPenEditDecoration,
  parsePenEditUserData,
  penEditNumberText,
} from '../domain/penEditTags';
import {isNoShift, type EdgeShift} from '../domain/edgeShift';
import {normalizeRecognizedText} from '../domain/penEditText';
import {DEFAULT_FONT_SIZE, type Rect, type TextboxData, type TextElementData} from '../domain/textboxModel';
import {fontLockedReason, NOTE_SYSTEM_FONT_PATH} from '../domain/fontPaths';
import {locateOnPage} from '../domain/marks/pass2';
import type {TextboxView} from '../domain/marks/textboxView';
import {
  changePenEditIndex,
  penEditPictureUri,
  readPenEditIndex,
  readPenEditStrokes,
} from '../storage/penEditStore';
import {recognizeStrokes} from '../supernote/strokeRecognition';
import type {MeasuredTextbox, TextboxMeasurer} from './markerMeasure';
import type {CaretDirection} from '../domain/marks/shapes/caret';
import type {CaretInsertMode, CaretTarget} from '../domain/marks/place/point';
import {locateHere, type HereTextbox} from '../domain/marks/place/here';

/**
 * The pen edits' side of the Manuscript review (technical-design-pen-edits.md §3.6–§3.9):
 * which tagged snippets are on the page, their stored text, recognizing one and storing the
 * result, skips and corrections, and what apply has to remove or keep.
 */

export type PenEditContext = {
  entries: PenEditEntry[];
  /** True for the pen edits' badges, numbers and snippet strokes: never marker candidates. */
  isExcluded: (element: Element) => boolean;
  /**
   * Each entry's mark strokes on the page now: tagged `mark`, or found by their stored places.
   * They are kept out of pass 1 and placed from the entry's stored mark
   * (technical-design-mark-dialogue.md §5.1).
   */
  marks: Map<string, Element[]>;
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
  marks: new Map(),
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
    edges: entry.edges,
  };
}

/** An element's rect: the host's recognize rect, or a straight line's or polygon's points. */
export function elementRect(element: Element): Rect | null {
  return (
    buildRecognizeRect(element.recognizeResult) ??
    boundsOfPoints(element.geometry?.points ?? [])
  );
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
export function resolvePenEdit(
  entry: PenEditEntry,
  elements: Element[],
): ResolvedPenEdit {
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
      : matchByRects(entry.strokeRects, untagged, shift).map(
          item => item.element,
        );
  let strike: Element | null = null;
  if (entry.mark) {
    const strikeRect =
      entry.mark.kind === 'replace'
        ? entry.mark.strikeRect
        : entry.mark.caretRect;
    const candidates =
      markElements.length > 0
        ? markElements.map(element => ({element, rect: elementRect(element)}))
        : untagged;
    strike = matchByRects([strikeRect], candidates)[0]?.element ?? null;
    if (!strike && markElements.length > 0) {
      // Tagged but moved: the widest tagged stroke is the strike.
      strike = [...markElements].sort(
        (a, b) => width(elementRect(b)) - width(elementRect(a)),
      )[0];
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
async function syncPenEditsWithPage(
  notePath: string,
  page: number,
  idsOnPage: Set<string>,
) {
  const {index} = await readPenEditIndex();
  const stale = index.entries.filter(
    entry =>
      entry.state === 'active' &&
      entry.notePath === notePath &&
      entry.page === page &&
      !idsOnPage.has(entry.id),
  );
  const moved = index.entries.filter(
    entry =>
      entry.state === 'active' &&
      idsOnPage.has(entry.id) &&
      (entry.notePath !== notePath || entry.page !== page),
  );
  if (stale.length === 0 && moved.length === 0) {
    return null;
  }
  console.log(
    '[PenEditReview] synced with page',
    JSON.stringify({page, dropped: stale.length, moved: moved.length}),
  );
  return changePenEditIndex(current => {
    let next = current;
    stale.forEach(entry => {
      next = updatePenEdit(next, entry.id, item => ({
        ...item,
        state: 'dropped',
        doneAt: new Date().toISOString(),
      }));
    });
    moved.forEach(entry => {
      next = updatePenEdit(next, entry.id, item => ({...item, notePath, page}));
    });
    return next;
  });
}

/**
 * The active pen edits whose badge is on the page.
 */
export async function loadPenEditContext(
  notePath: string,
  page: number,
  pageElements: Element[],
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
    index =
      (await syncPenEditsWithPage(notePath, page, idsOnPage)) ??
      (await readPenEditIndex()).index;
  } catch (error) {
    console.warn('[PenEditReview] index not read', String(error));
    return idsOnPage.size === 0
      ? EMPTY_PEN_EDIT_CONTEXT
      : {
          ...EMPTY_PEN_EDIT_CONTEXT,
          warning: 'The tagged replacements could not be read.',
        };
  }
  if (idsOnPage.size === 0) {
    return EMPTY_PEN_EDIT_CONTEXT;
  }
  const onPage = index.entries.filter(
    entry => entry.state === 'active' && idsOnPage.has(entry.id),
  );

  // Every tagged snippet's strokes stay out of the markers. Without a tag, the fallback compares
  // places (element uuids are not identities, host facts §3).
  const excludedRects: Rect[] = [];
  const snippetRects = new Map<string, Rect>();
  const marks = new Map<string, Element[]>();
  const untagged = pageElements
    .filter(element => parsePenEditUserData(element.userData) === null && isSupportedEditMarkerElement(element))
    .map(element => ({element, rect: elementRect(element)}));
  const carets: PenEditContext['carets'] = new Map();
  for (const entry of onPage) {
    const resolved = resolvePenEdit(entry, pageElements);
    const rects = resolved.strokes
      .map(elementRect)
      .filter((rect): rect is Rect => rect !== null);
    excludedRects.push(...rects);
    snippetRects.set(
      entry.id,
      unionRects(rects) ??
        shiftRect(entry.rect, resolved.shift.dx, resolved.shift.dy),
    );
    // A replace mark's strokes: tagged, or the strike and the loop, verticals and number circle
    // at their stored places, moved like the strike.
    const strikeRect = resolved.strike ? elementRect(resolved.strike) : null;
    if (entry.mark?.kind === 'replace' && resolved.strike) {
      const others =
        resolved.markElements.length > 0
          ? resolved.markElements.filter(element => element !== resolved.strike)
          : matchByRects(
              [...entry.mark.modifierRects, ...(entry.mark.numberRect ? [entry.mark.numberRect] : [])],
              untagged.filter(item => item.element !== resolved.strike),
              strikeRect ? rectShift(entry.mark.strikeRect, strikeRect) : {dx: 0, dy: 0},
            ).map(item => item.element);
      const markStrokes = [resolved.strike, ...others];
      marks.set(entry.id, markStrokes);
      markStrokes.forEach(element => {
        const rect = elementRect(element);
        if (rect) {
          excludedRects.push(rect);
        }
      });
    }
    const caretRect =
      entry.mark?.kind === 'caret'
        ? unionRects(
            resolved.markElements
              .map(elementRect)
              .filter((rect): rect is Rect => rect !== null),
          )
        : null;
    if (entry.mark?.kind === 'caret' && caretRect) {
      marks.set(entry.id, resolved.markElements);
      // A caret (one stroke or two) is never a delete marker; its tip moves with it.
      resolved.markElements.forEach(element => {
        const rect = elementRect(element);
        if (rect) {
          excludedRects.push(rect);
        }
      });
      const {dx, dy} = rectShift(entry.mark.caretRect, caretRect);
      carets.set(entry.id, {
        tip: {x: entry.mark.tip.x + dx, y: entry.mark.tip.y + dy},
        direction: entry.mark.direction,
      });
    }
  }
  const onPageIds = new Set(onPage.map(entry => entry.id));

  // Every linked mark's strokes stay out of pass 1: they are placed from the stored mark.
  const isExcluded = (element: Element): boolean => {
    const tag = parsePenEditUserData(element.userData);
    if (tag) {
      return tag.role !== 'mark' || onPageIds.has(tag.id);
    }
    const rect = elementRect(element);
    return !!rect && excludedRects.some(other => rectsMatch(rect, other));
  };

  const entries = [...onPage].sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity));
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
  return {
    entries,
    isExcluded,
    marks,
    snippetRects,
    carets,
    states,
    views,
    warning,
  };
}

/** An insertion whose caret points into a paragraph: the text goes in there. */
export type CaretInline = {
  entry: PenEditEntry;
  textbox: TextElementData;
  offset: number;
  mode: CaretInsertMode;
  uncertain?: string;
};

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
  measurer: TextboxMeasurer,
  here: {snippetRects: Map<string, Rect>; pageWidth: number} = {snippetRects: new Map(), pageWidth: 0},
): Promise<{
  inline: Array<CaretInline & {textbox: T}>;
  gaps: InsertionDraft[];
  ignored: Array<{entry: PenEditEntry; reason: string}>;
}> {
  const inline: Array<CaretInline & {textbox: T}> = [];
  const gaps: InsertionDraft[] = [];
  const ignored: Array<{entry: PenEditEntry; reason: string}> = [];
  for (const entry of entries) {
    if (entry.kind !== 'insertion') {
      continue;
    }
    if (entry.placement === 'here') {
      const placed = await placeHere(entry, here.snippetRects.get(entry.id) ?? entry.rect, pageTextboxes, measurer, here.pageWidth);
      if ('reason' in placed) {
        ignored.push({entry, reason: placed.reason});
      } else {
        gaps.push(placed);
      }
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
    const {near, target} = await locateMarkOnPage(
      caret.tip,
      caret.direction,
      pageTextboxes,
      measurer,
    );
    if (!target) {
      ignored.push({
        entry,
        reason:
          "Its caret doesn't point at a line of text or the space between two paragraphs.",
      });
      continue;
    }
    if (target.kind === 'unclear') {
      ignored.push({entry, reason: target.reason});
      continue;
    }
    if (target.kind === 'text' || target.kind === 'split') {
      const textbox = near.find(item => item.uuid === target.uuid);
      if (textbox) {
        inline.push({
          entry,
          textbox,
          offset: target.offset,
          mode: target.kind === 'split' ? 'paragraph' : target.mode,
          ...(target.kind === 'text' && target.uncertain
            ? {uncertain: target.uncertain}
            : {}),
        });
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

/** The style of a new textbox when no paragraph on the page gives one: system font, 36. */
const DEFAULT_NEW_BOX_STYLE: Omit<TextboxData, 'textRect'> = {
  fontSize: 36,
  fontPath: NOTE_SYSTEM_FONT_PATH,
  textContentFull: null,
  textAlign: 0,
  textBold: 0,
  textItalics: 0,
  textFrameWidthType: 0,
  textFrameStyle: 0,
  textEditable: 0,
};

/**
 * "Insert right here" (technical-design-fine-marks.md §8): the new paragraph's place from where
 * the handwriting starts. Between paragraphs it goes in like a caret in the gap; with no paragraph
 * near, it is a new textbox at the handwriting's top left (kept there by a gap of no height below
 * it, so anything it reaches is pushed down).
 */
async function placeHere<T extends TextElementData>(
  entry: PenEditEntry,
  snippet: Rect,
  pageTextboxes: T[],
  measurer: TextboxMeasurer,
  pageWidth: number,
): Promise<InsertionDraft | {reason: string}> {
  const boxes: HereTextbox[] = [];
  for (const textbox of pageTextboxes) {
    const measured = await measurer.measure(textbox);
    const first = measured?.box.lines[0];
    const fontSize = textbox.textBox.fontSize || DEFAULT_FONT_SIZE;
    boxes.push({
      uuid: textbox.uuid,
      numInPage: textbox.numInPage,
      rect: {...textbox.textBox.textRect},
      lineHeight: first ? first.bottom - first.top : fontSize * 1.4,
    });
  }
  const place = locateHere(snippet, boxes, pageWidth, entry.number);
  if (place.kind === 'unclear') {
    return {reason: place.reason};
  }
  const byUuid = (uuid: string | null) => (uuid ? pageTextboxes.find(textbox => textbox.uuid === uuid) ?? null : null);
  if (place.kind === 'gap') {
    const above = byUuid(place.above);
    const below = byUuid(place.below);
    const styleSource = above ?? below;
    if (!styleSource) {
      return {reason: `Text ${penEditNumberText(entry.number)}: no paragraph to put it next to.`};
    }
    const rect = styleSource.textBox.textRect;
    return {
      penEditId: entry.id,
      number: entry.number,
      left: rect.left,
      width: rect.right - rect.left,
      style: {...styleSource.textBox},
      aboveNumInPage: above?.numInPage ?? null,
      belowNumInPage: below?.numInPage ?? null,
      aboveRect: above ? {...above.textBox.textRect} : null,
      belowRect: below ? {...below.textBox.textRect} : null,
      here: 'gap',
    };
  }
  const styleSource = byUuid(place.styleFrom);
  const top = {left: place.left, top: place.top, right: place.left + place.width, bottom: place.top};
  return {
    penEditId: entry.id,
    number: entry.number,
    left: place.left,
    width: place.width,
    style: styleSource ? {...styleSource.textBox} : {...DEFAULT_NEW_BOX_STYLE, textRect: top},
    aboveNumInPage: null,
    belowNumInPage: null,
    aboveRect: null,
    belowRect: top,
    here: 'newBox',
  };
}

/**
 * Where a caret points on the page (pass 2, `locateOnPage`): the textboxes in its column near its
 * tip are measured (once per review, by `measurer`) and the tip located among them. A place inside
 * a textbox whose font can't be read is unclear: its words were measured in the wrong font
 * (technical-design-swap-space-marks.md §2).
 */
export async function locateMarkOnPage<T extends TextElementData>(
  tip: {x: number; y: number},
  direction: CaretDirection,
  pageTextboxes: T[],
  measurer: TextboxMeasurer,
): Promise<{near: T[]; target: CaretTarget | null}> {
  const views: TextboxView[] = pageTextboxes.map(textbox => ({
    uuid: textbox.uuid,
    numInPage: textbox.numInPage,
    rect: {...textbox.textBox.textRect},
    text: textbox.textBox.textContentFull || '',
    measured: false,
    layout: null,
    fontReadable: true,
  }));
  const measuredBy = new Map<string, MeasuredTextbox>();
  // The first run says which textboxes are near the tip; they are measured for the second.
  const wanted = new Set<string>();
  locateOnPage(tip, direction, views, view => wanted.add(view.uuid));
  for (const textbox of pageTextboxes.filter(item => wanted.has(item.uuid))) {
    const measured = await measurer.measure(textbox);
    if (measured) {
      measuredBy.set(textbox.uuid, measured);
    }
  }
  const located = locateOnPage(
    tip,
    direction,
    views.map(view => {
      const measured = measuredBy.get(view.uuid);
      return measured
        ? {
            ...view,
            measured: true,
            layout: measured.box,
            fontReadable: measured.fontReadable,
            ...(measured.fontReadable ? {} : {lockedReason: fontLockedReason(measured.fontName)}),
          }
        : {...view, measured: wanted.has(view.uuid)};
    }),
  );
  const near = pageTextboxes.filter(textbox => located.near.some(view => view.uuid === textbox.uuid));
  if (located.locked) {
    const textbox = pageTextboxes.find(item => item.uuid === located.locked?.uuid);
    const measured = located.locked ? measuredBy.get(located.locked.uuid) : undefined;
    if (textbox && measured) {
      measurer.locked(textbox, measured);
    }
  }
  return {near, target: located.target};
}

/** Recognizes one pen edit from its stored strokes and stores the result. Never throws. */
export async function recognizePenEdit(
  id: string,
  page: number,
): Promise<PenTextState | null> {
  const data = await readPenEditStrokes(id);
  if (!data) {
    const failed = {
      status: 'failed' as const,
      text: '',
      error: 'stored handwriting missing',
      ms: 0,
    };
    await storeRecognition(id, failed);
    return null;
  }
  const result = await recognizeStrokes(data.strokes, data.pageSize, page);
  const text = normalizeRecognizedText(result.text);
  const recognition = result.error
    ? {status: 'failed' as const, text: '', error: result.error, ms: result.ms}
    : {
        status: text ? ('done' as const) : ('empty' as const),
        text,
        error: null,
        ms: result.ms,
      };
  const next = await storeRecognition(id, recognition);
  return next ? stateOf(next) : null;
}

async function storeRecognition(
  id: string,
  recognition: PenEditEntry['recognition'],
): Promise<PenEditEntry | null> {
  try {
    const index = await changePenEditIndex(current =>
      updatePenEdit(current, id, entry => ({...entry, recognition})),
    );
    return index.entries.find(entry => entry.id === id) ?? null;
  } catch (error) {
    console.warn(
      '[PenEditReview] recognition not stored',
      JSON.stringify({id, error: String(error)}),
    );
    return null;
  }
}

/** Marks a pen edit as waiting to be recognized again. */
export async function resetRecognition(id: string): Promise<void> {
  await changePenEditIndex(current =>
    updatePenEdit(current, id, entry => ({
      ...entry,
      recognition: {status: 'waiting', text: '', error: null, ms: 0},
    })),
  );
}

/** The user's character nudges of a pen edit's edges; no nudge is stored as none. */
export async function setPenEditEdges(
  id: string,
  edges: EdgeShift | null,
): Promise<void> {
  const stored = isNoShift(edges) ? null : edges;
  await changePenEditIndex(current =>
    updatePenEdit(current, id, entry => ({...entry, edges: stored})),
  );
}

/**
 * Select mark (technical-design-pen-edits-2.md §4): this snippet waits for the mark the user is
 * about to draw or lasso; the next tap of "Insertion or Replacement" on a few strokes attaches it.
 */
export async function startSelectMark(
  id: string,
  from: 'tag' | 'review',
): Promise<void> {
  await changePenEditIndex(current =>
    setAwaitingMark(current, id, from, new Date()),
  );
}

/** Here on a pen edit whose place stayed open: the review takes the nearest place it found. */
export async function confirmPenEditPlace(id: string): Promise<void> {
  await changePenEditIndex(current => updatePenEdit(current, id, entry => ({...entry, confirmed: true})));
}

/** The text stops waiting for its mark (Cancel on the "Not a clear mark" card). */
export async function stopSelectMark(id: string): Promise<void> {
  await changePenEditIndex(current =>
    updatePenEdit(current, id, entry => ({...entry, awaitingMark: null})),
  );
}

/**
 * "Insert right here" (technical-design-fine-marks.md §8): the text goes in as a new paragraph
 * where its handwriting starts. Stored with the entry; the review reads the page again.
 */
export async function placePenEditHere(id: string): Promise<void> {
  await changePenEditIndex(current => setPlaceHere(current, id));
}

export async function setPenEditCorrection(
  id: string,
  correctedText: string | null,
): Promise<void> {
  await changePenEditIndex(current =>
    updatePenEdit(current, id, entry => ({...entry, correctedText})),
  );
}

/** The stored handwriting of the applied pen edits, for the backup. */
export async function penEditBackupData(
  ids: string[],
): Promise<{entries: PenEditEntry[]; strokes: PenEditStrokeData[]}> {
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

/** Removed from the page without applying; housekeeping removes the stored handwriting later. */
export async function markPenEditsDropped(ids: string[]): Promise<void> {
  await setPenEditsState(ids, 'dropped');
}

async function setPenEditsState(
  ids: string[],
  state: PenEditEntry['state'],
): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const doneAt = new Date().toISOString();
  await changePenEditIndex(current => {
    let next = current;
    for (const id of ids) {
      next = updatePenEdit(next, id, entry => ({...entry, state, doneAt}));
    }
    return next;
  });
}

/** The element numbers to remove for applied pen edits: their strokes, badges and numbers. */
export function penEditElementNums(
  ids: string[],
  entries: PenEditEntry[],
  pageElements: Element[],
  options: {handwriting: boolean; replaceMark: boolean} = {
    handwriting: true,
    replaceMark: false,
  },
): number[] {
  const counts = new Map<number, number>();
  pageElements.forEach(element =>
    counts.set(element.numInPage, (counts.get(element.numInPage) ?? 0) + 1),
  );
  const nums: number[] = [];
  for (const entry of entries.filter(item => ids.includes(item.id))) {
    const resolved = resolvePenEdit(entry, pageElements);
    // A caret always goes with its insertion. A replace mark goes as a consumed marker when
    // applying; when dropping (`replaceMark`) it goes here, or it would read as a delete later.
    const marks =
      entry.mark?.kind === 'caret' || options.replaceMark
        ? [
            ...resolved.markElements,
            ...(resolved.strike ? [resolved.strike] : []),
          ]
        : [];
    for (const element of [
      ...resolved.decorations,
      ...(options.handwriting ? resolved.strokes : []),
      ...marks,
    ]) {
      // Kept GTD's rule: remove by number only when the number is unique on the page.
      if (counts.get(element.numInPage) === 1) {
        nums.push(element.numInPage);
      }
    }
  }
  return [...new Set(nums)];
}

/** A pen edit's stored strokes as flat x,y point lists, for drawing them; null when missing. */
export async function loadPenEditStrokePoints(
  id: string,
): Promise<number[][] | null> {
  const data = await readPenEditStrokes(id);
  return data
    ? data.strokes
        .map(stroke => stroke.points)
        .filter(points => points.length >= 2)
    : null;
}
