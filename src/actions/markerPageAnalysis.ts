import type {Element, TextBox} from 'sn-plugin-lib';
import {buildLockedFontsMessage, fontLockedReason} from '../domain/fontPaths';
import {cloneRect} from '../domain/geometry';
import {assembleMarkerPreview} from '../domain/markerAssembly';
import {buildRecognizeRect, isStraightLineGeometryElement, isSupportedEditMarkerElement} from '../domain/markerStrokes';
import {buildTextboxLogSummary, countElementTypes, createEmptyPreview} from '../domain/markerText';
import type {
  EditMarkerPreview,
  IgnoredEditMarker,
  MarkerPreviewBase,
  MarkerTextboxBase,
  OperationDraft,
  PenTextState,
} from '../domain/markerTypes';
import {draftOf, ignoredOf, textboxesOf} from '../domain/marks/drafts';
import {boundsOf} from '../domain/marks/markStroke';
import {resolvePage, type PageResult, type PageStroke, type StrokeOwner} from '../domain/marks/pass2';
import type {TextboxView} from '../domain/marks/textboxView';
import {readPageSizeForDiagnostics} from '../supernote/noteElements';
import type {PenEditEntry} from '../domain/penEditModel';
import {parsePenEditUserData, penEditNumberText} from '../domain/penEditTags';
import {isNormalTextElement, sortTextElements} from '../domain/textboxEditPlan';
import {pageFingerprint, snippetIdsOnPage, type FingerprintElement} from '../domain/pageFingerprint';
import {DEFAULT_FONT_SIZE} from '../domain/textboxModel';
import {loadMarkerStrokeStats, readStrokePath} from '../supernote/markerStrokeRead';
import {readPageContext, recycleElements, type PageContext} from '../supernote/noteElements';
import {resetFontWarnings} from '../supernote/textboxMetrics';
import {readPenEditIndex} from '../storage/penEditStore';
import {logEditMarker} from '../utils/editMarkerLog';
import {perfEvent, startTiming, timed} from '../utils/perf';
import {getEditMarkerCalibration, noteDiagnosticsPage} from './markerCalibration';
import {createTextboxMeasurer, type MeasuredTextbox, type TextboxMeasurer} from './markerMeasure';
import {cachedPage, rememberPage} from './manuscriptCache';
import {loadPenEditContext, placeCaretInsertions, stateOf} from './penEditReview';

/**
 * Reading a page's edit marks into a review preview (technical-design-mark-dialogue.md §5.1): the
 * page's strokes and textboxes are read, tagged strokes taken out, pass 1 and pass 2
 * (`domain/marks/`) say what the marks are and where they act, the drafts and ignored rows follow
 * (`domain/marks/drafts.ts`), insertions are placed at their carets, and the preview is assembled.
 * Measuring is native and done here, only for the textboxes pass 2 asks for. Applying the preview
 * is `markerApply.ts`.
 */

type TextElement = Element & {textBox: TextBox};

/**
 * Reads one page's edit marks into a preview. Marks on a textbox whose font can't be read are
 * ignored, and the preview's font warning says so (technical-design-swap-space-marks.md §2).
 */
export async function analyzeMarkerPage(notePath: string, page: number): Promise<EditMarkerPreview> {
  return (await readMarkerPage(notePath, page, {reuse: false})).preview;
}

export type MarkerPageRead = {
  preview: EditMarkerPreview;
  /** True when the page was as cached and its analysis was reused (only the pen states are new). */
  reused: boolean;
};

/**
 * Reads a page of the Manuscript card (technical-design-manuscript-cache.md §2, §4): with `reuse`,
 * the page's elements are read and compared with the cached fingerprint first, and the cached
 * analysis is kept when nothing changed. Every read is remembered in the cache.
 */
