import {buildHunk, buildSwapHunk} from './markerHunks';
import {applyTextMutationRanges, formatOperationSnippet} from './markerText';
import type {
  ChangeHunk,
  EditMarkerApplyPlan,
  EditMarkerPreview,
  EdgePoint,
  EdgeView,
  InsertionPlan,
  MarkerPreviewBase,
  PenOperationStatus,
  PenTextState,
  RecognizedEditOperation,
  SwapInfo,
  TextMutationPlan,
  TextMutationRange,
} from './markerTypes';
import {cloneRect} from './geometry';
import {caretInsertionText} from './penEditCaret';
import {edgeContext, insertModeAt, shiftSpans, shiftSwapZones, type EdgeShift} from './edgeShift';
import {
  SPLIT_SHOWN,
  SPLIT_SIGN,
  showSplits,
  splitChangeText,
} from './paragraphMarks';
import {composeSwap, swapSummary, type ChangeNearSwap} from './swapText';
import type {IgnoredEditMarker} from './markerTypes';

/**
 * The edit-marker preview assembled from the analysis and the pen edits' current text
 * (technical-design-pen-edits.md §3.6). The analysis (reading the page, measuring words) runs
 * once; this runs again whenever a recognition finishes or the user skips or corrects one, so the
 * review updates without measuring again.
 *
 * Only ready changes go into the apply plan. A pen edit still recognizing or without text stays
 * on the page for a later pass, and its marks are not removed.
 */

export type {PenTextState};

export function penOperationStatus(
  state: PenTextState | undefined,
): PenOperationStatus {
  if (!state) {
    return 'recognizing';
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
    default:
      return `‹${what} has no text - Correct›`;
  }
}

const edgeAt = (original: string, label: string, offset: number): EdgePoint => ({
  label,
  ...edgeContext(original, offset),
});

/** The text around [start, end) with `inserted` in its place, as the change will read. */
function resultLine(original: string, start: number, end: number, inserted: string): string {
  const around = 24;
  const head = original.slice(Math.max(0, start - around), start);
  const tail = original.slice(end, end + around);
  return `${start - around > 0 ? '…' : ''}${head}${inserted}${tail}${
    end + around < original.length ? '…' : ''
  }`.replace(/\n/g, ' ¶ ');
}

/** A change's edges (one Place, or Start and End) and how it reads. */
function edgeViewOf(
  original: string,
  start: number,
  end: number,
  zeroLength: boolean,
  inserted: string,
): EdgeView {
  return {
    edges: zeroLength
      ? [edgeAt(original, 'Place', start)]
      : [edgeAt(original, 'Start', start), edgeAt(original, 'End', end)],
    result: resultLine(original, start, end, inserted),
  };
}

/**
 * Every change's range after the user's edge nudges (technical-design-pen-edits-2.md §6): a pen
 * edit's stored with it, a plain mark's in `plainShifts` (kept while the review is open). Ranges
 * of one textbox are moved together so none runs into another.
 */
function shiftedRanges(
  base: MarkerPreviewBase,
  penStates: Record<string, PenTextState>,
  plainShifts: Record<string, EdgeShift>,
): Map<string, {start: number; end: number}> {
  const result = new Map<string, {start: number; end: number}>();
  const byTextbox = new Map<string, MarkerPreviewBase['drafts']>();
  for (const draft of base.drafts) {
    const uuid = draft.operation.targetTextboxUuid;
    byTextbox.set(uuid, [...(byTextbox.get(uuid) ?? []), draft]);
  }
  for (const textbox of base.textboxes) {
    // A swap keeps its place; the changes inside it are made first (swapText.ts).
    const drafts = (byTextbox.get(textbox.uuid) ?? []).filter(
      draft => draft.operation.kind !== 'swap',
    );
    const spans = shiftSpans(
      textbox.originalText.length,
      drafts.map(({operation, range}) => ({
        start: range.start,
        end: range.end,
        zeroLength: isZeroLengthKind(operation.kind),
        shift: operation.penEditId
          ? penStates[operation.penEditId]?.edges
          : plainShifts[operation.id],
      })),
    );
    drafts.forEach(({operation}, index) => result.set(operation.id, spans[index]));
  }
  return result;
}

function isZeroLengthKind(kind: RecognizedEditOperation['kind']): boolean {
  return kind === 'insert' || kind === 'split' || kind === 'space';
}

/** A change's range with the operation it belongs to, so a swap can take the ones inside it. */
type TaggedRange = TextMutationRange & {opId: string};

/** The user's choices for swaps while the review is open: "Fix capitals", by operation id. */
export type SwapOptions = Record<string, {fixCase: boolean}>;

