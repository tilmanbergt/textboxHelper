import type {Element, TextBox} from 'sn-plugin-lib';
import {createEditMarkerBackupPayload} from '../domain/backupPayload';
import {appendFontWarning} from '../domain/fontPaths';
import {cloneRect} from '../domain/geometry';
import {
  buildRecognizeRect,
  findBestReplaceModifierPair,
  isSupportedEditMarkerElement,
  orderTextboxMarkerCandidates,
} from '../domain/markerStrokes';
import {
  applyTextMutationRanges,
  applyTextMutationRangesDetailed,
  buildIgnoredMarker,
  buildOperationDetailWithReplacement,
  buildReplacementLineLogSummary,
  buildSelectionMessage,
  buildSummaryMessage,
  buildTextboxLogSummary,
  cloneTextElementForMutation,
  countElementTypes,
  createEmptyPreview,
  formatOperationSnippet,
  mergeHighlightRanges,
} from '../domain/markerText';
import type {
  EditMarkerCalibration,
  EditMarkerOperationKind,
  EditMarkerPreview,
  EditMarkerPreviewScope,
  IgnoredEditMarker,
  MarkerStrokeAnalysis,
  RecognizedEditOperation,
  TextMutationPlan,
  TextMutationRange,
  WordCandidate,
} from '../domain/markerTypes';
import {DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION} from '../domain/textboxLayout';
import {DEFAULT_FONT_SIZE} from '../domain/textboxModel';
import {isNormalTextElement, sortTextElements} from '../domain/textboxEditPlan';
import {writeBackupFile} from '../storage/backupFile';
import {writeJsonExportFile} from '../storage/exportFile';
import {loadMarkerStrokeStats} from '../supernote/markerStrokeRead';
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
import {buildResizedTextboxRect, getFontWarning, resetFontWarnings} from '../supernote/textboxMetrics';
import {logEditMarker, markerDiagnostics} from '../utils/editMarkerLog';
import {
  analyzeDeleteMarker,
  findReplacementLinesForTextbox,
  type MarkerCandidate,
} from './editMarkerAnalysis';

/**
 * Edit marker flow.
 *
 * This module runs the full marker lifecycle:
 * - load lasso or full-page context
 * - recognize delete and replace markers
 * - resolve typed replacement lines
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
  const fileName = `textboxhelper-marker-diagnostics-${createdAt.replace(/[:.]/g, '-')}.json`;
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
 * Builds the edit-marker preview and adds a warning to its summary when a textbox font couldn't be
 * read, because then word positions were measured in a standard font (`src/domain/fontPaths.ts`).
 */