export async function readMarkerPage(
  notePath: string,
  page: number,
  options: {reuse: boolean},
): Promise<MarkerPageRead> {
  resetFontWarnings();
  let pageElements: Element[] = [];
  const calibration = getEditMarkerCalibration();
  const endRead = startTiming('page.read', {page, reuse: options.reuse});
  try {
    const context = await timed('page.getElements', () => readPageContext(notePath, page), {page});
    pageElements = context.pageElements;
    const cached = options.reuse ? cachedPage(notePath, page) : null;
    if (cached) {
      const check = await timed('page.fingerprint', () => fingerprintOf(pageElements, calibration), {page});
      if (check.fingerprint === cached.fingerprint) {
        perfEvent('page.cacheHit', {page});
        endRead({reused: true, elements: pageElements.length});
        return {preview: withPenStates(cached.preview, check.penEntries), reused: true};
      }
      perfEvent('page.cacheMiss', {page});
    }
    noteDiagnosticsPage(page);
    logEditMarker('previewStart', {page, calibration});
    const preview = await analyzePage(context, calibration);
    if (preview.fontWarning) {
      logEditMarker('fontWarning', {fontWarning: preview.fontWarning});
    }
    // After the analysis: it may have moved pen edits to this page in the index.
    const {fingerprint} = await timed('page.fingerprint', () => fingerprintOf(pageElements, calibration), {page});
    rememberPage(notePath, page, fingerprint, preview);
    endRead({
      reused: false,
      elements: pageElements.length,
      textboxes: pageElements.filter(isNormalTextElement).length,
      changes: preview.operations.length,
      penEdits: preview.penEdits.length,
    });
    return {preview, reused: false};
  } finally {
    await timed('page.recycle', () => recycleElements(pageElements), {page});
  }
}

/** The page's fingerprint, with the pen edits tagged on it (their states refresh a cached preview). */
async function fingerprintOf(
  elements: Element[],
  calibration: ReturnType<typeof getEditMarkerCalibration>,
): Promise<{fingerprint: string; penEntries: PenEditEntry[]}> {
  const ids = snippetIdsOnPage(elements, userData => {
    const tag = parsePenEditUserData(userData);
    return tag?.role === 'snippet' ? tag.id : null;
  });
  const penEntries =
    ids.size === 0
      ? []
      : (await readPenEditIndex()).index.entries.filter(entry => entry.state === 'active' && ids.has(entry.id));
  return {
    fingerprint: pageFingerprint(elements as unknown as FingerprintElement[], penEntries, calibration),
    penEntries,
  };
}

/** The pen edits' states as the index has them now (cached previews shown when the card opens). */
export async function currentPenStates(ids: string[]): Promise<Record<string, PenTextState>> {
  if (ids.length === 0) {
    return {};
  }
  const wanted = new Set(ids);
  const {index} = await readPenEditIndex();
  return Object.fromEntries(
    index.entries.filter(entry => wanted.has(entry.id)).map(entry => [entry.id, stateOf(entry)]),
  );
}

/** A cached preview with the pen edits' text, corrections and edges as the index has them now. */
function withPenStates(preview: EditMarkerPreview, entries: PenEditEntry[]): EditMarkerPreview {
  if (!preview.base || entries.length === 0) {
    return preview;
  }
  const penStates = {...preview.base.penStates};
  entries.forEach(entry => {
    if (penStates[entry.id]) {
      penStates[entry.id] = stateOf(entry);
    }
  });
  return {...preview, base: {...preview.base, penStates}};
}

