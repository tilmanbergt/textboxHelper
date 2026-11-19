import type {Element, TextBox} from 'sn-plugin-lib';
import {
  horizontalOverlapRatio,
  intersectionRect,
  pointInRect,
  rectHeight,
  rectWidth,
} from '../domain/geometry';
import {findCandidateLineIndexes, findLineBandWordCandidates} from '../domain/hitTesting';
import {
  buildWordCandidates,
  isMeaningfulWord,
  MAX_DELETE_WORDS_PER_MARKER,
  MAX_MARKER_HEIGHT_RATIO,
  MIN_MARKER_WIDTH,
} from '../domain/markerStrokes';
import {
  buildIgnoredMarker,
  buildLineLogSummary,
  buildReplacementLineLogSummary,
  buildStrokeLogSummary,
  buildTextboxLogSummary,
  buildWordLogSummary,
  parseReplacementLines,
  REPLACE_SOURCE_HORIZONTAL_OVERLAP_RATIO,
  REPLACE_SOURCE_VERTICAL_OVERLAP_RATIO,
  verticalOverlapRatio,
} from '../domain/markerText';
import type {
  EditMarkerCalibration,
  IgnoredEditMarker,
  MarkerDeleteCandidate,
  ReplacementTextLine,
  StrokeStats,
  WordCandidate,
} from '../domain/markerTypes';
import {DEFAULT_FONT_SIZE, type Rect} from '../domain/textboxModel';
import {textLeftX} from '../domain/textboxLayout';
import {loadMarkerStrokeStats} from '../supernote/markerStrokeRead';
import {measureDetailedTextLayout} from '../supernote/textboxMetrics';
import {logEditMarker} from '../utils/editMarkerLog';

/**
 * Recognizing one delete marker: which textbox and line it lands on and which words it covers,
 * measured with the device's text layout; and finding the typed replacement lines below a
 * textbox. Every decision is logged for "Save Diagnostics".
 */

type TextElement = Element & {
  textBox: TextBox;
};

/** A delete candidate holding the SDK elements it was recognized from. */
export type MarkerCandidate = MarkerDeleteCandidate<Element, TextElement>;

export function buildRejectedResult(
  marker: Element,
  reason: string,
  extra?: Record<string, unknown>,
  landedOnTextbox = true,
): {ignored: IgnoredEditMarker} {
  logEditMarker('markerRejected', {
    markerUuid: marker.uuid,
    markerNumInPage: marker.numInPage,
    reason,
    ...(extra || {}),
  });

  const ignored = buildIgnoredMarker(marker, reason);
  return {
    ignored: landedOnTextbox ? {...ignored, removableNums: [marker.numInPage]} : ignored,
  };
}

