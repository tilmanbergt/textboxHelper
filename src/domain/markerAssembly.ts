import {buildDiffSegments} from './markerDiff';
import {
  applyTextMutationRanges,
  buildSummaryMessage,
  buildSelectionMessage,
  formatOperationSnippet,
} from './markerText';
import type {
  EditMarkerApplyPlan,
  EditMarkerPreview,
  EditMarkerTextboxPreview,
  InsertionPlan,
  MarkerPreviewBase,
  PenOperationStatus,
  PenTextState,
  RecognizedEditOperation,
  TextMutationPlan,
  TextMutationRange,
} from './markerTypes';
import {cloneRect} from './geometry';
import {caretInsertionText} from './penEditCaret';
import {
  SPLIT_SHOWN,
  SPLIT_SIGN,
  showSplits,
  splitChangeText,
} from './paragraphMarks';

/**
 * The edit-marker preview assembled from the analysis and the pen edits' current text
 * (technical-design-pen-edits.md §3.6). The analysis (reading the page, measuring words) runs
 * once; this runs again whenever a recognition finishes or the user skips or corrects one, so the
 * review updates without measuring again.
 *
 * Only ready changes go into the apply plan. A pen edit still recognizing, skipped or without
 * text stays on the page for a later pass, and its marks are not removed.
 */

export type {PenTextState};

export function penOperationStatus(
  state: PenTextState | undefined,
): PenOperationStatus {
  if (!state) {
    return 'recognizing';
  }
  if (state.review === 'skipped') {
    return 'skipped';
  }
  if (state.correctedText !== null) {
    return state.correctedText.trim() ? 'ready' : 'empty';
  }
  switch (state.status) {
    case 'done':
      return state.text.trim() ? 'ready' : 'empty';
    case 'empty':
      return 'empty';
    case 'failed':
      return 'failed';
    default:
      return 'recognizing';
  }
}

export function penTextOf(state: PenTextState | undefined): string {
  if (!state) {
    return '';
  }
  return (state.correctedText ?? state.text).trim();
}

function placeholder(
  kind: 'replacement' | 'insertion',
  number: number,
  status: PenOperationStatus,
): string {
  const what = `${kind} ${number}`;
  switch (status) {
    case 'recognizing':
      return `‹${what} being recognized…›`;
    case 'failed':
      return `‹${what} not recognized - Correct›`;
    case 'empty':
      return `‹${what} has no text - Correct›`;
    default:
      return `‹${what} skipped›`;
  }
}