async function analyzePage(
  context: PageContext,
  calibration: ReturnType<typeof getEditMarkerCalibration>,
): Promise<EditMarkerPreview> {
  const {notePath, page, pageElements} = context;
  const pen = await timed('page.penContext', () => loadPenEditContext(notePath, page, pageElements), {page});

  // Tagged snippets' handwriting and Textbox Tools' own badges and numbers are never markers.
  const markers = pageElements.filter(
    element => isSupportedEditMarkerElement(element) && !pen.isExcluded(element),
  );
  const pageTextboxes = pageElements.filter(isNormalTextElement);
  await timed('page.diagnosticsContext', () => logContext(context, markers, pageTextboxes), {page});
  if (markers.length === 0 && pen.entries.length === 0) {
    return createEmptyPreview();
  }

  const measurer = createTextboxMeasurer(calibration);
  const strokes = await timed('page.strokes', () => readPageStrokes(markers), {page, markers: markers.length});
  const markerById = new Map(markers.map(marker => [marker.uuid, marker]));
  const ownerOf = (strokeId: string): StrokeOwner | undefined => {
    const marker = markerById.get(strokeId);
    const entry = marker ? pen.strikeOwner(marker) : undefined;
    return entry ? {id: entry.id, number: entry.number, mark: entry.mark} : undefined;
  };

  // Pass 1 and pass 2 (technical-design-mark-dialogue.md §5.1): what the strokes are and where
  // they act, on plain views of the textboxes; only the textboxes pass 2 asks for are measured.
  const {result, measured} = await timed('page.marks', () => resolveMeasured(strokes, pageTextboxes, measurer, ownerOf), {page});
  result.trace.forEach(entry => logEditMarker(entry.stage, entry.payload));
  result.lockedViews.forEach(uuid => {
    const textbox = pageTextboxes.find(item => item.uuid === uuid);
    const measurement = measured.get(uuid);
    if (textbox && measurement) {
      measurer.locked(textbox, measurement);
    }
  });

  const textboxByUuid = new Map(pageTextboxes.map(textbox => [textbox.uuid, textbox]));
  const groupedTextboxes = new Map<string, TextElement>();
  const drafts: OperationDraft[] = result.marks.map(mark => {
    textboxesOf(mark).forEach(uuid => {
      const textbox = textboxByUuid.get(uuid);
      if (textbox) {
        groupedTextboxes.set(uuid, textbox);
      }
    });
    return draftOf(mark);
  });
  const ignoredMarkers: IgnoredEditMarker[] = result.refused.map(ignoredOf);
  const pairedPenEditIds = new Set(result.pairedPenEditIds);
  ignoredMarkers.push(...unpairedPenEdits(pen.entries, pairedPenEditIds, new Set(result.lockedPenEditIds)));

  // Insertions: into the paragraph their caret points to, or as a new paragraph between two.
  const pageWidth = pen.entries.some(entry => entry.placement === 'here') ? await pageWidthOf(notePath, page) : 0;
  const placed = await timed(
    'page.carets',
    () =>
      placeCaretInsertions(pen.entries, pen.carets, pageTextboxes, measurer, {
        snippetRects: pen.snippetRects,
        pageWidth,
      }),
    {page},
  );
  placed.ignored.forEach(({entry, reason}) => {
    // Its caret was missing or unclear: it can go where its handwriting is. One already placed
    // there that didn't fit keeps Select mark only.
    ignoredMarkers.push({
      ...penEditIgnored(entry, `Insertion ${penEditNumberText(entry.number)}`, reason),
      ...(entry.placement === 'here' ? {} : {canPlaceHere: true}),
    });
  });
  placed.inline.forEach(item => {
    groupedTextboxes.set(item.textbox.uuid, item.textbox);
    drafts.push(insertionDraft(item));
  });
  const insertedIds = new Set([
    ...placed.inline.map(item => item.entry.id),
    ...placed.gaps.map(gap => gap.penEditId),
  ]);

  const base: MarkerPreviewBase = {
    notePath,
    page,
    drafts,
    ignored: ignoredMarkers,
    textboxes: sortTextElements([...groupedTextboxes.values()]).map(toTextboxBase),
    insertions: placed.gaps,
    penEdits: pen.views.filter(view => pairedPenEditIds.has(view.id) || insertedIds.has(view.id)),
    penStates: pen.states,
  };
  const endAssemble = startTiming('page.assemble', {page});
  const preview = assembleMarkerPreview(base, pen.states);
  endAssemble();

  logEditMarker('previewResult', {
    markerCount: markers.length,
    recognizedOperationCount: preview.operations.length,
    penEdits: pen.entries.map(entry => ({
      id: entry.id,
      kind: entry.kind,
      number: entry.number,
      paired: pairedPenEditIds.has(entry.id),
    })),
    ignoredMarkerCount: preview.ignoredMarkers.length,
    ignoredReasons: preview.ignoredMarkers.map(marker => marker.reason),
  });

  const locked = measurer.lockedTextboxes();
  const fontWarning =
    buildLockedFontsMessage(
      locked.map(item => item.fontName),
      locked.length,
    ) ?? pen.warning;
  return fontWarning ? {...preview, fontWarning} : preview;
}

