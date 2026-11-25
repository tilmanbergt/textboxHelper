import type {Element, TextBox} from 'sn-plugin-lib';
import {buildLockedFontsMessage} from '../domain/fontPaths';
import {cloneRect} from '../domain/geometry';
import {assembleMarkerPreview} from '../domain/markerAssembly';
import {
  buildRecognizeRect,
  findBestReplaceModifierPair,
  findReplaceLoop,
  isSupportedEditMarkerElement,
  orderTextboxMarkerCandidates,
} from '../domain/markerStrokes';
import {
  buildIgnoredMarker,
  buildOperationDetailWithReplacement,
  buildTextboxLogSummary,
  countElementTypes,
  createEmptyPreview,
  formatOperationSnippet,
} from '../domain/markerText';
import type {
  EditMarkerOperationKind,
  EditMarkerPreview,
  IgnoredEditMarker,
  MarkerPreviewBase,
  MarkerStrokeAnalysis,
  MarkerTextboxBase,
  OperationDraft,
  PenTextState,
} from '../domain/markerTypes';
import {coveredSpan} from '../domain/edgeShift';
import {bracketSnippet, exactSpan} from '../domain/exactBounds';
import {readPageSizeForDiagnostics} from '../supernote/noteElements';
import type {PenEditEntry} from '../domain/penEditModel';
import {parsePenEditUserData} from '../domain/penEditTags';
import {isNormalTextElement, sortTextElements} from '../domain/textboxEditPlan';
import {pageFingerprint, snippetIdsOnPage, type FingerprintElement} from '../domain/pageFingerprint';
import {DEFAULT_FONT_SIZE} from '../domain/textboxModel';
import {loadMarkerStrokeStats} from '../supernote/markerStrokeRead';
import {readPageContext, recycleElements, type PageContext} from '../supernote/noteElements';
import {resetFontWarnings} from '../supernote/textboxMetrics';
import {readPenEditIndex} from '../storage/penEditStore';
import {logEditMarker} from '../utils/editMarkerLog';
import {perfEvent, startTiming, timed} from '../utils/perf';
import {analyzeDeleteMarker, type MarkerCandidate} from './editMarkerAnalysis';
import {getEditMarkerCalibration, noteDiagnosticsPage} from './markerCalibration';
import {createTextboxMeasurer} from './markerMeasure';
import {cachedPage, rememberPage} from './manuscriptCache';
import {loadPenEditContext, placeCaretInsertions, stateOf, type PenEditContext} from './penEditReview';
import {findShapeMarks} from './shapeMarks';
import {isReplaceLoopRect} from '../domain/marks/shapes/strike';

/**
 * Reading a page's edit marks into a review preview: the strokes and their shapes, the words they
 * cover, replace marks paired with their tagged text, insertions placed at their carets - for one
 * page of the open note. Recognition
 * of one mark lives in `editMarkerAnalysis.ts` and `shapeMarks.ts`; the pure parts in
 * `src/domain/marker*.ts`. Applying the preview is `markerApply.ts`.
 */

type TextElement = Element & {textBox: TextBox};

type ReplaceInfo = {
  pair: MarkerStrokeAnalysis<Element>[];
  /** The user's own circle for the number, drawn at the right vertical (consumed with the mark). */
  numberCircle?: MarkerStrokeAnalysis<Element>;
  ignoredReason?: string;
  penEdit?: PenEditEntry;
};

