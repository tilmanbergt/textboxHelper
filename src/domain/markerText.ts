import {plural} from './plural';
import {cloneRect, rectHeight, rectOverlapHeight} from './geometry';
import type {
  EditMarkerCalibration,
  EditMarkerHighlightRange,
  EditMarkerOperationKind,
  EditMarkerPreview,
  IgnoredEditMarker,
  ReplacementTextLine,
  StrokeStats,
  TextMutationPlan,
  TextMutationRange,
  WordCandidate,
} from './markerTypes';
import {textLeftX, type NativeDetailedLine} from './textboxLayout';
import {
  ELEMENT_TYPE_GEO,
  ELEMENT_TYPE_STROKE,
  type PageElementData,
  type Rect,
  type TextElementData,
} from './textboxModel';

/**
 * The text side of edit markers: applying deletions and replacements to a textbox's text, the
 * highlight ranges for the preview, typed replacement lines, and the messages and log summaries
 * the review screen and the diagnostics show.
 */

export const REPLACE_SOURCE_HORIZONTAL_OVERLAP_RATIO = 0.35;

export const REPLACE_SOURCE_VERTICAL_OVERLAP_RATIO = 0.25;

export function verticalOverlapRatio(left: Rect, right: Rect): number {
  const denominator = Math.min(rectHeight(left), rectHeight(right));
  if (denominator <= 0) {
    return 0;
  }

  return rectOverlapHeight(left, right) / denominator;
}

export function roundNumber(value: number): number {
  return Math.round(value * 100) / 100;
}

export function roundRect(rect: Rect): Rect {
  return {
    left: roundNumber(rect.left),
    top: roundNumber(rect.top),
    right: roundNumber(rect.right),
    bottom: roundNumber(rect.bottom),
  };
}

export function buildSelectionMessage(
  selectedMarkerCount: number,
  selectedTextboxCount: number,
): string {
  const parts: string[] = [];

  parts.push(
    selectedMarkerCount === 1 ? '1 marker selected' : `${selectedMarkerCount} markers selected`,
  );

  if (selectedTextboxCount > 0) {
    parts.push(
      selectedTextboxCount === 1
        ? '1 textbox also selected'
        : `${selectedTextboxCount} textboxes also selected`,
    );
  }

  return parts.join(' · ');
}

export function buildSummaryMessage(
  operationCount: number,
  ignoredCount: number,
  selectedMarkerCount: number,
): string {
  if (selectedMarkerCount === 0) {
    return 'No edit markers found.';
  }
  if (operationCount === 0) {
    return ignoredCount > 0
      ? `No changes recognized; ${plural(ignoredCount, 'marker')} could not be used (see Ignored).`
      : 'No changes recognized yet.';
  }
  const ignored = ignoredCount > 0 ? ` ${plural(ignoredCount, 'marker')} ignored.` : '';
  return `${plural(operationCount, 'change')} recognized.${ignored}`;
}