export async function getEditMarkerPreview(
  previewScope: EditMarkerPreviewScope = 'lasso',
): Promise<EditMarkerPreview> {
  resetFontWarnings();
  const preview = await buildEditMarkerPreview(previewScope);
  const fontWarning = getFontWarning();
  if (!fontWarning) {
    return preview;
  }
  logEditMarker('fontWarning', {fontWarning});
  return {...preview, summaryMessage: appendFontWarning(preview.summaryMessage, fontWarning)};
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

    const selectedMarkers = effectiveSelection.filter(isSupportedEditMarkerElement);
    const selectedTextboxes = sortTextElements(effectiveSelection.filter(isNormalTextElement));
    logEditMarker('previewContext', {
      page: context.page,
      pageSize: await readPageSizeForDiagnostics(context.notePath, context.page),
      lassoElementCount: lassoElements.length,
      pageElementCount: pageElements.length,
      elementTypes: countElementTypes(effectiveSelection),
      selectedMarkerCount: selectedMarkers.length,
      selectedTextboxCount: selectedTextboxes.length,
    });

    if (effectiveSelection.length === 0) {
      return createEmptyPreview();
    }

    if (selectedMarkers.length === 0) {
      return {
        ...createEmptyPreview(0, selectedTextboxes.length),
        summaryMessage: 'Select one or more handwritten edit markers.',
        beforePreviewBlocks: selectedTextboxes.map(textbox => ({
          id: textbox.uuid,
          text: textbox.textBox.textContentFull || '',
          highlightRanges: [],
        })),
        afterPreviewBlocks: selectedTextboxes.map(textbox => ({
          id: textbox.uuid,
          text: textbox.textBox.textContentFull || '',
          highlightRanges: [],
        })),
        beforeBlocks: selectedTextboxes.map(textbox => textbox.textBox.textContentFull || ''),
        afterBlocks: selectedTextboxes.map(textbox => textbox.textBox.textContentFull || ''),
      };
    }

    const pageTextboxes = pageElements.filter(isNormalTextElement);
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
    ).filter((analysis): analysis is MarkerStrokeAnalysis<Element> => !!analysis);

    const strokeStatsByUuid = new Map(
      strokeAnalyses.map(analysis => [analysis.marker.uuid, analysis.strokeStats]),
    );

    const candidateResults = await Promise.all(
      selectedMarkers.map(marker =>
        analyzeDeleteMarker(
          marker,
          pageTextboxes,
          currentEditMarkerCalibration,
          strokeStatsByUuid.get(marker.uuid),
        ),
      ),
    );

    const markerCandidates = candidateResults
      .map(result => result.candidate)
      .filter((candidate): candidate is MarkerCandidate => !!candidate)
      .sort((left, right) => {
        if (Math.abs(left.markerSortTop - right.markerSortTop) > 1) {
          return left.markerSortTop - right.markerSortTop;
        }

        return left.markerSortLeft - right.markerSortLeft;
      });

    const ignoredMarkers = candidateResults
      .map(result => result.ignored)
      .filter((ignored): ignored is IgnoredEditMarker => !!ignored);

    const usedRangesByTextbox = new Map<string, Set<string>>();
    const operations: RecognizedEditOperation[] = [];
    const groupedWords = new Map<string, WordCandidate[]>();
    const groupedTextboxes = new Map<string, TextElement>();
    const groupedRanges = new Map<string, TextMutationRange[]>();
    const replacementSourceTextboxNums = new Set<number>();

    const targetTextboxesByOrder = sortTextElements(
      [
        ...new Map(
          markerCandidates.map(candidate => [candidate.targetTextbox.uuid, candidate.targetTextbox]),
        ).values(),
      ],
    );

    const replaceCandidateInfoByMarkerUuid = new Map<
      string,
      {
        pair: MarkerStrokeAnalysis<Element>[];
        replacementText?: string;
        replacementSourceTextboxNum?: number;
        mismatchReason?: string;
      }
    >();

    targetTextboxesByOrder.forEach(targetTextbox => {
      const textboxCandidates = orderTextboxMarkerCandidates(
        markerCandidates.filter(candidate => candidate.targetTextbox.uuid === targetTextbox.uuid),
      );
      const usedModifierMarkerUuids = new Set<string>();
      const replaceCandidates = textboxCandidates
        .map(candidate => ({
          candidate,
          pair: findBestReplaceModifierPair(candidate, strokeAnalyses),
        }))
        .filter(entry => {
          if (
            entry.pair.length !== 2 ||
            entry.pair.some(pairEntry => usedModifierMarkerUuids.has(pairEntry.marker.uuid))
          ) {
            return false;
          }

          entry.pair.forEach(pairEntry => {
            usedModifierMarkerUuids.add(pairEntry.marker.uuid);
          });
          return true;
        });

      if (replaceCandidates.length === 0) {
        return;
      }

      const replacementLines = findReplacementLinesForTextbox(
        targetTextbox,
        replaceCandidates.length,
        selectedTextboxes,
        targetTextboxesByOrder,
      );

      if (replacementLines.length !== replaceCandidates.length) {
        const mismatchReason =
          replacementLines.length === 0
            ? 'Replace markers were found, but no matching replacement lines starting with "#" were found below the paragraph.'
            : `Replace markers were found, but ${replaceCandidates.length} marker(s) need ${replaceCandidates.length} replacement line(s) and only ${replacementLines.length} were found.`;

        replaceCandidates.forEach(entry => {
          replaceCandidateInfoByMarkerUuid.set(entry.candidate.markerUuid, {
            pair: entry.pair,
            mismatchReason,
          });
        });

        logEditMarker('replaceResolutionMismatch', {
          targetTextbox: buildTextboxLogSummary(targetTextbox),
          replaceMarkerCount: replaceCandidates.length,
          replacementLineCount: replacementLines.length,
          replacementLines: replacementLines.map(buildReplacementLineLogSummary),
          reason: mismatchReason,
        });
        return;
      }

      replaceCandidates.forEach((entry, index) => {
        replaceCandidateInfoByMarkerUuid.set(entry.candidate.markerUuid, {
          pair: entry.pair,
          replacementText: replacementLines[index].text,
          replacementSourceTextboxNum: replacementLines[index].sourceTextboxNumInPage,
        });
      });

      logEditMarker('replaceResolutionMatched', {
        targetTextbox: buildTextboxLogSummary(targetTextbox),
        replaceMarkers: replaceCandidates.map(entry => ({
          markerUuid: entry.candidate.markerUuid,
          markerNumInPage: entry.candidate.markerNumInPage,
          modifierMarkerNums: entry.pair.map(pairEntry => pairEntry.marker.numInPage),
        })),
        replacementLines: replacementLines.map(buildReplacementLineLogSummary),
      });
    });

    markerCandidates.forEach(candidate => {
      const replaceInfo = replaceCandidateInfoByMarkerUuid.get(candidate.markerUuid);
      if (replaceInfo?.mismatchReason) {
        ignoredMarkers.push(
          buildIgnoredMarker(candidate.marker, replaceInfo.mismatchReason),
        );
        return;
      }

      const textboxUuid = candidate.targetTextbox.uuid;
      const usedRanges = usedRangesByTextbox.get(textboxUuid) || new Set<string>();
      const nextWords = candidate.words.filter(word => !usedRanges.has(`${word.start}-${word.end}`));

      if (nextWords.length === 0) {
        ignoredMarkers.push(
          buildIgnoredMarker(
            {
              ...candidate.targetTextbox,
              uuid: candidate.markerUuid,
              numInPage: candidate.markerNumInPage,
            } as Element,
            'This marker duplicates text already covered by another recognized marker.',
          ),
        );
        return;
      }

      nextWords.forEach(word => {
        usedRanges.add(`${word.start}-${word.end}`);
      });

      usedRangesByTextbox.set(textboxUuid, usedRanges);
      groupedTextboxes.set(textboxUuid, candidate.targetTextbox);
      groupedWords.set(textboxUuid, [...(groupedWords.get(textboxUuid) || []), ...nextWords]);

      const wordTexts = nextWords.map(word => word.text);
      const kind: EditMarkerOperationKind = replaceInfo?.replacementText ? 'replace' : 'delete';
      if (replaceInfo?.replacementSourceTextboxNum !== undefined) {
        replacementSourceTextboxNums.add(replaceInfo.replacementSourceTextboxNum);
      }
      groupedRanges.set(textboxUuid, [
        ...(groupedRanges.get(textboxUuid) || []),
        {
          kind,
          start: nextWords[0].start,
          end: nextWords[nextWords.length - 1].end,
          replacementText: replaceInfo?.replacementText,
        },
      ]);
      operations.push({
        id: `${candidate.markerUuid}:${candidate.targetTextbox.uuid}`,
        kind,
        markerUuid: candidate.markerUuid,
        markerNumInPage: candidate.markerNumInPage,
        consumedMarkerNums: [
          candidate.markerNumInPage,
          ...(replaceInfo?.pair.map(pairEntry => pairEntry.marker.numInPage) || []),
        ],
        targetTextboxUuid: candidate.targetTextbox.uuid,
        targetTextboxNumInPage: candidate.targetTextbox.numInPage,
        lineIndex: candidate.lineIndex,
        summary: formatOperationSnippet(kind, wordTexts, replaceInfo?.replacementText),
        detail: buildOperationDetailWithReplacement(
          candidate.targetTextbox,
          candidate.lineIndex,
          nextWords,
          replaceInfo?.replacementText,
        ),
        words: wordTexts,
        replacementText: replaceInfo?.replacementText,
      });
    });

    const mutationTargets = sortTextElements([...groupedTextboxes.values()]);
    const textMutations: TextMutationPlan[] = (
      await Promise.all(mutationTargets.map(async textbox => {
        const originalText = textbox.textBox.textContentFull || '';
        const nextText = applyTextMutationRanges(
          originalText,
          groupedRanges.get(textbox.uuid) || [],
        );

        if (nextText === originalText) {
          return null;
        }

        return {
          uuid: textbox.uuid,
          numInPage: textbox.numInPage,
          layerNum: textbox.layerNum,
          originalText,
          nextText,
          textRect: cloneRect(textbox.textBox.textRect),
          nextTextRect: await buildResizedTextboxRect(
            textbox.textBox.textRect,
            nextText,
            textbox.textBox.fontSize || DEFAULT_FONT_SIZE,
            textbox.textBox.fontPath || undefined,
            currentEditMarkerCalibration,
          ),
          fontSize: textbox.textBox.fontSize || DEFAULT_FONT_SIZE,
          fontPath: textbox.textBox.fontPath,
          textAlign: textbox.textBox.textAlign ?? 0,
          textBold: textbox.textBox.textBold ?? 0,
          textItalics: textbox.textBox.textItalics ?? 0,
          textFrameWidthType: textbox.textBox.textFrameWidthType ?? 0,
          textFrameStyle: textbox.textBox.textFrameStyle ?? 0,
          textEditable: textbox.textBox.textEditable ?? 0,
        };
      }))
    ).filter((mutation): mutation is TextMutationPlan => !!mutation);

    const relevantTextboxes =
      textMutations.length > 0
        ? textMutations
        : selectedTextboxes.map(textbox => ({
            uuid: textbox.uuid,
            numInPage: textbox.numInPage,
            layerNum: textbox.layerNum,
            originalText: textbox.textBox.textContentFull || '',
            nextText: textbox.textBox.textContentFull || '',
            textRect: cloneRect(textbox.textBox.textRect),
            nextTextRect: cloneRect(textbox.textBox.textRect),
            fontSize: textbox.textBox.fontSize || DEFAULT_FONT_SIZE,
            fontPath: textbox.textBox.fontPath,
            textAlign: textbox.textBox.textAlign ?? 0,
            textBold: textbox.textBox.textBold ?? 0,
            textItalics: textbox.textBox.textItalics ?? 0,
            textFrameWidthType: textbox.textBox.textFrameWidthType ?? 0,
            textFrameStyle: textbox.textBox.textFrameStyle ?? 0,
            textEditable: textbox.textBox.textEditable ?? 0,
          }));

    const beforePreviewBlocks = relevantTextboxes.map(textbox => ({
      id: textbox.uuid,
      text: textbox.originalText,
      highlightRanges: mergeHighlightRanges(
        (groupedWords.get(textbox.uuid) || []).map(word => ({
          start: word.start,
          end: word.end,
        })),
      ),
    }));
    const afterPreviewBlocks = relevantTextboxes.map(textbox => {
      const detailedMutation = applyTextMutationRangesDetailed(
        textbox.originalText,
        groupedRanges.get(textbox.uuid) || [],
      );

      return {
        id: textbox.uuid,
        text: detailedMutation.text,
        highlightRanges: detailedMutation.insertedRanges,
      };
    });

    const recognizedMarkerNums = [
      ...new Set(operations.flatMap(operation => operation.consumedMarkerNums)),
    ];
    const recognizedMarkerNumSet = new Set(recognizedMarkerNums);
    const visibleIgnoredMarkers = ignoredMarkers.filter(
      marker => !recognizedMarkerNumSet.has(marker.markerNumInPage),
    );
    const applyPlan =
      operations.length > 0 && textMutations.length > 0
        ? {
            notePath: context.notePath,
            page: context.page,
            selectedMarkerCount: selectedMarkers.length,
            operations,
            recognizedMarkerNums,
            replacementSourceTextboxNums: [...replacementSourceTextboxNums],
            textMutations,
          }
        : null;

    logEditMarker('previewResult', {
      selectedMarkerCount: selectedMarkers.length,
      recognizedOperationCount: operations.length,
      ignoredMarkerCount: visibleIgnoredMarkers.length,
      ignoredReasons: visibleIgnoredMarkers.map(marker => marker.reason),
    });

    return {
      selectedMarkerCount: selectedMarkers.length,
      selectedTextboxCount: selectedTextboxes.length,
      recognizedOperationCount: operations.length,
      selectionMessage: buildSelectionMessage(selectedMarkers.length, selectedTextboxes.length),
      summaryMessage: buildSummaryMessage(
        operations.length,
        visibleIgnoredMarkers.length,
        selectedMarkers.length,
      ),
      beforePreviewBlocks,
      afterPreviewBlocks,
      beforeBlocks: relevantTextboxes.map(textbox => textbox.originalText),
      afterBlocks: relevantTextboxes.map(textbox => textbox.nextText),
      operations,
      ignoredMarkers: visibleIgnoredMarkers,
      canApply: !!applyPlan,
      applyPlan,
    };
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
      pageElements.filter(isNormalTextElement).map(element => [element.numInPage, element]),
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

    reportProgress(options, 'Creating backup...', true);
    const backupPayload = createEditMarkerBackupPayload(plan);
    const {backupPath, clipboardSummary} = await writeBackupFile(backupPayload);

    reportProgress(options, 'Saving current note...', false);
    await saveCurrentNoteForConsistency('applying edit markers');

    reportProgress(options, 'Applying recognized markers...', false);
    const currentTextboxesByNum = new Map(
      pageElements.filter(isNormalTextElement).map(element => [element.numInPage, element]),
    );
    const modifiedTextboxes = plan.textMutations
      .filter(mutation => mutation.nextText.length > 0)
      .map(mutation => {
        const currentTextbox = currentTextboxesByNum.get(mutation.numInPage);
        if (!currentTextbox) {
          throw new Error(
            `Textbox ${mutation.numInPage} is no longer available. Refresh the preview and try again.`,
          );
        }

        return cloneTextElementForMutation(currentTextbox, mutation);
      });
    const emptyTargetTextboxNums = plan.textMutations
      .filter(mutation => mutation.nextText.length === 0)
      .map(mutation => mutation.numInPage);

    await modifyPageElements(plan.notePath, plan.page, modifiedTextboxes);
    await deletePageElements(plan.notePath, plan.page, [
      ...plan.recognizedMarkerNums,
      ...plan.replacementSourceTextboxNums,
      ...emptyTargetTextboxNums,
    ]);

    await hideLassoBox('[EditMarkerActions]');

    return {
      message: `Applied ${plan.operations.length} recognized edit operations and removed ${plan.recognizedMarkerNums.length} marker(s).`,
      backupPath,
      clipboardSummary,
      appliedOperationCount: plan.operations.length,
      removedMarkerCount: plan.recognizedMarkerNums.length,
      affectedTextboxCount: plan.textMutations.length,
    };
  } finally {
    await recycleElements(pageElements);
  }
}