const REPLACE_WITHOUT_TEXT =
  'Replace mark without new text: write the new words right after it, lasso them and tap Insertion or Replacement. (A strike with two short verticals and no text deletes exactly what is between them.)';

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
  const strokeAnalyses = await timed('page.strokes', () => readStrokeAnalyses(markers), {
    page,
    markers: markers.length,
  });
  const strokeStatsByUuid = new Map(
    strokeAnalyses.map(analysis => [analysis.marker.uuid, analysis.strokeStats]),
  );

  // Marks read from their shape first: paragraph breaks, spaces, swaps
  // (technical-design-swap-space-marks.md §6.1). Their strokes never reach the delete analysis.
  const shapeMarks = await timed(
    'page.shapeMarks',
    () =>
      findShapeMarks(markers, strokeStatsByUuid, pageTextboxes, measurer, {
        strikeOwner: pen.strikeOwner,
      }),
    {page},
  );
  const isFree = (element: Element) => !shapeMarks.consumedNums.has(element.numInPage);
  // Strokes used by a shape mark are never a replace mark's verticals or loop.
  const modifierAnalyses = strokeAnalyses.filter(analysis => isFree(analysis.marker));
  const lineMarkers = markers.filter(isFree);
  const candidateResults = await timed(
    'page.lineMarks',
    () =>
      Promise.all(
        lineMarkers.map(marker =>
          analyzeDeleteMarker(marker, pageTextboxes, measurer, strokeStatsByUuid.get(marker.uuid)),
        ),
      ),
    {page, lineMarks: lineMarkers.length},
  );

  // Tagged replacements whose strike is on a textbox with an unreadable font.
  const lockedPenIds = new Set<string>();
  candidateResults.forEach((result, index) => {
    const owner = result.fontLocked ? pen.strikeOwner(lineMarkers[index]) : undefined;
    if (owner) {
      lockedPenIds.add(owner.id);
    }
  });

  const markerCandidates = candidateResults
    .map(result => result.candidate)
    .filter((candidate): candidate is MarkerCandidate => !!candidate)
    .sort(byMarkerPosition);
  const ignoredMarkers: IgnoredEditMarker[] = [
    ...shapeMarks.ignored,
    ...candidateResults
      .map(result => result.ignored)
      .filter((ignored): ignored is IgnoredEditMarker => !!ignored),
  ];

  const {replaceInfo, pairedPenEditIds} = pairReplaceMarks(markerCandidates, modifierAnalyses, pen);
  shapeMarks.pairedPenEditIds.forEach(id => pairedPenEditIds.add(id));
  const groupedTextboxes = new Map<string, TextElement>();
  const drafts = buildLineMarkDrafts(markerCandidates, replaceInfo, ignoredMarkers, groupedTextboxes);
  ignoredMarkers.push(...unpairedPenEdits(pen.entries, pairedPenEditIds, lockedPenIds));

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
      ...penEditIgnored(entry, `Insertion ${entry.number}`, reason),
      ...(entry.placement === 'here' ? {} : {canPlaceHere: true}),
    });
  });
  shapeMarks.textboxes.forEach((textbox, uuid) => groupedTextboxes.set(uuid, textbox));
  drafts.push(...shapeMarks.drafts);
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

async function readStrokeAnalyses(markers: Element[]): Promise<MarkerStrokeAnalysis<Element>[]> {
  const analyses = await Promise.all(
    markers.map(async marker => {
      const strokeStats = await loadMarkerStrokeStats(marker);
      return strokeStats ? {marker, strokeStats} : null;
    }),
  );
  return analyses.filter((analysis): analysis is MarkerStrokeAnalysis<Element> => !!analysis);
}

function byMarkerPosition(left: MarkerCandidate, right: MarkerCandidate): number {
  if (Math.abs(left.markerSortTop - right.markerSortTop) > 1) {
    return left.markerSortTop - right.markerSortTop;
  }
  return left.markerSortLeft - right.markerSortLeft;
}

function replaceModifiers(
  candidate: MarkerCandidate,
  strokeAnalyses: MarkerStrokeAnalysis<Element>[],
): MarkerStrokeAnalysis<Element>[] {
  const pair = findBestReplaceModifierPair(candidate, strokeAnalyses);
  if (pair.length === 2) {
    return pair;
  }
  const loop = findReplaceLoop(candidate, strokeAnalyses);
  return loop ? [loop] : [];
}

/**
 * Finds the replace marks among the line marks, textbox by textbox: a strike with two short
 * verticals across it or a small loop after it (each modifier used once), or a strike declared a
 * replace mark with Select mark. A replace mark takes its text from the tagged snippet written
 * right after it; one without a snippet is ignored with how to give it one.
 */
