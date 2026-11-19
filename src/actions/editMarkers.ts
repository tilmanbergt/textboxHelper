import type {Element, TextBox} from 'sn-plugin-lib';
import {createEditMarkerBackupPayload} from '../domain/backupPayload';
import {buildLockedFontsMessage, NOTE_SYSTEM_FONT_PATH} from '../domain/fontPaths';
import {assembleMarkerPreview} from '../domain/markerAssembly';
import {plural} from '../domain/plural';
import {cloneRect} from '../domain/geometry';
import {
  buildRecognizeRect,
  findBestReplaceModifierPair,
  findReplaceLoop,
  isStraightLineGeometryElement,
  isSupportedEditMarkerElement,
  orderTextboxMarkerCandidates,
} from '../domain/markerStrokes';
import {
  buildIgnoredMarker,
  buildOperationDetailWithReplacement,
  buildTextboxLogSummary,
  cloneTextElementForMutation,
  countElementTypes,
  createEmptyPreview,
  formatOperationSnippet,
} from '../domain/markerText';
import type {
  EditMarkerCalibration,
  EditMarkerOperationKind,
  EditMarkerPreview,
  EditMarkerPreviewScope,
  IgnoredEditMarker,
  MarkerPreviewBase,
  MarkerStrokeAnalysis,
  MarkerTextboxBase,
  OperationDraft,
  TextMutationPlan,
} from '../domain/markerTypes';
import type {PenEditEntry} from '../domain/penEditModel';
import {DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION} from '../domain/textboxLayout';
import {
  DEFAULT_FONT_SIZE,
  type Rect,
  type TextboxData,
} from '../domain/textboxModel';
import {parsePenEditUserData} from '../domain/penEditTags';
import {SPLIT_SIGN, splitParagraphParts} from '../domain/paragraphMarks';
import {
  analyzeCaret,
  placeGapParagraphs,
  planReflow,
  type CaretDirection,
  type ReflowEvent,
  type ReflowItem,
} from '../domain/penEditCaret';
import {shiftRect} from '../domain/penEditMatching';
import {rectHeight, rectWidth} from '../domain/geometry';
import {insertTextboxesIntoFile} from '../supernote/noteTextInsertion';
import {isNormalTextElement, sortTextElements} from '../domain/textboxEditPlan';
import {writeBackupFile} from '../storage/backupFile';
import {writeJsonExportFile} from '../storage/exportFile';
import {
  loadMarkerStrokeStats,
  readStrokePath,
} from '../supernote/markerStrokeRead';
import {
  deletePageElements,
  getPreviewContext,
  hideLassoBox,
  modifyPageElements,
  readPageElements,
  readPageSizeForDiagnostics,
  recycleElements,
  saveCurrentNoteForConsistency,
} from '../supernote/noteElements';
import {
  buildResizedTextboxRect,
  estimateTextboxHeight,
  resetFontWarnings,
} from '../supernote/textboxMetrics';
import {logEditMarker, markerDiagnostics} from '../utils/editMarkerLog';
import {analyzeDeleteMarker, type MarkerCandidate} from './editMarkerAnalysis';
import {createTextboxMeasurer} from './markerMeasure';
import {coveredSpan} from '../domain/edgeShift';
import {
  loadPenEditContext,
  markPenEditsApplied,
  penEditBackupData,
  locateMarkOnPage,
  penEditElementNums,
  placeCaretInsertions,
} from './penEditReview';

/**
 * Edit marker flow.
 *
 * This module runs the full marker lifecycle:
 * - load lasso or full-page context
 * - recognize delete and replace markers
 * - take replacement and insertion text from the tagged snippets (pen edits)
 * - build the preview shown in the UI
 * - apply text mutations and remove consumed markers
 *
 * Recognition of one marker lives in `editMarkerAnalysis.ts`; strokes, text changes and the
 * preview types in `src/domain/marker*.ts`. This file orchestrates those pieces rather than
 * re-implementing them.
 */

export type EditMarkerProgressUpdate = {
  message: string;
  canCancel: boolean;
};

