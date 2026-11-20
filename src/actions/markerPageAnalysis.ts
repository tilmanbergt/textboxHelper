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
} from '../domain/markerTypes';
import {coveredSpan} from '../domain/edgeShift';
import type {PenEditEntry} from '../domain/penEditModel';
import {parsePenEditUserData} from '../domain/penEditTags';
import {isNormalTextElement, sortTextElements} from '../domain/textboxEditPlan';
import {DEFAULT_FONT_SIZE} from '../domain/textboxModel';
import {loadMarkerStrokeStats} from '../supernote/markerStrokeRead';
import {
  readCurrentPageContext,
  readPageSizeForDiagnostics,
  recycleElements,
  type PageContext,
} from '../supernote/noteElements';
import {resetFontWarnings} from '../supernote/textboxMetrics';
import {logEditMarker} from '../utils/editMarkerLog';
import {analyzeDeleteMarker, type MarkerCandidate} from './editMarkerAnalysis';
import {getEditMarkerCalibration, startMarkerDiagnostics} from './markerCalibration';
import {createTextboxMeasurer} from './markerMeasure';
import {loadPenEditContext, placeCaretInsertions, type PenEditContext} from './penEditReview';
import {findShapeMarks} from './shapeMarks';

/**
 * Reading a page's edit marks into a review preview: the strokes and their shapes, the words they
 * cover, replace marks paired with their tagged text, insertions placed at their carets - for the
 * current page of the open note. Recognition
 * of one mark lives in `editMarkerAnalysis.ts` and `shapeMarks.ts`; the pure parts in
 * `src/domain/marker*.ts`. Applying the preview is `markerApply.ts`.
 */

type TextElement = Element & {textBox: TextBox};

type ReplaceInfo = {
  pair: MarkerStrokeAnalysis<Element>[];
  ignoredReason?: string;
  penEdit?: PenEditEntry;
};

const REPLACE_WITHOUT_TEXT =
  'Replace mark without new text: write the new words right after it, lasso them and tap Insertion or Replacement.';

/**
 * Builds the edit-marker preview of the current page. Marks on a textbox whose font can't be read
 * are ignored, and the preview's status line says so (technical-design-swap-space-marks.md §2).
 */
export async function getEditMarkerPreview(): Promise<EditMarkerPreview> {
  resetFontWarnings();
  let pageElements: Element[] = [];
  const calibration = getEditMarkerCalibration();
  try {
    const context = await readCurrentPageContext();
    pageElements = context.pageElements;
    startMarkerDiagnostics(context.page);
    logEditMarker('previewStart', {page: context.page, calibration});
    const preview = await analyzePage(context, calibration);
    if (preview.fontWarning) {
      logEditMarker('fontWarning', {fontWarning: preview.fontWarning});
    }
    return preview;
  } finally {
    await recycleElements(pageElements);
  }
}

async function analyzePage(
  context: PageContext,
  calibration: ReturnType<typeof getEditMarkerCalibration>,
): Promise<EditMarkerPreview> {
  const {notePath, page, pageElements} = context;
  const pen = await loadPenEditContext(notePath, page, pageElements);

  // Tagged snippets' handwriting and Textbox Tools' own badges and numbers are never markers.
  const markers = pageElements.filter(
    element => isSupportedEditMarkerElement(element) && !pen.isExcluded(element),
  );
  const pageTextboxes = pageElements.filter(isNormalTextElement);
  await logContext(context, markers, pageTextboxes);
  if (markers.length === 0 && pen.entries.length === 0) {
    return createEmptyPreview();
  }

  const measurer = createTextboxMeasurer(calibration);
  const strokeAnalyses = await readStrokeAnalyses(markers);
  const strokeStatsByUuid = new Map(
    strokeAnalyses.map(analysis => [analysis.marker.uuid, analysis.strokeStats]),
  );

  // Marks read from their shape first: paragraph breaks, spaces, swaps
  // (technical-design-swap-space-marks.md §6.1). Their strokes never reach the delete analysis.
  const shapeMarks = await findShapeMarks(markers, strokeStatsByUuid, pageTextboxes, measurer);
  const isFree = (element: Element) => !shapeMarks.consumedNums.has(element.numInPage);
  // Strokes used by a shape mark are never a replace mark's verticals or loop.
  const modifierAnalyses = strokeAnalyses.filter(analysis => isFree(analysis.marker));
  const lineMarkers = markers.filter(isFree);
  const candidateResults = await Promise.all(
    lineMarkers.map(marker =>
      analyzeDeleteMarker(marker, pageTextboxes, measurer, strokeStatsByUuid.get(marker.uuid)),
    ),
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
  const groupedTextboxes = new Map<string, TextElement>();
  const drafts = buildLineMarkDrafts(markerCandidates, replaceInfo, ignoredMarkers, groupedTextboxes);
  ignoredMarkers.push(...unpairedPenEdits(pen.entries, pairedPenEditIds, lockedPenIds));

  // Insertions: into the paragraph their caret points to, or as a new paragraph between two.
  const placed = await placeCaretInsertions(pen.entries, pen.carets, pageTextboxes, measurer);
  placed.ignored.forEach(({entry, reason}) => {
    ignoredMarkers.push(penEditIgnored(entry, `Insertion ${entry.number}`, reason));
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
  const preview = assembleMarkerPreview(base, pen.states);

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
        return true;
      })
      .forEach(entry => {
        const penEdit = pen.strikeOwner(entry.candidate.marker);
        if (penEdit) {
          pairedPenEditIds.add(penEdit.id);
        }
        replaceInfo.set(entry.candidate.markerUuid, {
          pair: entry.pair,
          ...(penEdit ? {penEdit} : {ignoredReason: REPLACE_WITHOUT_TEXT}),
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

    const wordTexts = nextWords.map(word => word.text);
    const penEdit = info?.penEdit;
    const kind: EditMarkerOperationKind = penEdit ? 'replace' : 'delete';
    // Punctuation at the ends that the stroke didn't reach stays (technical-design-pen-edits-2.md
    // §6): "default," with the line over "default" keeps its comma.
    const span = coveredSpan(
      nextWords,
      candidate.strokeStats.rect.left,
      candidate.strokeStats.rect.right,
    ) ?? {start: nextWords[0].start, end: nextWords[nextWords.length - 1].end};
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
        textStart: nextWords[0].start,
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
    .map(entry =>
      penEditIgnored(
        entry,
        `Text ${entry.number}`,
        'No replace mark or caret was found just before it. Select mark, then draw or lasso its mark.',
      ),
    );
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