function pairReplaceMarks(
  markerCandidates: MarkerCandidate[],
  modifierAnalyses: MarkerStrokeAnalysis<Element>[],
  pen: PenEditContext,
): {replaceInfo: Map<string, ReplaceInfo>; pairedPenEditIds: Set<string>} {
  const replaceInfo = new Map<string, ReplaceInfo>();
  const pairedPenEditIds = new Set<string>();
  const targetTextboxes = sortTextElements([
    ...new Map(
      markerCandidates.map(candidate => [candidate.targetTextbox.uuid, candidate.targetTextbox]),
    ).values(),
  ]);

  targetTextboxes.forEach(targetTextbox => {
    const textboxCandidates = orderTextboxMarkerCandidates(
      markerCandidates.filter(candidate => candidate.targetTextbox.uuid === targetTextbox.uuid),
    );
    const usedModifiers = new Set<string>();
    textboxCandidates
      .map(candidate => ({candidate, pair: replaceModifiers(candidate, modifierAnalyses)}))
      .map(entry => ({
        ...entry,
        numberCircle:
          entry.pair.length === 2
            ? numberCircleAt(entry.pair[1], modifierAnalyses, [...entry.pair, ...usedModifiersList(usedModifiers, modifierAnalyses)])
            : undefined,
      }))
      .filter(entry => {
        // A strike selected as a snippet's mark (Select mark) may stand alone: the user said it
        // is a replace mark (technical-design-pen-edits-2.md §4.2).
        const owner = pen.strikeOwner(entry.candidate.marker);
        const declaredAlone =
          entry.pair.length === 0 &&
          owner?.mark?.kind === 'replace' &&
          owner.mark.modifierRects.length === 0;
        if (declaredAlone) {
          return true;
        }
        if (
          entry.pair.length === 0 ||
          entry.pair.some(pairEntry => usedModifiers.has(pairEntry.marker.uuid))
        ) {
          return false;
        }
        entry.pair.forEach(pairEntry => usedModifiers.add(pairEntry.marker.uuid));
        if (entry.numberCircle) {
          usedModifiers.add(entry.numberCircle.marker.uuid);
        }
        return true;
      })
      .forEach(entry => {
        const penEdit = pen.strikeOwner(entry.candidate.marker);
        if (penEdit) {
          pairedPenEditIds.add(penEdit.id);
        }
        // Two verticals mark exact places: without text they delete exactly what is between them
        // (technical-design-fine-marks.md §3.2). A loop without text has nothing to do.
        const verticals = entry.pair.length === 2;
        replaceInfo.set(entry.candidate.markerUuid, {
          pair: entry.pair,
          ...(entry.numberCircle ? {numberCircle: entry.numberCircle} : {}),
          ...(penEdit ? {penEdit} : verticals ? {} : {ignoredReason: REPLACE_WITHOUT_TEXT}),
        });
      });
  });
  return {replaceInfo, pairedPenEditIds};
}

/**
 * One draft per strike or replace mark, over the words its stroke covers. Words already covered
 * by an earlier mark are not taken twice; a mark left without words is ignored. Adds every target
 * textbox to `groupedTextboxes`.
 */
