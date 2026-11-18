import type {Element, TextBox} from 'sn-plugin-lib';
import {createEditMarkerBackupPayload} from '../domain/backupPayload';
import {NOTE_SYSTEM_FONT_PATH} from '../domain/fontPaths';
import {assembleMarkerPreview} from '../domain/markerAssembly';
import {plural} from '../domain/plural';
import {cloneRect} from '../domain/geometry';
import {
  buildRecognizeRect,
  findBestReplaceModifierPair,
  isSupportedEditMarkerElement,
  orderTextboxMarkerCandidates,
} from '../domain/markerStrokes';
import {
  buildIgnoredMarker,
  buildOperationDetailWithReplacement,
  buildReplacementLineLogSummary,
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
import {DEFAULT_FONT_SIZE} from '../domain/textboxModel';
import {parsePenEditUserData} from '../domain/penEditTags';
import {buildTextInsert, isNormalTextElement, sortTextElements} from '../domain/textboxEditPlan';
import {writeBackupFile} from '../storage/backupFile';
import {writeJsonExportFile} from '../storage/exportFile';
import {loadMarkerStrokeStats} from '../supernote/markerStrokeRead';
import {
  deletePageElements,
  getPreviewContext,
  hideLassoBox,
  insertTextboxElement,
  modifyPageElements,
  readPageElements,
  readPageSizeForDiagnostics,
  recycleElements,
  saveCurrentNoteForConsistency,
} from '../supernote/noteElements';
import {
  buildResizedTextboxRect,
  estimateTextboxHeight,
  getFontWarning,
  resetFontWarnings,
} from '../supernote/textboxMetrics';
import {logEditMarker, markerDiagnostics} from '../utils/editMarkerLog';
import {
  analyzeDeleteMarker,
  findReplacementLinesForTextbox,
  type MarkerCandidate,
} from './editMarkerAnalysis';
import {
  loadPenEditContext,
  markPenEditsApplied,
  penEditBackupData,
  penEditElementNums,
  placeInsertions,
} from './penEditReview';

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
  return {...preview, fontWarning};
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
    const pen = await loadPenEditContext(pageElements, previewScope === 'lasso' ? lassoElements : null);

    // Tagged snippets' handwriting and Textbox Tools' own badges and numbers are never markers.
    const selectedMarkers = effectiveSelection.filter(
      element => isSupportedEditMarkerElement(element) && !pen.isExcluded(element),
    );
    const selectedTextboxes = sortTextElements(effectiveSelection.filter(isNormalTextElement));
    logEditMarker('previewContext', {
      page: context.page,
      pageSize: await readPageSizeForDiagnostics(context.notePath, context.page),
      lassoElementCount: lassoElements.length,
      pageElementCount: pageElements.length,
      elementTypes: countElementTypes(effectiveSelection),
      selectedMarkerCount: selectedMarkers.length,
      selectedTextboxCount: selectedTextboxes.length,
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
    const groupedTextboxes = new Map<string, TextElement>();
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
        penEdit?: PenEditEntry;
      }
    >();
    const pairedPenEditIds = new Set<string>();

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

      // A replace mark with a tagged snippet takes its text from the snippet; the others look for
      // typed "#" lines as before.
      const typedReplaceCandidates = replaceCandidates.filter(entry => {
        const penEdit = pen.strikeOwner(entry.candidate.marker);
        if (!penEdit) {
          return true;
        }
        pairedPenEditIds.add(penEdit.id);
        replaceCandidateInfoByMarkerUuid.set(entry.candidate.markerUuid, {pair: entry.pair, penEdit});
        return false;
      });

      if (typedReplaceCandidates.length === 0) {
        return;
      }

      const replacementLines = findReplacementLinesForTextbox(
        targetTextbox,
        typedReplaceCandidates.length,
        selectedTextboxes,
        targetTextboxesByOrder,
      );

      if (replacementLines.length !== typedReplaceCandidates.length) {
        const mismatchReason =
          replacementLines.length === 0
            ? 'Replace mark without new text: tag the new words with "Replacement" right after the mark, or write them below the paragraph in a line starting with #.'
            : `Replace markers were found, but ${typedReplaceCandidates.length} marker(s) need ${typedReplaceCandidates.length} replacement line(s) and only ${replacementLines.length} were found.`;

        typedReplaceCandidates.forEach(entry => {
          replaceCandidateInfoByMarkerUuid.set(entry.candidate.markerUuid, {
            pair: entry.pair,
            mismatchReason,
          });
        });

        logEditMarker('replaceResolutionMismatch', {
          targetTextbox: buildTextboxLogSummary(targetTextbox),
          replaceMarkerCount: typedReplaceCandidates.length,
          replacementLineCount: replacementLines.length,
          replacementLines: replacementLines.map(buildReplacementLineLogSummary),
          reason: mismatchReason,
        });
        return;
      }

      typedReplaceCandidates.forEach((entry, index) => {
        replaceCandidateInfoByMarkerUuid.set(entry.candidate.markerUuid, {
          pair: entry.pair,
          replacementText: replacementLines[index].text,
          replacementSourceTextboxNum: replacementLines[index].sourceTextboxNumInPage,
        });
      });

      logEditMarker('replaceResolutionMatched', {
        targetTextbox: buildTextboxLogSummary(targetTextbox),
        replaceMarkers: typedReplaceCandidates.map(entry => ({
          markerUuid: entry.candidate.markerUuid,
          markerNumInPage: entry.candidate.markerNumInPage,
          modifierMarkerNums: entry.pair.map(pairEntry => pairEntry.marker.numInPage),
        })),
        replacementLines: replacementLines.map(buildReplacementLineLogSummary),
      });
    });

    const drafts: OperationDraft[] = [];
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

      const wordTexts = nextWords.map(word => word.text);
      const penEdit = replaceInfo?.penEdit;
      const kind: EditMarkerOperationKind = penEdit || replaceInfo?.replacementText ? 'replace' : 'delete';
      if (replaceInfo?.replacementSourceTextboxNum !== undefined) {
        replacementSourceTextboxNums.add(replaceInfo.replacementSourceTextboxNum);
      }
      drafts.push({
        range: {
          kind,
          start: nextWords[0].start,
          end: nextWords[nextWords.length - 1].end,
          replacementText: replaceInfo?.replacementText,
        },
        operation: {
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
          textStart: nextWords[0].start,
          ...(penEdit ? {penEditId: penEdit.id, penEditNumber: penEdit.number} : {}),
        },
      });
    });

    // Tagged replacements whose mark wasn't recognized on the page.
    pen.entries
      .filter(entry => entry.kind === 'replacement' && !pairedPenEditIds.has(entry.id))
      .forEach(entry => {
        ignoredMarkers.push({
          markerUuid: entry.id,
          markerNumInPage: 0,
          summary: `Replacement ${entry.number}`,
          reason: entry.mark
            ? 'Its replace mark was not recognized on the page (erased, or not over a textbox).'
            : 'No replace mark was found just before it when it was tagged.',
          penEditNumber: entry.number,
          penEditId: entry.id,
        });
      });
    const placed = placeInsertions(pen.entries, pen.snippetRects, pageTextboxes);
    placed.unplaced.forEach(entry => {
      ignoredMarkers.push({
        markerUuid: entry.id,
        markerNumInPage: 0,
        summary: `Insertion ${entry.number}`,
        reason: 'No textbox above or below it in the same column to take the place and style from.',
        penEditNumber: entry.number,
        penEditId: entry.id,
      });
    });

    const textboxBases: MarkerTextboxBase[] = sortTextElements([...groupedTextboxes.values()]).map(textbox => ({
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
      replacementSourceTextboxNums: [...replacementSourceTextboxNums],
      insertions: placed.drafts,
      penEdits: pen.views.filter(view => pairedPenEditIds.has(view.id) || placed.drafts.some(d => d.penEditId === view.id)),
      penStates: pen.states,
    };
    const preview = assembleMarkerPreview(base, pen.states);

    logEditMarker('previewResult', {
      selectedMarkerCount: selectedMarkers.length,
      recognizedOperationCount: preview.operations.length,
      penEdits: pen.entries.map(entry => ({id: entry.id, kind: entry.kind, number: entry.number, paired: pairedPenEditIds.has(entry.id)})),
      ignoredMarkerCount: preview.ignoredMarkers.length,
      ignoredReasons: preview.ignoredMarkers.map(marker => marker.reason),
    });

    return pen.warning ? {...preview, fontWarning: pen.warning} : preview;
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

    // The new heights are measured now, once the pen edits' text is final.
    const textMutations: TextMutationPlan[] = await Promise.all(
      plan.textMutations.map(async mutation => ({
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
    const penBackup = plan.penEditIds.length > 0 ? await penEditBackupData(plan.penEditIds) : null;
    const backupPayload = {
      ...createEditMarkerBackupPayload({...plan, textMutations}),
      ...(penBackup ? {penEdits: penBackup} : {}),
    };
    const {backupPath, clipboardSummary} = await writeBackupFile(backupPayload);

    reportProgress(options, 'Saving current note...', false);
    await saveCurrentNoteForConsistency('applying edit markers');

    reportProgress(options, 'Applying recognized markers...', false);
    const modifiedTextboxes = textMutations
      .filter(mutation => mutation.nextText.length > 0)
      .map(mutation => {
        const currentTextbox = pageTextboxByNum.get(mutation.numInPage);
        if (!currentTextbox) {
          throw new Error(
            `Textbox ${mutation.numInPage} is no longer available. Refresh the preview and try again.`,
          );
        }

        return cloneTextElementForMutation(currentTextbox, mutation);
      });
    const emptyTargetTextboxNums = textMutations
      .filter(mutation => mutation.nextText.length === 0)
      .map(mutation => mutation.numInPage);
    const penEditNums = penEditElementNums(plan.penEditIds, penBackup?.entries ?? [], pageElements);

    await modifyPageElements(plan.notePath, plan.page, modifiedTextboxes);
    await deletePageElements(plan.notePath, plan.page, [
      ...plan.recognizedMarkerNums,
      ...plan.replacementSourceTextboxNums,
      ...emptyTargetTextboxNums,
      ...penEditNums,
    ]);

    // New textboxes last: inserting may renumber the page's elements.
    const overlaps: string[] = [];
    for (const insertion of plan.insertions) {
      reportProgress(options, 'Inserting new paragraphs...', false);
      const fontSize = insertion.style.fontSize || DEFAULT_FONT_SIZE;
      // A neighbour without a font gets NOTE's system font, as NOTE itself writes it.
      const style = {...insertion.style, fontPath: insertion.style.fontPath || NOTE_SYSTEM_FONT_PATH};
      const height = await estimateTextboxHeight(
        insertion.text,
        insertion.width,
        fontSize,
        style.fontPath,
        currentEditMarkerCalibration,
      );
      const rect = {
        left: insertion.left,
        top: insertion.top,
        right: insertion.left + insertion.width,
        bottom: insertion.top + height,
      };
      await insertTextboxElement(buildTextInsert(style, insertion.text, rect));
      const overlap = insertion.belowTop === null ? 0 : Math.max(0, Math.round(rect.bottom - insertion.belowTop));
      if (overlap > 0) {
        overlaps.push(`${overlap} px`);
      }
    }

    try {
      await markPenEditsApplied(plan.penEditIds);
    } catch (error) {
      console.warn('[EditMarkerActions] pen edits not marked applied', String(error));
    }

    await hideLassoBox('[EditMarkerActions]');

    const overlapNote =
      overlaps.length > 0
        ? ` A new paragraph overlaps the next one (${overlaps.join(', ')}); move it with the lasso.`
        : '';
    const left = preview.pendingCount + preview.skippedCount;
    const leftNote = left > 0 ? ` ${plural(left, 'pen edit')} left for later.` : '';
    return {
      message: `Applied ${plural(plan.operations.length, 'change')} and removed ${plural(plan.recognizedMarkerNums.length, 'marker')}.${leftNote}${overlapNote}`,
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