/**
 * Pass 2 with lazy measuring: run on the textboxes measured so far, measure the ones it asked for,
 * run again until it asks for none. Every round measures more, so this ends; a textbox is measured
 * once per review (`markerMeasure.ts`).
 */
async function resolveMeasured(
  strokes: PageStroke[],
  textboxes: TextElement[],
  measurer: TextboxMeasurer,
  ownerOf: (strokeId: string) => StrokeOwner | undefined,
): Promise<{result: PageResult; measured: Map<string, MeasuredTextbox>}> {
  const measured = new Map<string, MeasuredTextbox | null>();
  for (;;) {
    const views: TextboxView[] = textboxes.map(textbox => viewOf(textbox, measured));
    const result = resolvePage(strokes, views, {ownerOf});
    const wanted = result.wanted.filter(uuid => !measured.has(uuid));
    if (wanted.length === 0) {
      const done = new Map<string, MeasuredTextbox>();
      measured.forEach((value, uuid) => {
        if (value) {
          done.set(uuid, value);
        }
      });
      return {result, measured: done};
    }
    for (const uuid of wanted) {
      const textbox = textboxes.find(item => item.uuid === uuid);
      measured.set(uuid, textbox ? await measurer.measure(textbox) : null);
    }
  }
}

function viewOf(textbox: TextElement, measured: Map<string, MeasuredTextbox | null>): TextboxView {
  const known = measured.has(textbox.uuid);
  const measurement = measured.get(textbox.uuid) ?? null;
  return {
    uuid: textbox.uuid,
    numInPage: textbox.numInPage,
    rect: cloneRect(textbox.textBox.textRect),
    text: textbox.textBox.textContentFull || '',
    measured: known,
    layout: measurement ? measurement.box : null,
    fontReadable: measurement ? measurement.fontReadable : true,
    ...(measurement && !measurement.fontReadable ? {lockedReason: fontLockedReason(measurement.fontName)} : {}),
  };
}

/**
 * The page's strokes as pass 1 reads them, in page order: the rect the stroke statistics give
 * (a straight line's widened to a strike's thickness) and the drawn points. A stroke the host gave
 * no geometry for comes back without one.
 */
async function readPageStrokes(markers: Element[]): Promise<PageStroke[]> {
  return Promise.all(
    markers.map(async marker => {
      const stats = await loadMarkerStrokeStats(marker);
      const ref = {id: marker.uuid, numInPage: marker.numInPage};
      if (isStraightLineGeometryElement(marker)) {
        return {...ref, stroke: stats ? {...ref, rect: stats.rect, points: null, straightLine: true} : null};
      }
      const points = await readStrokePath(marker);
      const rect = stats?.rect ?? (points.length >= 2 ? boundsOf(points) : null);
      return {...ref, stroke: rect ? {...ref, rect, points: points.length >= 2 ? points : null, straightLine: false} : null};
    }),
  );
}

async function logContext(context: PageContext, markers: Element[], textboxes: TextElement[]): Promise<void> {
  const {notePath, page, pageElements} = context;
  logEditMarker('previewContext', {
    notePath,
    page,
    pageSize: await readPageSizeForDiagnostics(notePath, page),
    pageElementCount: pageElements.length,
    elementTypes: countElementTypes(pageElements),
    textboxes: textboxes.map(buildTextboxLogSummary),
    markers: markers.map(marker => ({
      uuid: marker.uuid,
      numInPage: marker.numInPage,
      type: marker.type,
      geometryType: marker.geometry?.type || null,
      layerNum: marker.layerNum,
      recognizeRect: buildRecognizeRect(marker.recognizeResult),
    })),
    // Pen-edit icons and numbers on the page: whether userData survives moves (pen-edits §5).
    penEditElements: pageElements
      .map(element => ({element, tag: parsePenEditUserData(element.userData)}))
      .filter(item => item.tag !== null)
      .map(({element, tag}) => ({
        id: tag?.id,
        role: tag?.role,
        uuid: element.uuid,
        numInPage: element.numInPage,
        rect: element.textBox?.textRect ?? null,
      })),
  });
}