export function assembleMarkerPreview(
  base: MarkerPreviewBase,
  penStates: Record<string, PenTextState>,
  fontWarning: string | null = null,
): EditMarkerPreview {
  const operations: RecognizedEditOperation[] = [];
  const displayRanges = new Map<string, TextMutationRange[]>();
  const applyRanges = new Map<string, TextMutationRange[]>();
  const readyOperations: RecognizedEditOperation[] = [];
  const readyPenIds: string[] = [];
  let pendingCount = 0;
  let skippedCount = 0;

  const add = (
    map: Map<string, TextMutationRange[]>,
    uuid: string,
    range: TextMutationRange,
  ) => {
    map.set(uuid, [...(map.get(uuid) ?? []), range]);
  };

  const originalTextOf = new Map(
    base.textboxes.map(textbox => [textbox.uuid, textbox.originalText]),
  );

  for (const {operation, range} of base.drafts) {
    const uuid = operation.targetTextboxUuid;
    if (operation.penEditId && operation.kind === 'insert') {
      // An insertion at a caret: the text goes in at the caret, with the spaces it needs.
      const state = penStates[operation.penEditId];
      const status = penOperationStatus(state);
      const number = operation.penEditNumber ?? 0;
      const text = status === 'ready' ? penTextOf(state) : '';
      const joined = text
        ? caretInsertionText(
            originalTextOf.get(uuid) ?? '',
            range.start,
            text,
            operation.insertMode ?? 'betweenWords',
          )
        : '';
      const shown = text || placeholder('insertion', number, status);
      const isParagraph = operation.insertMode === 'paragraph';
      const assembled: RecognizedEditOperation = {
        ...operation,
        penStatus: status,
        replacementText: text || undefined,
        summary: `Insert "${shown}"`,
      };
      operations.push(assembled);
      if (status === 'ready' && joined) {
        readyOperations.push(assembled);
        readyPenIds.push(operation.penEditId);
        add(displayRanges, uuid, {
          ...range,
          kind: 'replace',
          replacementText: showSplits(joined),
        });
        add(applyRanges, uuid, {
          ...range,
          kind: 'replace',
          replacementText: joined,
        });
      } else {
        if (status === 'skipped') {
          skippedCount += 1;
        } else {
          pendingCount += 1;
        }
        const pendingText = isParagraph
          ? showSplits(splitChangeText(shown))
          : ` ${shown} `;
        add(displayRanges, uuid, {
          ...range,
          kind: 'replace',
          replacementText: pendingText,
          pending: true,
        });
      }
      continue;
    }
    if (operation.kind === 'split') {
      // A paragraph break on its own: the split sign, shown as a paragraph end.
      operations.push(operation);
      readyOperations.push(operation);
      add(displayRanges, uuid, {
        ...range,
        kind: 'replace',
        replacementText: SPLIT_SHOWN,
      });
      add(applyRanges, uuid, {
        ...range,
        kind: 'replace',
        replacementText: SPLIT_SIGN,
      });
      continue;
    }
    if (!operation.penEditId) {
      operations.push(operation);
      readyOperations.push(operation);
      add(displayRanges, uuid, range);
      add(applyRanges, uuid, range);
      continue;
    }
    const state = penStates[operation.penEditId];
    const status = penOperationStatus(state);
    const number = operation.penEditNumber ?? 0;
    const text = status === 'ready' ? penTextOf(state) : '';
    const shown = text || placeholder('replacement', number, status);
    const assembled: RecognizedEditOperation = {
      ...operation,
      penStatus: status,
      replacementText: text || undefined,
      summary: formatOperationSnippet('replace', operation.words, shown),
    };
    operations.push(assembled);
    if (status === 'ready') {
      readyOperations.push(assembled);
      readyPenIds.push(operation.penEditId);
      add(displayRanges, uuid, {
        ...range,
        kind: 'replace',
        replacementText: text,
      });
      add(applyRanges, uuid, {
        ...range,
        kind: 'replace',
        replacementText: text,
      });
    } else {
      if (status === 'skipped') {
        skippedCount += 1;
      } else {
        pendingCount += 1;
      }
      add(displayRanges, uuid, {
        ...range,
        kind: 'replace',
        replacementText: shown,
        pending: true,
      });
    }
  }

  const textboxes: EditMarkerTextboxPreview[] = [];
  const textMutations: TextMutationPlan[] = [];
  for (const textbox of base.textboxes) {
    const shownRanges = displayRanges.get(textbox.uuid);
    if (!shownRanges) {
      continue;
    }
    textboxes.push({
      uuid: textbox.uuid,
      numInPage: textbox.numInPage,
      segments: buildDiffSegments(textbox.originalText, shownRanges),
      changeCount: operations.filter(
        operation => operation.targetTextboxUuid === textbox.uuid,
      ).length,
    });
    const nextText = applyTextMutationRanges(
      textbox.originalText,
      applyRanges.get(textbox.uuid) ?? [],
    );
    if (nextText !== textbox.originalText) {
      // The new height is measured when the change is applied.
      textMutations.push({
        ...textbox,
        nextText,
        nextTextRect: cloneRect(textbox.textRect),
      });
    }
  }

  const insertions: InsertionPlan[] = [];
  for (const insertion of base.insertions) {
    const state = penStates[insertion.penEditId];
    const status = penOperationStatus(state);
    const text = status === 'ready' ? penTextOf(state) : '';
    const shown = text || placeholder('insertion', insertion.number, status);
    const uuid = `new:${insertion.penEditId}`;
    const operation: RecognizedEditOperation = {
      id: `insert:${insertion.penEditId}`,
      kind: 'insert',
      markerUuid: insertion.penEditId,
      markerNumInPage: 0,
      consumedMarkerNums: [],
      targetTextboxUuid: uuid,
      targetTextboxNumInPage: insertion.aboveNumInPage ?? 0,
      lineIndex: 0,
      summary: `New paragraph "${shown}"`,
      detail:
        insertion.aboveNumInPage !== null
          ? `After textbox ${insertion.aboveNumInPage}`
          : `Before textbox ${insertion.belowNumInPage ?? ''}`.trim(),
      words: [],
      replacementText: text || undefined,
      textStart: 0,
      penEditId: insertion.penEditId,
      penEditNumber: insertion.number,
      penStatus: status,
    };
    operations.push(operation);
    textboxes.push({
      uuid,
      numInPage: 0,
      title:
        insertion.aboveNumInPage !== null
          ? `New paragraph after textbox ${insertion.aboveNumInPage}`
          : `New paragraph before textbox ${
              insertion.belowNumInPage ?? ''
            }`.trim(),
      segments: [{text: shown, style: text ? 'inserted' : 'muted'}],
      changeCount: 1,
    });
    if (status === 'ready') {
      readyOperations.push(operation);
      readyPenIds.push(insertion.penEditId);
      insertions.push({
        penEditId: insertion.penEditId,
        text,
        left: insertion.left,
        width: insertion.width,
        style: insertion.style,
        aboveRect: insertion.aboveRect,
        belowRect: insertion.belowRect,
      });
    } else if (status === 'skipped') {
      skippedCount += 1;
    } else {
      pendingCount += 1;
    }
  }

  const shownMarkerNums = new Set(
    operations.flatMap(operation => operation.consumedMarkerNums),
  );
  const ignoredMarkers = base.ignored.filter(
    marker =>
      marker.penEditId !== undefined ||
      !shownMarkerNums.has(marker.markerNumInPage),
  );
  const recognizedMarkerNums = [
    ...new Set(
      readyOperations.flatMap(operation => operation.consumedMarkerNums),
    ),
  ];
  const hasWork = textMutations.length > 0 || insertions.length > 0;
  const applyPlan: EditMarkerApplyPlan | null = hasWork
    ? {
        notePath: base.notePath,
        page: base.page,
        selectedMarkerCount: base.selectedMarkerCount,
        operations: readyOperations,
        recognizedMarkerNums,
        replacementSourceTextboxNums: base.replacementSourceTextboxNums,
        textMutations,
        penEditIds: readyPenIds,
        insertions,
      }
    : null;

  return {
    selectedMarkerCount: base.selectedMarkerCount,
    selectedTextboxCount: base.selectedTextboxCount,
    recognizedOperationCount: operations.length,
    selectionMessage: buildSelectionMessage(
      base.selectedMarkerCount,
      base.selectedTextboxCount,
    ),
    summaryMessage: buildSummaryMessage(
      operations.length,
      ignoredMarkers.length,
      Math.max(base.selectedMarkerCount, operations.length),
    ),
    textboxes,
    fontWarning,
    operations,
    ignoredMarkers,
    canApply: !!applyPlan,
    applyPlan,
    base,
    penEdits: base.penEdits,
    pendingCount,
    skippedCount,
  };
}