export type EditMarkerApplyResult = {
  message: string;
  backupPath: string;
  clipboardSummary: string;
  appliedOperationCount: number;
  removedMarkerCount: number;
  affectedTextboxCount: number;
};
type TextElement = Element & {
  textBox: TextBox;
};
type EditMarkerApplyOptions = {
  onProgress?: (update: EditMarkerProgressUpdate) => void;
};
const DEFAULT_EDIT_MARKER_CALIBRATION: EditMarkerCalibration = {
  ...DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION,
};

let currentEditMarkerCalibration: EditMarkerCalibration = {
  ...DEFAULT_EDIT_MARKER_CALIBRATION,
};
let lastDiagnosticsScope: EditMarkerPreviewScope | null = null;

export function getEditMarkerCalibration(): EditMarkerCalibration {
  return {
    ...currentEditMarkerCalibration,
  };
}

export function setEditMarkerCalibration(
  nextCalibration: Partial<EditMarkerCalibration>,
): EditMarkerCalibration {
  currentEditMarkerCalibration = {
    ...currentEditMarkerCalibration,
    ...nextCalibration,
  };

  logEditMarker('calibrationUpdated', currentEditMarkerCalibration);
  return getEditMarkerCalibration();
}

export function resetEditMarkerCalibration(): EditMarkerCalibration {
  currentEditMarkerCalibration = {
    ...DEFAULT_EDIT_MARKER_CALIBRATION,
  };

  logEditMarker('calibrationReset', currentEditMarkerCalibration);
  return getEditMarkerCalibration();
}

function reportProgress(
  options: EditMarkerApplyOptions | undefined,
  message: string,
  canCancel: boolean,
): void {
  options?.onProgress?.({message, canCancel});
}

/**
 * Writes the trace of the last edit-marker preview as JSON to the EXPORT folder, only when the
 * user taps "Save Diagnostics". It contains the stages of every marker (sources, stroke and word
 * positions, the reason a marker was ignored) and short text previews of the textboxes involved.
 */
export async function saveEditMarkerDiagnostics(): Promise<string> {
  const snapshot = markerDiagnostics.snapshot();
  if (snapshot.entries.length === 0) {
    throw new Error('There is no marker preview to save diagnostics for yet.');
  }
  const createdAt = new Date().toISOString();
  const fileName = `textboxhelper-marker-diagnostics-${createdAt.replace(
    /[:.]/g,
    '-',
  )}.json`;
  return writeJsonExportFile(fileName, {
    kind: 'edit-marker-diagnostics',
    createdAt,
    previewScope: lastDiagnosticsScope,
    entryCount: snapshot.entries.length,
    droppedCount: snapshot.droppedCount,
    entries: snapshot.entries,
  });
}

/**
 * Builds the edit-marker preview. Marks on a textbox whose font can't be read are ignored, and
 * the preview's status line says so (technical-design-swap-space-marks.md §2).
 */