export async function analyzeDeleteMarker(
  marker: Element,
  textboxes: TextElement[],
  currentEditMarkerCalibration: EditMarkerCalibration,
  preloadedStrokeStats?: StrokeStats,
): Promise<{candidate?: MarkerCandidate; ignored?: IgnoredEditMarker}> {
  const strokeStats = preloadedStrokeStats || (await loadMarkerStrokeStats(marker));
  if (!strokeStats) {
    return buildRejectedResult(
      marker,
      'No usable page-coordinate marker geometry was available.',
      undefined,
      false,
    );
  }

  const centeredTextboxes = textboxes.filter(textbox =>
    pointInRect(strokeStats.center, textbox.textBox.textRect),
  );
  const overlappingTextboxes = textboxes.filter(textbox =>
    !!intersectionRect(strokeStats.rect, textbox.textBox.textRect),
  );

  logEditMarker('markerTextboxMatching', {
    stroke: buildStrokeLogSummary(marker, strokeStats),
    centeredTextboxCount: centeredTextboxes.length,
    overlappingTextboxCount: overlappingTextboxes.length,
    centeredTextboxes: centeredTextboxes.map(buildTextboxLogSummary),
    overlappingTextboxes: overlappingTextboxes.map(buildTextboxLogSummary),
  });

  if (centeredTextboxes.length !== 1 || overlappingTextboxes.length !== 1) {
    return buildRejectedResult(
      marker,
      'The marker does not land clearly inside exactly one main-layer textbox.',
      {
        stroke: buildStrokeLogSummary(marker, strokeStats),
        centeredTextboxCount: centeredTextboxes.length,
        overlappingTextboxCount: overlappingTextboxes.length,
      },
      // Strokes away from every textbox may be ordinary handwriting: never offered for removal.
      centeredTextboxes.length > 0,
    );
  }

  if (strokeStats.width < MIN_MARKER_WIDTH) {
    return buildRejectedResult(marker, 'The marker is too short to classify reliably.', {
      stroke: buildStrokeLogSummary(marker, strokeStats),
    });
  }

  if (strokeStats.height > strokeStats.width * MAX_MARKER_HEIGHT_RATIO) {
    return buildRejectedResult(marker, 'The marker is too tall relative to its width.', {
      stroke: buildStrokeLogSummary(marker, strokeStats),
    });
  }

  const targetTextbox = centeredTextboxes[0];
  const text = targetTextbox.textBox.textContentFull || '';
  const textboxRect = targetTextbox.textBox.textRect;
  const rawTextboxWidth = rectWidth(textboxRect);
  const effectiveMeasurementWidth = Math.max(
    24,
    rawTextboxWidth - currentEditMarkerCalibration.widthAdjustment,
  );
  const measurement = await measureDetailedTextLayout(
    text,
    rawTextboxWidth,
    targetTextbox.textBox.fontSize || DEFAULT_FONT_SIZE,
    targetTextbox.textBox.fontPath || undefined,
    currentEditMarkerCalibration,
  );

  if (!measurement) {
    return buildRejectedResult(
      marker,
      'Detailed text layout data was unavailable for the target textbox.',
      {
        stroke: buildStrokeLogSummary(marker, strokeStats),
        targetTextbox: buildTextboxLogSummary(targetTextbox),
      },
    );
  }

  const wordCandidates = buildWordCandidates(
    measurement,
    textboxRect,
    strokeStats,
    currentEditMarkerCalibration,
  );
  const lineWordCandidates = findLineBandWordCandidates(wordCandidates);
  const lineIndexes = findCandidateLineIndexes(lineWordCandidates);
  logEditMarker('markerLineCalibration', {
    stroke: buildStrokeLogSummary(marker, strokeStats),
    targetTextbox: buildTextboxLogSummary(targetTextbox),
    calibration: {
      ...currentEditMarkerCalibration,
      rawTextboxWidth,
      rawTextboxHeight: rectHeight(textboxRect),
      effectiveMeasurementWidth,
      measurementRequestedWidth: measurement.requestedWidth,
      measurementLayoutHeight: measurement.layoutHeight,
      measurementLineCount: measurement.lineCount,
      measurementMaxLineWidth: measurement.maxLineWidth,
      measurementFontSize: measurement.requestedFontSize,
      measurementFontPath: measurement.fontPath ?? null,
      typefaceStatus: measurement.typefaceStatus ?? 'unknown (native module without status)',
    },
    measuredLines: measurement.lines.map(line => buildLineLogSummary(line, textboxRect, currentEditMarkerCalibration)),
    allWordCandidates: wordCandidates.map(buildWordLogSummary),
    lineBandCandidates: lineWordCandidates.map(buildWordLogSummary),
    candidateLineIndexes: lineIndexes,
  });
  if (lineIndexes.length !== 1) {
    return buildRejectedResult(
      marker,
      'The marker crosses multiple rendered lines or does not align with a single line.',
      {
        stroke: buildStrokeLogSummary(marker, strokeStats),
        targetTextbox: buildTextboxLogSummary(targetTextbox),
        candidateLineIndexes: lineIndexes,
      },
    );
  }

  const measurementLine = measurement.lines.find(line => line.index === lineIndexes[0]);
  if (!measurementLine) {
    return buildRejectedResult(
      marker,
      'The marker aligned to a rendered line that could not be resolved for preview.',
      {
        stroke: buildStrokeLogSummary(marker, strokeStats),
        targetTextbox: buildTextboxLogSummary(targetTextbox),
        candidateLineIndexes: lineIndexes,
      },
    );
  }

  const lineRect: Rect = {
    left: textLeftX(textboxRect.left, currentEditMarkerCalibration) + measurementLine.left,
    right: textLeftX(textboxRect.left, currentEditMarkerCalibration) + measurementLine.right,
    top: textboxRect.top + currentEditMarkerCalibration.offsetY + measurementLine.top,
    bottom: textboxRect.top + currentEditMarkerCalibration.offsetY + measurementLine.bottom,
  };

  const deletionCandidates = lineWordCandidates.filter(
    candidate => candidate.overlapRatio >= 0.5 && isMeaningfulWord(candidate.text),
  );
  logEditMarker('markerWordSelection', {
    stroke: buildStrokeLogSummary(marker, strokeStats),
    targetTextbox: buildTextboxLogSummary(targetTextbox),
    candidateLineIndex: lineIndexes[0],
    deletionCandidates: deletionCandidates.map(buildWordLogSummary),
  });

  if (deletionCandidates.length === 0) {
    return buildRejectedResult(
      marker,
      'No word was covered enough to classify a delete operation.',
      {
        stroke: buildStrokeLogSummary(marker, strokeStats),
        targetTextbox: buildTextboxLogSummary(targetTextbox),
        lineIndex: lineIndexes[0],
      },
    );
  }

  const uniqueByRange = new Map<string, WordCandidate>();
  deletionCandidates.forEach(candidate => {
    uniqueByRange.set(`${candidate.start}-${candidate.end}`, candidate);
  });

  const words = [...uniqueByRange.values()].sort((left, right) => left.start - right.start);

  if (words.length > MAX_DELETE_WORDS_PER_MARKER) {
    return buildRejectedResult(
      marker,
      `The marker would delete too many words at once (${words.length}).`,
      {
        stroke: buildStrokeLogSummary(marker, strokeStats),
        targetTextbox: buildTextboxLogSummary(targetTextbox),
        lineIndex: lineIndexes[0],
        candidateWords: words.map(word => word.text),
      },
    );
  }

  return {
    candidate: {
      marker,
      markerUuid: marker.uuid,
      markerNumInPage: marker.numInPage,
      markerSortTop: strokeStats.rect.top,
      markerSortLeft: strokeStats.rect.left,
      strokeStats,
      targetTextbox,
      lineIndex: lineIndexes[0],
      lineRect,
      words,
    },
  };
}