function buildLineMarkDrafts(
  markerCandidates: MarkerCandidate[],
  replaceInfo: Map<string, ReplaceInfo>,
  ignoredMarkers: IgnoredEditMarker[],
  groupedTextboxes: Map<string, TextElement>,
): OperationDraft[] {
  const usedRangesByTextbox = new Map<string, Set<string>>();
  const drafts: OperationDraft[] = [];
  markerCandidates.forEach(candidate => {
    const info = replaceInfo.get(candidate.markerUuid);
    if (info?.ignoredReason) {
      ignoredMarkers.push({
        ...buildIgnoredMarker(candidate.marker, info.ignoredReason),
        removableNums: [
          candidate.markerNumInPage,
          ...info.pair.map(pairEntry => pairEntry.marker.numInPage),
        ],
      });
      return;
    }

    const textboxUuid = candidate.targetTextbox.uuid;
    const usedRanges = usedRangesByTextbox.get(textboxUuid) || new Set<string>();
    const nextWords = candidate.words.filter(word => !usedRanges.has(`${word.start}-${word.end}`));
    if (nextWords.length === 0) {
      ignoredMarkers.push({
        ...buildIgnoredMarker(
          {
            ...candidate.targetTextbox,
            uuid: candidate.markerUuid,
            numInPage: candidate.markerNumInPage,
          } as Element,
          'This marker duplicates text already covered by another recognized marker.',
        ),
        removableNums: [candidate.markerNumInPage],
      });
      return;
    }
    nextWords.forEach(word => usedRanges.add(`${word.start}-${word.end}`));
    usedRangesByTextbox.set(textboxUuid, usedRanges);
    groupedTextboxes.set(textboxUuid, candidate.targetTextbox);

    const penEdit = info?.penEdit;
    const kind: EditMarkerOperationKind = penEdit ? 'replace' : 'delete';
    // Two verticals: exactly between them, letter by letter (technical-design-fine-marks.md §3).
    // Otherwise whole words, and punctuation at the ends that the stroke didn't reach stays
    // (technical-design-pen-edits-2.md §6): "default," with the line over "default" keeps its comma.
    const exact = info && info.pair.length === 2 ? exactRange(candidate, info.pair) : null;
    const span =
      exact ??
      coveredSpan(nextWords, candidate.strokeStats.rect.left, candidate.strokeStats.rect.right) ??
      {start: nextWords[0].start, end: nextWords[nextWords.length - 1].end};
    const text = candidate.targetTextbox.textBox.textContentFull || '';
    const insideWord =
      !!exact &&
      ((span.start > 0 && /\S/.test(text.charAt(span.start - 1)) && /\S/.test(text.charAt(span.start))) ||
        (/\S/.test(text.charAt(span.end - 1)) && /\S/.test(text.charAt(span.end))));
    const wordTexts = insideWord ? [bracketSnippet(text, span.start, span.end)] : nextWords.map(word => word.text);
    drafts.push({
      range: {kind, start: span.start, end: span.end},
      operation: {
        id: `${candidate.markerUuid}:${candidate.targetTextbox.uuid}`,
        kind,
        markerUuid: candidate.markerUuid,
        markerNumInPage: candidate.markerNumInPage,
        consumedMarkerNums: [
          candidate.markerNumInPage,
          ...(info?.pair.map(pairEntry => pairEntry.marker.numInPage) || []),
          ...(info?.numberCircle ? [info.numberCircle.marker.numInPage] : []),
        ],
        targetTextboxUuid: candidate.targetTextbox.uuid,
        targetTextboxNumInPage: candidate.targetTextbox.numInPage,
        lineIndex: candidate.lineIndex,
        summary: formatOperationSnippet(kind, wordTexts),
        detail: buildOperationDetailWithReplacement(
          candidate.targetTextbox,
          candidate.lineIndex,
          nextWords,
        ),
        words: wordTexts,
        textStart: span.start,
        ...(penEdit ? {penEditId: penEdit.id, penEditNumber: penEdit.number} : {}),
      },
    });
  });
  return drafts;
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
        `Text ${entry.number}`,
        'No replace mark or caret was found just before it. Select mark, then draw or lasso its mark - or insert it right here as a new paragraph.',
      ),
      canPlaceHere: true,
    }));
  const markNotFound = entries
    .filter(entry => entry.kind === 'replacement' && !pairedPenEditIds.has(entry.id))
    .map(entry =>
      penEditIgnored(
        entry,
        `Replacement ${entry.number}`,
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
      summary: `Insert ${entry.number}`,
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

/**
 * The exact range between a replace mark's two verticals: each vertical's middle x turned into a
 * character offset among the words the strike covers (technical-design-fine-marks.md §3.1). Null
 * when the words have no positions to go by, or the verticals mark nothing.
 */
function exactRange(
  candidate: MarkerCandidate,
  verticals: MarkerStrokeAnalysis<Element>[],
): {start: number; end: number} | null {
  const words = candidate.words.map(word => ({
    start: word.start,
    end: word.end,
    left: word.absoluteLeft,
    right: word.absoluteRight,
    ...(word.charEdges ? {edges: word.charEdges.map(edge => word.absoluteLeft - word.left + edge)} : {}),
  }));
  const [left, right] = verticals.map(vertical => (vertical.strokeStats.rect.left + vertical.strokeStats.rect.right) / 2);
  return exactSpan(words, left, right);
}

/**
 * The user's own circle for the number at a replace mark's right vertical: found with the same
 * test as the replace loop, measured from the vertical's top (technical-design-fine-marks.md §2.2).
 */
function numberCircleAt(
  rightVertical: MarkerStrokeAnalysis<Element>,
  analyses: MarkerStrokeAnalysis<Element>[],
  taken: MarkerStrokeAnalysis<Element>[],
): MarkerStrokeAnalysis<Element> | undefined {
  const rect = rightVertical.strokeStats.rect;
  const x = (rect.left + rect.right) / 2;
  const anchor = {left: x, right: x, top: rect.top, bottom: rect.top};
  const takenUuids = new Set(taken.map(item => item.marker.uuid));
  return analyses.find(
    analysis => !takenUuids.has(analysis.marker.uuid) && isReplaceLoopRect(anchor, analysis.strokeStats.rect),
  );
}

function usedModifiersList(
  used: Set<string>,
  analyses: MarkerStrokeAnalysis<Element>[],
): MarkerStrokeAnalysis<Element>[] {
  return analyses.filter(analysis => used.has(analysis.marker.uuid));
}

/** The page's width for a new textbox; 0 when the host doesn't say. */
async function pageWidthOf(notePath: string, page: number): Promise<number> {
  const size = await readPageSizeForDiagnostics(notePath, page);
  return typeof size === 'string' ? 0 : size.width;
}