export async function getEditMarkerPreview(
  previewScope: EditMarkerPreviewScope = 'lasso',
): Promise<EditMarkerPreview> {
  resetFontWarnings();
  const preview = await buildEditMarkerPreview(previewScope);
  if (preview.fontWarning) {
    logEditMarker('fontWarning', {fontWarning: preview.fontWarning});
  }
  return preview;
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

async function buildEditMarkerPreview(
  previewScope: EditMarkerPreviewScope,
): Promise<EditMarkerPreview> {
  let lassoElements: Element[] = [];
  let pageElements: Element[] = [];
  markerDiagnostics.clear();
  lastDiagnosticsScope = previewScope;
  logEditMarker('previewStart', {
    previewScope,
    calibration: {...currentEditMarkerCalibration},
  });

  try {
    const context = await getPreviewContext(previewScope);
    lassoElements = context.lassoElements;
    pageElements = context.pageElements;
    const effectiveSelection = context.effectiveSelection;
    const pen = await loadPenEditContext(
      context.notePath,
      context.page,
      pageElements,
      previewScope === 'lasso' ? lassoElements : null,
    );

    // Tagged snippets' handwriting and Textbox Tools' own badges and numbers are never markers.
    const selectedMarkers = effectiveSelection.filter(
      element =>
        isSupportedEditMarkerElement(element) && !pen.isExcluded(element),
    );
    const selectedTextboxes = sortTextElements(
      effectiveSelection.filter(isNormalTextElement),
    );
    logEditMarker('previewContext', {
      page: context.page,
      pageSize: await readPageSizeForDiagnostics(
        context.notePath,
        context.page,
      ),
      lassoElementCount: lassoElements.length,
      pageElementCount: pageElements.length,
      elementTypes: countElementTypes(effectiveSelection),
      selectedMarkerCount: selectedMarkers.length,
      selectedTextboxCount: selectedTextboxes.length,
      // Pen-edit icons and numbers on the page: whether userData survives moves (pen-edits §5).
      penEditElements: pageElements
        .map(element => ({
          element,
          tag: parsePenEditUserData(element.userData),
        }))
        .filter(item => item.tag !== null)
        .map(({element, tag}) => ({
          id: tag?.id,
          role: tag?.role,
          uuid: element.uuid,
          numInPage: element.numInPage,
          rect: element.textBox?.textRect ?? null,
        })),
    });

    if (effectiveSelection.length === 0) {
      return createEmptyPreview();
    }

    if (selectedMarkers.length === 0 && pen.entries.length === 0) {
      return {
        ...createEmptyPreview(0, selectedTextboxes.length),
        summaryMessage: 'No edit markers in the selection.',
      };
    }

    const pageTextboxes = pageElements.filter(isNormalTextElement);
    const measurer = createTextboxMeasurer(currentEditMarkerCalibration);
    logEditMarker('previewContext', {
      previewScope: context.previewScope,
      notePath: context.notePath,
      page: context.page,
      lassoElementCount: lassoElements.length,
      effectiveSelectionCount: effectiveSelection.length,
      selectedMarkerCount: selectedMarkers.length,
      selectedTextboxCount: selectedTextboxes.length,
      pageTextboxCount: pageTextboxes.length,
      selectedTextboxes: selectedTextboxes.map(buildTextboxLogSummary),
      pageTextboxes: pageTextboxes.map(buildTextboxLogSummary),
      selectedMarkers: selectedMarkers.map(marker => ({
        uuid: marker.uuid,
        numInPage: marker.numInPage,
        type: marker.type,
        geometryType: marker.geometry?.type || null,
        layerNum: marker.layerNum,
        recognizeRect: buildRecognizeRect(marker.recognizeResult),
      })),
    });
    const strokeAnalyses = (
      await Promise.all(
        selectedMarkers.map(async marker => {
          const strokeStats = await loadMarkerStrokeStats(marker);
          return strokeStats ? {marker, strokeStats} : null;
        }),
      )
    ).filter(
      (analysis): analysis is MarkerStrokeAnalysis<Element> => !!analysis,
    );

    const strokeStatsByUuid = new Map(
      strokeAnalyses.map(analysis => [
        analysis.marker.uuid,
        analysis.strokeStats,
      ]),
    );

    // Paragraph marks on their own (< or > between two lines, a step mark): a paragraph break,
    // never a delete candidate (technical-design-paragraph-marks.md).
    const paragraphMarks: Array<{
      marker: Element;
      textbox: TextElement;
      offset: number;
      direction: CaretDirection;
    }> = [];
    const paragraphMarkIgnored: IgnoredEditMarker[] = [];
    const paragraphMarkNums = new Set<number>();
    for (const marker of selectedMarkers) {
      if (isStraightLineGeometryElement(marker)) {
        continue;
      }
      const shape = analyzeCaret(await readStrokePath(marker));
      if (!shape || shape.direction === 'down' || shape.direction === 'up') {
        continue;
      }
      paragraphMarkNums.add(marker.numInPage);
      const {near, target} = await locateMarkOnPage(
        shape.tip,
        shape.direction,
        pageTextboxes,
        measurer,
      );
      const textbox =
        target?.kind === 'split'
          ? near.find(item => item.uuid === target.uuid)
          : undefined;
      logEditMarker('paragraphMark', {
        markerNumInPage: marker.numInPage,
        direction: shape.direction,
        tip: shape.tip,
        target,
      });
      if (target?.kind === 'split' && textbox) {
        paragraphMarks.push({
          marker,
          textbox,
          offset: target.offset,
          direction: shape.direction,
        });
        continue;
      }
      const reason =
        target?.kind === 'unclear'
          ? target.reason
          : target?.kind === 'gap'
          ? "It is at a paragraph's start or end, which is already a paragraph break."
          : "It doesn't point between two lines of a paragraph.";
      paragraphMarkIgnored.push({
        ...buildIgnoredMarker(marker, reason),
        removableNums: [marker.numInPage],
      });
    }

    const nonParagraphMarkers = selectedMarkers.filter(
      marker => !paragraphMarkNums.has(marker.numInPage),
    );
    const candidateResults = await Promise.all(
      nonParagraphMarkers.map(marker =>
          analyzeDeleteMarker(
            marker,
            pageTextboxes,
            measurer,
            strokeStatsByUuid.get(marker.uuid),
          ),
        ),
    );

    // Tagged replacements whose strike is on a textbox with an unreadable font.
    const lockedPenIds = new Set<string>();
    candidateResults.forEach((result, index) => {
      if (result.fontLocked) {
        const owner = pen.strikeOwner(nonParagraphMarkers[index]);
        if (owner) {
          lockedPenIds.add(owner.id);
        }
      }
    });

    const markerCandidates = candidateResults
      .map(result => result.candidate)
      .filter((candidate): candidate is MarkerCandidate => !!candidate)
      .sort((left, right) => {
        if (Math.abs(left.markerSortTop - right.markerSortTop) > 1) {
          return left.markerSortTop - right.markerSortTop;
        }

        return left.markerSortLeft - right.markerSortLeft;
      });

    const ignoredMarkers = [
      ...paragraphMarkIgnored,
      ...candidateResults
        .map(result => result.ignored)
        .filter((ignored): ignored is IgnoredEditMarker => !!ignored),
    ];

    const usedRangesByTextbox = new Map<string, Set<string>>();
    const groupedTextboxes = new Map<string, TextElement>();

    const targetTextboxesByOrder = sortTextElements([
      ...new Map(
        markerCandidates.map(candidate => [
          candidate.targetTextbox.uuid,
          candidate.targetTextbox,
        ]),
      ).values(),
    ]);

    const replaceCandidateInfoByMarkerUuid = new Map<
      string,
      {
        pair: MarkerStrokeAnalysis<Element>[];
        ignoredReason?: string;
        penEdit?: PenEditEntry;
      }
    >();
    const pairedPenEditIds = new Set<string>();

    targetTextboxesByOrder.forEach(targetTextbox => {
      const textboxCandidates = orderTextboxMarkerCandidates(
        markerCandidates.filter(
          candidate => candidate.targetTextbox.uuid === targetTextbox.uuid,
        ),
      );
      const usedModifierMarkerUuids = new Set<string>();
      const replaceCandidates = textboxCandidates
        .map(candidate => ({
          candidate,
          // Two short vertical lines across the strike, or a small loop right after it.
          pair: replaceModifiers(candidate, strokeAnalyses),
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
            entry.pair.some(pairEntry =>
              usedModifierMarkerUuids.has(pairEntry.marker.uuid),
            )
          ) {
            return false;
          }

          entry.pair.forEach(pairEntry => {
            usedModifierMarkerUuids.add(pairEntry.marker.uuid);
          });
          return true;
        });

      // A replace mark takes its text from the tagged snippet written right after it. One without
      // a snippet has no new text: it is listed under Ignored with how to give it one.
      replaceCandidates.forEach(entry => {
        const penEdit = pen.strikeOwner(entry.candidate.marker);
        if (penEdit) {
          pairedPenEditIds.add(penEdit.id);
        }
        replaceCandidateInfoByMarkerUuid.set(entry.candidate.markerUuid, {
          pair: entry.pair,
          ...(penEdit
            ? {penEdit}
            : {
                ignoredReason:
                  'Replace mark without new text: write the new words right after it, lasso them and tap Insertion or Replacement.',
              }),
        });
      });
    });

    const drafts: OperationDraft[] = [];
    markerCandidates.forEach(candidate => {
      const replaceInfo = replaceCandidateInfoByMarkerUuid.get(
        candidate.markerUuid,
      );
      if (replaceInfo?.ignoredReason) {
        ignoredMarkers.push({
          ...buildIgnoredMarker(candidate.marker, replaceInfo.ignoredReason),
          removableNums: [
            candidate.markerNumInPage,
            ...replaceInfo.pair.map(pairEntry => pairEntry.marker.numInPage),
          ],
        });
        return;
      }

      const textboxUuid = candidate.targetTextbox.uuid;
      const usedRanges =
        usedRangesByTextbox.get(textboxUuid) || new Set<string>();
      const nextWords = candidate.words.filter(
        word => !usedRanges.has(`${word.start}-${word.end}`),
      );

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

      nextWords.forEach(word => {
        usedRanges.add(`${word.start}-${word.end}`);
      });

      usedRangesByTextbox.set(textboxUuid, usedRanges);
      groupedTextboxes.set(textboxUuid, candidate.targetTextbox);

      const wordTexts = nextWords.map(word => word.text);
      const penEdit = replaceInfo?.penEdit;
      const kind: EditMarkerOperationKind = penEdit ? 'replace' : 'delete';
      // Punctuation at the ends that the stroke didn't reach stays (technical-design-pen-edits-2.md
      // §6): "default," with the line over "default" keeps its comma.
      const span = coveredSpan(
        nextWords,
        candidate.strokeStats.rect.left,
        candidate.strokeStats.rect.right,
      ) ?? {start: nextWords[0].start, end: nextWords[nextWords.length - 1].end};
      drafts.push({
        range: {
          kind,
          start: span.start,
          end: span.end,
        },
        operation: {
          id: `${candidate.markerUuid}:${candidate.targetTextbox.uuid}`,
          kind,
          markerUuid: candidate.markerUuid,
          markerNumInPage: candidate.markerNumInPage,
          consumedMarkerNums: [
            candidate.markerNumInPage,
            ...(replaceInfo?.pair.map(
              pairEntry => pairEntry.marker.numInPage,
            ) || []),
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
          ...(penEdit
            ? {penEditId: penEdit.id, penEditNumber: penEdit.number}
            : {}),
        },
      });
    });

    // Tagged text without a mark: Select mark gives it one.
    pen.entries
      .filter(entry => entry.kind === 'unpaired')
      .forEach(entry => {
        ignoredMarkers.push({
          markerUuid: entry.id,
          markerNumInPage: 0,
          summary: `Text ${entry.number}`,
          reason:
            'No replace mark or caret was found just before it. Select mark, then draw or lasso its mark.',
          penEditNumber: entry.number,
          penEditId: entry.id,
        });
      });
    // Tagged replacements whose mark wasn't recognized on the page.
    pen.entries
      .filter(
        entry =>
          entry.kind === 'replacement' && !pairedPenEditIds.has(entry.id),
      )
      .forEach(entry => {
        ignoredMarkers.push({
          markerUuid: entry.id,
          markerNumInPage: 0,
          summary: `Replacement ${entry.number}`,
          reason: lockedPenIds.has(entry.id)
            ? "Its replace mark is on a textbox whose font can't be read by plugins. Copy the font file to MyStyle/TextboxHelper/fonts and open the review again."
            : entry.mark
            ? 'Its replace mark was not recognized on the page (erased, or not over a textbox).'
            : 'No replace mark was found just before it when it was tagged.',
          penEditNumber: entry.number,
          penEditId: entry.id,
        });
      });
    // Insertions: into the paragraph their caret points to, or as a new paragraph between two.
    const placed = await placeCaretInsertions(
      pen.entries,
      pen.carets,
      pageTextboxes,
      measurer,
    );
    placed.ignored.forEach(({entry, reason}) => {
      ignoredMarkers.push({
        markerUuid: entry.id,
        markerNumInPage: 0,
        summary: `Insertion ${entry.number}`,
        reason,
        penEditNumber: entry.number,
        penEditId: entry.id,
      });
    });
    paragraphMarks.forEach(({marker, textbox, offset, direction}) => {
      groupedTextboxes.set(textbox.uuid, textbox);
      drafts.push({
        range: {kind: 'replace', start: offset, end: offset},
        operation: {
          id: `split:${marker.uuid}`,
          kind: 'split',
          markerUuid: marker.uuid,
          markerNumInPage: marker.numInPage,
          consumedMarkerNums: [marker.numInPage],
          targetTextboxUuid: textbox.uuid,
          targetTextboxNumInPage: textbox.numInPage,
          lineIndex: 0,
          summary: 'Paragraph break',
          detail: `Textbox ${textbox.numInPage} · ${
            direction === 'step' ? 'at a word gap' : 'between two lines'
          }`,
          words: [],
          textStart: offset,
        },
      });
    });

    placed.inline.forEach(({entry, textbox, offset, mode, uncertain}) => {
      groupedTextboxes.set(textbox.uuid, textbox);
      drafts.push({
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
          detail: `Textbox ${textbox.numInPage} · ${
            mode === 'inWord'
              ? 'inside a word'
              : mode === 'blankLine' || mode === 'paragraph'
              ? 'new paragraph'
              : 'between words'
          }`,
          words: [],
          textStart: offset,
          penEditId: entry.id,
          penEditNumber: entry.number,
          insertMode: mode,
          ...(uncertain ? {uncertain} : {}),
        },
      });
    });
    const insertedIds = new Set([
      ...placed.inline.map(item => item.entry.id),
      ...placed.gaps.map(gap => gap.penEditId),
    ]);

    const textboxBases: MarkerTextboxBase[] = sortTextElements([
      ...groupedTextboxes.values(),
    ]).map(textbox => ({
      uuid: textbox.uuid,
      numInPage: textbox.numInPage,
      layerNum: textbox.layerNum,
      originalText: textbox.textBox.textContentFull || '',
      textRect: cloneRect(textbox.textBox.textRect),
      fontSize: textbox.textBox.fontSize || DEFAULT_FONT_SIZE,
      fontPath: textbox.textBox.fontPath,
      textAlign: textbox.textBox.textAlign ?? 0,
      textBold: textbox.textBox.textBold ?? 0,
      textItalics: textbox.textBox.textItalics ?? 0,
      textFrameWidthType: textbox.textBox.textFrameWidthType ?? 0,
      textFrameStyle: textbox.textBox.textFrameStyle ?? 0,
      textEditable: textbox.textBox.textEditable ?? 0,
    }));

    const base: MarkerPreviewBase = {
      notePath: context.notePath,
      page: context.page,
      selectedMarkerCount: selectedMarkers.length,
      selectedTextboxCount: selectedTextboxes.length,
      drafts,
      ignored: ignoredMarkers,
      textboxes: textboxBases,
      insertions: placed.gaps,
      penEdits: pen.views.filter(
        view => pairedPenEditIds.has(view.id) || insertedIds.has(view.id),
      ),
      penStates: pen.states,
    };
    const preview = assembleMarkerPreview(base, pen.states);

    logEditMarker('previewResult', {
      selectedMarkerCount: selectedMarkers.length,
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
  } finally {
    await recycleElements(lassoElements);
    await recycleElements(pageElements);
  }
}

export async function applyEditMarkerPreview(
  preview: EditMarkerPreview,
  options?: EditMarkerApplyOptions,
): Promise<EditMarkerApplyResult> {
  const plan = preview.applyPlan;
  if (!plan || !preview.canApply) {
    throw new Error('No recognized edit marker operations are ready to apply.');
  }

  let pageElements: Element[] = [];

  try {
    reportProgress(options, 'Refreshing page state...', true);
    pageElements = await readPageElements(
      plan.notePath,
      plan.page,
      `Could not read page ${plan.page} elements before applying edit markers.`,
    );

    const pageTextboxByNum = new Map(
      pageElements
        .filter(isNormalTextElement)
        .map(element => [element.numInPage, element]),
    );

    plan.textMutations.forEach(mutation => {
      const currentTextbox = pageTextboxByNum.get(mutation.numInPage);
      if (!currentTextbox) {
        throw new Error(
          `Textbox ${mutation.numInPage} is no longer available. Refresh the preview and try again.`,
        );
      }

      const currentText = currentTextbox.textBox.textContentFull || '';
      if (currentText !== mutation.originalText) {
        throw new Error(
          `Textbox ${mutation.numInPage} changed after preview. Refresh the review before applying.`,
        );
      }
    });

    // Paragraph breaks: a textbox's new text is cut at the split signs; the first part stays,
    // every further part becomes a new paragraph right below it (technical-design-paragraph-marks.md).
    const splitTails = new Map<number, string[]>();
    const cutMutations = plan.textMutations.map(mutation => {
      if (!mutation.nextText.includes(SPLIT_SIGN)) {
        return mutation;
      }
      const [head = '', ...tail] = splitParagraphParts(mutation.nextText);
      splitTails.set(mutation.numInPage, tail);
      return {...mutation, nextText: head};
    });

    // The new heights are measured now, once the pen edits' text is final.
    const textMutations: TextMutationPlan[] = await Promise.all(
      cutMutations.map(async mutation => ({
        ...mutation,
        nextTextRect: await buildResizedTextboxRect(
          mutation.textRect,
          mutation.nextText,
          mutation.fontSize,
          mutation.fontPath || undefined,
          currentEditMarkerCalibration,
        ),
      })),
    );

    reportProgress(options, 'Creating backup...', true);
    const penBackup =
      plan.penEditIds.length > 0
        ? await penEditBackupData(plan.penEditIds)
        : null;
    const backupPayload = {
      ...createEditMarkerBackupPayload({...plan, textMutations}),
      ...(penBackup ? {penEdits: penBackup} : {}),
    };
    const {backupPath, clipboardSummary} = await writeBackupFile(backupPayload);

    reportProgress(options, 'Saving current note...', false);
    await saveCurrentNoteForConsistency('applying edit markers');

    reportProgress(options, 'Applying recognized markers...', false);
    // New paragraphs, measured now: insertions in the gaps between paragraphs, and the parts of
    // split paragraphs, which follow their paragraph's new (shorter) text.
    type NewParagraph = {
      key: string;
      group: string;
      text: string;
      left: number;
      width: number;
      style: TextboxData;
      above: Rect | null;
      below: Rect | null;
    };
    const textboxBelow = (rect: Rect): Rect | null =>
      [...pageTextboxByNum.values()]
        .map(textbox => textbox.textBox.textRect)
        .filter(
          other =>
            other.top >= rect.bottom - 2 &&
            Math.min(other.right, rect.right) > Math.max(other.left, rect.left),
        )
        .sort((left, right) => left.top - right.top)[0] ?? null;
    const newParagraphs: NewParagraph[] = [
      ...plan.insertions.map(insertion => ({
        key: `new:${insertion.penEditId}`,
        group: `${insertion.aboveRect?.bottom ?? 'top'}:${
          insertion.belowRect?.top ?? 'end'
        }:${insertion.left}`,
        text: insertion.text,
        left: insertion.left,
        width: insertion.width,
        style: insertion.style,
        above: insertion.aboveRect,
        below: insertion.belowRect,
      })),
      ...textMutations.flatMap(mutation => {
        const textbox = pageTextboxByNum.get(mutation.numInPage);
        return (splitTails.get(mutation.numInPage) ?? []).map(
          (text, index) => ({
            key: `split:${mutation.numInPage}:${index}`,
            group: `split:${mutation.numInPage}`,
            text,
            left: mutation.textRect.left,
            width: rectWidth(mutation.textRect),
            style: {
              ...(textbox?.textBox ?? {}),
              fontSize: mutation.fontSize,
              fontPath: mutation.fontPath,
            } as TextboxData,
            above: mutation.nextTextRect,
            below: textboxBelow(mutation.textRect),
          }),
        );
      }),
    ];
    const gapParagraphs = await Promise.all(
      newParagraphs.map(async paragraph => {
        const style = {
          ...paragraph.style,
          fontPath: paragraph.style.fontPath || NOTE_SYSTEM_FONT_PATH,
        };
        const height = await estimateTextboxHeight(
          paragraph.text,
          paragraph.width,
          style.fontSize || DEFAULT_FONT_SIZE,
          style.fontPath,
          currentEditMarkerCalibration,
        );
        return {paragraph, style, height};
      }),
    );
    const placedGaps = placeGapParagraphs(
      gapParagraphs.map(({paragraph, height}) => ({
        key: paragraph.key,
        group: paragraph.group,
        left: paragraph.left,
        width: paragraph.width,
        height,
        above: paragraph.above,
        below: paragraph.below,
      })),
    );

    // Paragraphs that got longer, and new paragraphs, push the paragraphs below them down.
    const mutationByNum = new Map(
      textMutations.map(mutation => [mutation.numInPage, mutation]),
    );
    const growthEvents: ReflowEvent[] = textMutations.map(mutation => ({
      y: mutation.textRect.bottom,
      left: mutation.textRect.left,
      right: mutation.textRect.right,
      delta: rectHeight(mutation.nextTextRect) - rectHeight(mutation.textRect),
      sourceKeys: [`n:${mutation.numInPage}`],
    }));
    const reflowItems: ReflowItem[] = [
      ...[...pageTextboxByNum.values()].map(textbox => ({
        key: `n:${textbox.numInPage}`,
        rect: textbox.textBox.textRect,
      })),
      ...[...placedGaps.rects].map(([key, rect]) => ({key, rect})),
    ];
    const shifts = planReflow(reflowItems, [
      ...growthEvents,
      ...placedGaps.events,
    ]);

    const modifiedTextboxes: Element[] = [];
    for (const textbox of pageTextboxByNum.values()) {
      const mutation = mutationByNum.get(textbox.numInPage);
      const dy = shifts.get(`n:${textbox.numInPage}`) ?? 0;
      if (mutation) {
        if (mutation.nextText.length > 0) {
          modifiedTextboxes.push(
            cloneTextElementForMutation(textbox, {
              ...mutation,
              nextTextRect: shiftRect(mutation.nextTextRect, 0, dy),
            }),
          );
        }
      } else if (dy > 0) {
        modifiedTextboxes.push({
          ...textbox,
          textBox: {
            ...textbox.textBox,
            textRect: shiftRect(textbox.textBox.textRect, 0, dy),
          },
        } as Element);
      }
    }
    const emptyTargetTextboxNums = textMutations
      .filter(mutation => mutation.nextText.length === 0)
      .map(mutation => mutation.numInPage);
    const penEditNums = penEditElementNums(
      plan.penEditIds,
      penBackup?.entries ?? [],
      pageElements,
    );
    logEditMarker('applyReflow', {
      shifts: Object.fromEntries(shifts),
      newParagraphs: Object.fromEntries(placedGaps.rects),
    });

    await modifyPageElements(plan.notePath, plan.page, modifiedTextboxes);
    await deletePageElements(plan.notePath, plan.page, [
      ...plan.recognizedMarkerNums,
      ...emptyTargetTextboxNums,
      ...penEditNums,
    ]);

    // New textboxes last, into the file like the changes above: inserting may renumber elements.
    if (gapParagraphs.length > 0) {
      reportProgress(options, 'Inserting new paragraphs...', false);
      await insertTextboxesIntoFile(
        plan.notePath,
        plan.page,
        gapParagraphs.map(({paragraph, style}) => {
          const key = paragraph.key;
          const rect = placedGaps.rects.get(key) as Rect;
          return {
            text: paragraph.text,
            rect: shiftRect(rect, 0, shifts.get(key) ?? 0),
            style: {
              fontSize: style.fontSize || DEFAULT_FONT_SIZE,
              fontPath: style.fontPath,
              textAlign: style.textAlign ?? 0,
              textBold: style.textBold ?? 0,
              textItalics: style.textItalics ?? 0,
              textFrameWidthType: style.textFrameWidthType ?? 0,
              textFrameStyle: style.textFrameStyle ?? 0,
              textEditable: style.textEditable ?? 0,
            },
          };
        }),
      );
    }

    try {
      await markPenEditsApplied(plan.penEditIds);
    } catch (error) {
      console.warn(
        '[EditMarkerActions] pen edits not marked applied',
        String(error),
      );
    }

    await hideLassoBox('[EditMarkerActions]');

    const movedCount = [...shifts.keys()].filter(key =>
      key.startsWith('n:'),
    ).length;
    const movedNote =
      movedCount > 0
        ? ` Moved ${plural(movedCount, 'paragraph')} below down to make room.`
        : '';
    const left = preview.pendingCount + preview.skippedCount;
    const leftNote =
      left > 0 ? ` ${plural(left, 'pen edit')} left for later.` : '';
    return {
      message: `Applied ${plural(
        plan.operations.length,
        'change',
      )} and removed ${plural(
        plan.recognizedMarkerNums.length,
        'marker',
      )}.${leftNote}${movedNote}`,
      backupPath,
      clipboardSummary,
      appliedOperationCount: plan.operations.length,
      removedMarkerCount: plan.recognizedMarkerNums.length,
      affectedTextboxCount: textMutations.length,
    };
  } finally {
    await recycleElements(pageElements);
  }
}

/** Whether "Remove" is offered for an ignored item: tagged pen edits and markers on a textbox. */