export function findReplacementLinesForTextbox(
  targetTextbox: TextElement,
  replaceCandidateCount: number,
  selectedTextboxes: TextElement[],
  targetTextboxesByOrder: TextElement[],
): ReplacementTextLine[] {
  const targetIndex = targetTextboxesByOrder.findIndex(
    textbox => textbox.uuid === targetTextbox.uuid,
  );
  const nextTarget = targetIndex >= 0 ? targetTextboxesByOrder[targetIndex + 1] : null;
  const upperBoundTop = nextTarget ? nextTarget.textBox.textRect.top : Number.POSITIVE_INFINITY;

  const eligibleTextboxes = selectedTextboxes.filter(textbox => {
    if (textbox.uuid === targetTextbox.uuid) {
      return false;
    }

    const textboxRect = textbox.textBox.textRect;
    const targetRect = targetTextbox.textBox.textRect;
    const belowTarget =
      textboxRect.top >= targetTextbox.textBox.textRect.bottom &&
      textboxRect.top < upperBoundTop &&
      horizontalOverlapRatio(textboxRect, targetRect) >=
        REPLACE_SOURCE_HORIZONTAL_OVERLAP_RATIO;
    const rightOfTarget =
      textboxRect.left >= targetRect.right &&
      textboxRect.top < upperBoundTop &&
      verticalOverlapRatio(textboxRect, targetRect) >=
        REPLACE_SOURCE_VERTICAL_OVERLAP_RATIO;
    const bottomRightOfTarget =
      textboxRect.top >= targetRect.bottom &&
      textboxRect.top < upperBoundTop &&
      textboxRect.left >= targetRect.right;

    return belowTarget || rightOfTarget || bottomRightOfTarget;
  });

  const replacementLines = eligibleTextboxes
    .flatMap(parseReplacementLines)
    .sort((left, right) => {
      if (Math.abs(left.sortTop - right.sortTop) > 1) {
        return left.sortTop - right.sortTop;
      }

      return left.sortLeft - right.sortLeft;
    });

  logEditMarker('replaceSourceResolution', {
    targetTextbox: buildTextboxLogSummary(targetTextbox),
    replaceCandidateCount,
    eligibleTextboxes: eligibleTextboxes.map(buildTextboxLogSummary),
    replacementLines: replacementLines.map(buildReplacementLineLogSummary),
  });

  return replacementLines;
}