export function assembleMarkerPreview(
  base: MarkerPreviewBase,
  penStates: Record<string, PenTextState>,
  fontWarning: string | null = null,
  plainShifts: Record<string, EdgeShift> = {},
  swapOptions: SwapOptions = {},
): EditMarkerPreview {
  const operations: RecognizedEditOperation[] = [];
  const displayRanges = new Map<string, TaggedRange[]>();
  const applyRanges = new Map<string, TaggedRange[]>();
  const swapDrafts: MarkerPreviewBase['drafts'] = [];
  const swapIgnored: IgnoredEditMarker[] = [];
  const readyOperations: RecognizedEditOperation[] = [];
  const readyPenIds: string[] = [];
  let pendingCount = 0;
  // What the review shows of each change, for its hunk (the swap's composed range included).
  const shownByOp = new Map<string, TextMutationRange[]>();

  let currentOpId = '';
  const add = (
    map: Map<string, TaggedRange[]>,
    uuid: string,
    range: TextMutationRange,
  ) => {
    map.set(uuid, [...(map.get(uuid) ?? []), {...range, opId: currentOpId}]);
    if (map === displayRanges) {
      shownByOp.set(currentOpId, [...(shownByOp.get(currentOpId) ?? []), range]);
    }
  };

  const originalTextOf = new Map(
    base.textboxes.map(textbox => [textbox.uuid, textbox.originalText]),
  );

  const shifted = shiftedRanges(base, penStates, plainShifts);

  for (const draft of base.drafts) {
    if (draft.operation.kind === 'swap') {
      swapDrafts.push(draft);
      continue;
    }
    currentOpId = draft.operation.id;
    const uuid = draft.operation.targetTextboxUuid;
    const original = originalTextOf.get(uuid) ?? '';
    const range: TextMutationRange = {
      ...draft.range,
      ...(shifted.get(draft.operation.id) ?? {}),
    };
    const zeroLength = isZeroLengthKind(draft.operation.kind);
    const view = (inserted: string) =>
      edgeViewOf(original, range.start, range.end, zeroLength, inserted);
    const operation: RecognizedEditOperation = {
      ...draft.operation,
      textStart: range.start,
      ...(draft.operation.insertMode
        ? {insertMode: insertModeAt(original, range.start, draft.operation.insertMode)}
        : {}),
    };
    if (operation.penEditId && operation.kind === 'insert') {
      // An insertion at a caret: the text goes in at the caret, with the spaces it needs.
      const state = penStates[operation.penEditId];
      const status = penOperationStatus(state);
      const number = operation.penEditNumber ?? 0;
      const text = status === 'ready' ? penTextOf(state) : '';
      const joined = text
        ? caretInsertionText(
            original,
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
        edgeView: view(joined ? showSplits(joined) : ` ${shown} `),
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
        pendingCount += 1;
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
      const assembled = {...operation, edgeView: view('\n')};
      operations.push(assembled);
      readyOperations.push(assembled);
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
      const assembled = {
        ...operation,
        edgeView: view(range.replacementText ?? ''),
      };
      operations.push(assembled);
      readyOperations.push(assembled);
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
      edgeView: view(text || shown),
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
      pendingCount += 1;
      add(displayRanges, uuid, {
        ...range,
        kind: 'replace',
        replacementText: shown,
        pending: true,
      });
    }
  }

  // Swaps: the changes inside each part first, then the parts change places (§6.2). Their three
  // edges move with the user's nudges (technical-design-manuscript.md §4.4).
  const insideSwap = new Map<string, string>();
  const swapHunks = new Map<string, ChangeHunk>();
  const swapZones = new Map(
    swapDrafts
      .filter(({operation}) => operation.swap)
      .map(({operation}) => [
        operation.id,
        shiftSwapZones(
          (operation.swap as SwapInfo).zones,
          plainShifts[operation.id],
          (originalTextOf.get(operation.targetTextboxUuid) ?? '').length,
        ),
      ]),
  );
  for (const {operation} of swapDrafts) {
    const info = operation.swap;
    const uuid = operation.targetTextboxUuid;
    const original = originalTextOf.get(uuid) ?? '';
    if (!info) {
      continue;
    }
    const zones = swapZones.get(operation.id) ?? info.zones;
    const overlapsSwap = swapDrafts.some(({operation: other}) => {
      const otherZones = swapZones.get(other.id);
      return (
        other.id !== operation.id &&
        other.targetTextboxUuid === uuid &&
        !!otherZones &&
        otherZones.a0 < zones.b1 &&
        zones.a0 < otherZones.b1
      );
    });
    const swapEdges: EdgeView = {
      edges: [
        edgeAt(original, 'Start of A', zones.a0),
        edgeAt(original, 'A | B', zones.a1),
        edgeAt(original, 'End of B', zones.b1),
      ],
      result: '',
    };
    const shown = displayRanges.get(uuid) ?? [];
    const applied = applyRanges.get(uuid) ?? [];
    const changes: ChangeNearSwap[] = shown
      .filter(range => !range.opId.startsWith('swap:'))
      .map(range => {
        const ready = applied.find(item => item.opId === range.opId);
        return {
          id: range.opId,
          start: range.start,
          end: range.end,
          text: ready ? (ready.kind === 'replace' ? ready.replacementText ?? '' : '') : '',
          ready: !!ready,
        };
      });
    const fixCase = swapOptions[operation.id]?.fixCase ?? info.fixCase;
    const result = overlapsSwap
      ? ({kind: 'conflict', reason: 'Swaps overlap: draw them one after the other.'} as const)
      : composeSwap(original, zones, changes, fixCase);
    if (result.kind === 'conflict') {
      swapIgnored.push({
        markerUuid: operation.markerUuid,
        markerNumInPage: operation.markerNumInPage,
        summary: operation.summary,
        reason: result.reason,
        removableNums: operation.consumedMarkerNums,
      });
      continue;
    }
    if (result.kind === 'waiting') {
      const waiting: RecognizedEditOperation = {
        ...operation,
        swap: {...info, zones, fixCase, waitingFor: result.waitingIds},
        edgeView: swapEdges,
      };
      operations.push(waiting);
      swapHunks.set(operation.id, buildSwapHunk(waiting, original, zones, null));
      continue;
    }
    const inner = new Set(result.innerIds);
    inner.forEach(id => insideSwap.set(id, operation.id));
    const composed: TaggedRange = {
      kind: 'replace',
      start: zones.a0,
      end: zones.b1,
      replacementText: result.text,
      opId: operation.id,
    };
    displayRanges.set(uuid, [...shown.filter(range => !inner.has(range.opId)), composed]);
    applyRanges.set(uuid, [...applied.filter(range => !inner.has(range.opId)), composed]);
    const assembled: RecognizedEditOperation = {
      ...operation,
      summary: `Swap · ${swapSummary(
        original.slice(zones.a0, zones.a1),
        original.slice(zones.b0, zones.b1),
      )}`,
      replacementText: result.text,
      swap: {...info, zones, fixCase, capsAvailable: result.capsAvailable},
      edgeView: {
        ...swapEdges,
        result: resultLine(original, zones.a0, zones.b1, result.text),
      },
    };
    operations.push(assembled);
    readyOperations.push(assembled);
    swapHunks.set(operation.id, buildSwapHunk(assembled, original, zones, result.text));
  }
  if (insideSwap.size > 0) {
    operations.forEach((operation, index) => {
      const swapId = insideSwap.get(operation.id);
      if (swapId) {
        operations[index] = {...operation, insideSwap: swapId};
      }
    });
  }

  const textMutations: TextMutationPlan[] = [];
  for (const textbox of base.textboxes) {
    if (!displayRanges.has(textbox.uuid)) {
      continue;
    }
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
  const newParagraphs = new Map<string, {order: number; segments: ChangeHunk['segments']}>();
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
    newParagraphs.set(operation.id, {
      order: newParagraphOrder(base, insertion),
      segments: [{text: shown, style: text ? 'inserted' : 'muted'}],
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
    } else {
      pendingCount += 1;
    }
  }

  const shownMarkerNums = new Set(
    operations.flatMap(operation => operation.consumedMarkerNums),
  );
  const ignoredMarkers = [
    ...base.ignored.filter(
      marker =>
        marker.penEditId !== undefined ||
        !shownMarkerNums.has(marker.markerNumInPage),
    ),
    ...swapIgnored,
  ];
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
        operations: readyOperations,
        recognizedMarkerNums,
        textMutations,
        penEditIds: readyPenIds,
        insertions,
      }
    : null;

  // The list in reading order: by textbox (in the order the analysis read them), then by place.
  const textboxOrder = new Map(base.textboxes.map((textbox, index) => [textbox.uuid, index]));
  const hunks = operations
    .map(operation => {
      const paragraph = newParagraphs.get(operation.id);
      if (paragraph) {
        return {
          order: paragraph.order,
          at: 0,
          hunk: {...buildHunk(operation, '', []), segments: paragraph.segments},
        };
      }
      const original = originalTextOf.get(operation.targetTextboxUuid) ?? '';
      const hunk =
        swapHunks.get(operation.id) ??
        buildHunk(operation, original, shownByOp.get(operation.id) ?? []);
      return {
        order: textboxOrder.get(operation.targetTextboxUuid) ?? base.textboxes.length,
        at: operation.swap ? operation.swap.zones.a0 : operation.textStart,
        hunk,
      };
    })
    .sort((left, right) => left.order - right.order || left.at - right.at)
    .map(entry => entry.hunk);

  return {
    hunks,
    fontWarning,
    operations,
    ignoredMarkers,
    canApply: !!applyPlan,
    applyPlan,
    base,
    penEdits: base.penEdits,
    pendingCount,
  };
}

/**
 * Where a new paragraph comes in the list: right after the textbox above it (or before the one
 * below it) when that textbox has changes too, else between the changed textboxes by height.
 */
function newParagraphOrder(base: MarkerPreviewBase, insertion: MarkerPreviewBase['insertions'][number]): number {
  const index = (num: number | null) =>
    num === null ? -1 : base.textboxes.findIndex(textbox => textbox.numInPage === num);
  const above = index(insertion.aboveNumInPage);
  if (above >= 0) {
    return above + 0.5;
  }
  const below = index(insertion.belowNumInPage);
  if (below >= 0) {
    return below - 0.5;
  }
  const y = insertion.aboveRect?.bottom ?? insertion.belowRect?.top ?? Infinity;
  const next = base.textboxes.findIndex(textbox => textbox.textRect.top > y);
  return (next < 0 ? base.textboxes.length : next) - 0.5;
}