function penEditIgnored(entry: PenEditEntry, summary: string, reason: string): IgnoredEditMarker {
  return {
    markerUuid: entry.id,
    markerNumInPage: 0,
    summary,
    reason,
    penEditNumber: entry.number,
    penEditId: entry.id,
  };
}

/** Tagged text without a mark, and tagged replacements whose mark wasn't recognized. */
function unpairedPenEdits(
  entries: PenEditEntry[],
  pairedPenEditIds: Set<string>,
  lockedPenIds: Set<string>,
): IgnoredEditMarker[] {
  const withoutMark = entries
    .filter(entry => entry.kind === 'unpaired')
    .map(entry => ({
      ...penEditIgnored(
        entry,
        `Text ${penEditNumberText(entry.number)}`,
        'No replace mark or caret was found just before it. Select mark, then draw or lasso its mark - or insert it right here as a new paragraph.',
      ),
      canPlaceHere: true,
    }));
  const markNotFound = entries
    .filter(entry => entry.kind === 'replacement' && !pairedPenEditIds.has(entry.id))
    .map(entry =>
      penEditIgnored(
        entry,
        `Replacement ${penEditNumberText(entry.number)}`,
        lockedPenIds.has(entry.id)
          ? "Its replace mark is on a textbox whose font can't be read by plugins. Copy the font file to MyStyle/TextboxHelper/fonts and open the review again."
          : entry.mark
          ? 'Its replace mark was not recognized on the page (erased, or not over a textbox).'
          : 'No replace mark was found just before it when it was tagged.',
      ),
    );
  return [...withoutMark, ...markNotFound];
}

type InlineInsertion = Awaited<ReturnType<typeof placeCaretInsertions>>['inline'][number];

function insertionDraft({entry, textbox, offset, mode, uncertain}: InlineInsertion): OperationDraft {
  const place =
    mode === 'inWord'
      ? 'inside a word'
      : mode === 'blankLine' || mode === 'paragraph'
      ? 'new paragraph'
      : 'between words';
  return {
    range: {kind: 'replace', start: offset, end: offset},
    operation: {
      id: `insert:${entry.id}`,
      kind: 'insert',
      markerUuid: entry.id,
      markerNumInPage: 0,
      consumedMarkerNums: [],
      targetTextboxUuid: textbox.uuid,
      targetTextboxNumInPage: textbox.numInPage,
      lineIndex: 0,
      summary: `Insert ${penEditNumberText(entry.number)}`,
      detail: `Textbox ${textbox.numInPage} · ${place}`,
      words: [],
      textStart: offset,
      penEditId: entry.id,
      penEditNumber: entry.number,
      insertMode: mode,
      ...(uncertain ? {uncertain} : {}),
    },
  };
}

function toTextboxBase(textbox: TextElement): MarkerTextboxBase {
  const box = textbox.textBox;
  return {
    uuid: textbox.uuid,
    numInPage: textbox.numInPage,
    layerNum: textbox.layerNum,
    originalText: box.textContentFull || '',
    textRect: cloneRect(box.textRect),
    fontSize: box.fontSize || DEFAULT_FONT_SIZE,
    fontPath: box.fontPath,
    textAlign: box.textAlign ?? 0,
    textBold: box.textBold ?? 0,
    textItalics: box.textItalics ?? 0,
    textFrameWidthType: box.textFrameWidthType ?? 0,
    textFrameStyle: box.textFrameStyle ?? 0,
    textEditable: box.textEditable ?? 0,
  };
}

/** The page's width for a new textbox; 0 when the host doesn't say. */
async function pageWidthOf(notePath: string, page: number): Promise<number> {
  const size = await readPageSizeForDiagnostics(notePath, page);
  return typeof size === 'string' ? 0 : size.width;
}