export function shortenSnippet(text: string, limit = 44): string {
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

export function formatOperationSnippet(
  kind: EditMarkerOperationKind,
  words: string[],
  replacementText?: string,
): string {
  const joined = words.join(' ').trim();
  if (!joined) {
    return kind === 'replace' ? 'Replace text' : 'Delete text';
  }

  const shortened = shortenSnippet(joined);
  if (kind === 'replace') {
    const replacementLabel = replacementText?.trim()
      ? shortenSnippet(replacementText.trim())
      : '(missing)';
    return `Replace "${shortened}" -> "${replacementLabel}"`;
  }

  return `Delete "${shortened}"`;
}

export function buildOperationDetailWithReplacement(
  targetTextbox: TextElementData,
  lineIndex: number,
  words: WordCandidate[],
  replacementText?: string,
): string {
  const wordLabel = words.length === 1 ? 'word' : 'words';
  const baseDetail = `Textbox ${targetTextbox.numInPage}, line ${lineIndex + 1} - ${words.length} ${wordLabel}`;
  if (!replacementText) {
    return baseDetail;
  }

  return `${baseDetail} - replacement "${shortenSnippet(replacementText.trim(), 32)}"`;
}

export function buildIgnoredMarker(
  marker: PageElementData,
  reason: string,
): IgnoredEditMarker {
  return {
    markerUuid: marker.uuid,
    markerNumInPage: marker.numInPage,
    summary: `Ignored marker ${marker.numInPage}`,
    reason,
  };
}

export function buildTextboxLogSummary(textbox: TextElementData): Record<string, unknown> {
  return {
    uuid: textbox.uuid,
    numInPage: textbox.numInPage,
    layerNum: textbox.layerNum,
    rect: roundRect(cloneRect(textbox.textBox.textRect)),
    textPreview: (textbox.textBox.textContentFull || '').slice(0, 80).replace(/\s+/g, ' '),
    textLength: (textbox.textBox.textContentFull || '').length,
    fontSize: textbox.textBox.fontSize,
    fontPath: textbox.textBox.fontPath,
    textAlign: textbox.textBox.textAlign,
    textBold: textbox.textBox.textBold,
  };
}

export function buildStrokeLogSummary(marker: PageElementData, strokeStats: StrokeStats): Record<string, unknown> {
  return {
    uuid: marker.uuid,
    numInPage: marker.numInPage,
    sourceType:
      marker.type === ELEMENT_TYPE_STROKE
        ? 'stroke'
        : marker.type === ELEMENT_TYPE_GEO
          ? 'geometry'
          : `type-${marker.type}`,
    geometryType: marker.geometry?.type || null,
    layerNum: marker.layerNum,
    rect: roundRect(strokeStats.rect),
    center: {
      x: roundNumber(strokeStats.center.x),
      y: roundNumber(strokeStats.center.y),
    },
    width: roundNumber(strokeStats.width),
    height: roundNumber(strokeStats.height),
    straightness: roundNumber(strokeStats.straightness),
    angleDeg: roundNumber(strokeStats.angleDeg),
    firstPoint: {
      x: roundNumber(strokeStats.firstPoint.x),
      y: roundNumber(strokeStats.firstPoint.y),
    },
    lastPoint: {
      x: roundNumber(strokeStats.lastPoint.x),
      y: roundNumber(strokeStats.lastPoint.y),
    },
  };
}

export function buildLineLogSummary(
  line: NativeDetailedLine,
  textRect: Rect,
  calibration: EditMarkerCalibration,
): Record<string, unknown> {
  return {
    index: line.index,
    start: line.start,
    end: line.end,
    left: roundNumber(textLeftX(textRect.left, calibration) + line.left),
    right: roundNumber(textLeftX(textRect.left, calibration) + line.right),
    top: roundNumber(textRect.top + calibration.offsetY + line.top),
    bottom: roundNumber(textRect.top + calibration.offsetY + line.bottom),
    width: roundNumber(line.width),
    baseline: roundNumber(textRect.top + calibration.offsetY + line.baseline),
  };
}

export function buildWordLogSummary(candidate: WordCandidate): Record<string, unknown> {
  return {
    text: candidate.text,
    lineIndex: candidate.lineIndex,
    start: candidate.start,
    end: candidate.end,
    rect: roundRect({
      left: candidate.absoluteLeft,
      top: candidate.absoluteTop,
      right: candidate.absoluteRight,
      bottom: candidate.absoluteBottom,
    }),
    center: {
      x: roundNumber(candidate.absoluteCenterX),
      y: roundNumber(candidate.absoluteCenterY),
    },
    overlapRatio: roundNumber(candidate.overlapRatio),
    projectedY: roundNumber(candidate.projectedY),
  };
}

function normalizeTextAfterEdit(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\[\s+/g, '[')
    .replace(/\{\s+/g, '{')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function getUniqueTextMutationRanges(ranges: TextMutationRange[]): TextMutationRange[] {
  return [...ranges]
    .sort((left, right) => {
      if (left.start !== right.start) {
        return left.start - right.start;
      }

      return left.end - right.end;
    })
    .filter(
      (range, index, allRanges) =>
        index === 0 ||
        range.start !== allRanges[index - 1].start ||
        range.end !== allRanges[index - 1].end ||
        range.kind !== allRanges[index - 1].kind ||
        (range.replacementText || '') !== (allRanges[index - 1].replacementText || ''),
    );
}

export function applyTextMutationRangesDetailed(
  text: string,
  ranges: TextMutationRange[],
): {text: string; insertedRanges: EditMarkerHighlightRange[]} {
  const uniqueRanges = getUniqueTextMutationRanges(ranges);
  let nextText = text;
  let offset = 0;
  const insertedRanges: EditMarkerHighlightRange[] = [];

  for (const range of uniqueRanges) {
    const replacementText = range.kind === 'replace' ? range.replacementText || '' : '';
    const currentStart = range.start + offset;
    const currentEnd = range.end + offset;
    nextText = `${nextText.slice(0, currentStart)}${replacementText}${nextText.slice(currentEnd)}`;
    if (range.kind === 'replace' && replacementText.length > 0) {
      insertedRanges.push({
        start: currentStart,
        end: currentStart + replacementText.length,
      });
    }
    offset += replacementText.length - (range.end - range.start);
  }

  return {
    text: normalizeTextAfterEdit(nextText),
    insertedRanges: mergeHighlightRanges(insertedRanges),
  };
}

export function applyTextMutationRanges(
  text: string,
  ranges: TextMutationRange[],
): string {
  return applyTextMutationRangesDetailed(text, ranges).text;
}

export function parseReplacementLines(textbox: TextElementData): ReplacementTextLine[] {
  const text = textbox.textBox.textContentFull || '';
  const lines = text.split(/\r?\n/);
  const rect = textbox.textBox.textRect;

  return lines
    .map((line, index) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('#')) {
        return null;
      }

      const replacementText = trimmed.slice(1).trim();
      if (!replacementText) {
        return null;
      }

      return {
        sourceTextboxUuid: textbox.uuid,
        sourceTextboxNumInPage: textbox.numInPage,
        sourceLineIndex: index,
        sortTop: rect.top + index,
        sortLeft: rect.left,
        text: replacementText,
        rawLine: line,
      };
    })
    .filter((line): line is ReplacementTextLine => !!line);
}

export function buildReplacementLineLogSummary(line: ReplacementTextLine): Record<string, unknown> {
  return {
    sourceTextboxUuid: line.sourceTextboxUuid,
    sourceTextboxNumInPage: line.sourceTextboxNumInPage,
    sourceLineIndex: line.sourceLineIndex,
    text: line.text,
    rawLine: line.rawLine,
  };
}

export function createEmptyPreview(
  selectedMarkerCount = 0,
  selectedTextboxCount = 0,
): EditMarkerPreview {
  return {
    selectedMarkerCount,
    selectedTextboxCount,
    recognizedOperationCount: 0,
    selectionMessage: buildSelectionMessage(selectedMarkerCount, selectedTextboxCount),
    summaryMessage:
      selectedMarkerCount === 0
        ? 'No edit markers found.'
        : 'No changes recognized yet.',
    textboxes: [],
    fontWarning: null,
    operations: [],
    ignoredMarkers: [],
    canApply: false,
    applyPlan: null,
    base: null,
    penEdits: [],
    pendingCount: 0,
    skippedCount: 0,
  };
}

export function mergeHighlightRanges(
  ranges: EditMarkerHighlightRange[],
): EditMarkerHighlightRange[] {
  if (ranges.length === 0) {
    return [];
  }

  const sorted = [...ranges]
    .filter(range => range.end > range.start)
    .sort((left, right) => left.start - right.start);
  const merged: EditMarkerHighlightRange[] = [sorted[0]];

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const previous = merged[merged.length - 1];

    if (current.start <= previous.end) {
      previous.end = Math.max(previous.end, current.end);
      continue;
    }

    merged.push({...current});
  }

  return merged;
}

export function cloneTextElementForMutation<Textbox extends TextElementData>(
  element: Textbox,
  mutation: TextMutationPlan,
): Textbox {
  return {
    ...element,
    textBox: {
      ...element.textBox,
      textContentFull: mutation.nextText,
      textRect: cloneRect(mutation.nextTextRect),
    },
  } as Textbox;
}

export function countElementTypes(elements: PageElementData[]): Record<string, number> {
  const counts: Record<string, number> = {};
  elements.forEach(element => {
    const key = `type-${element.type}-layer-${element.layerNum}`;
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}
