import type {Element, TextBox} from 'sn-plugin-lib';
import {
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
  buildStrokeLogSummary,
  buildTextboxLogSummary,
  buildWordLogSummary,
} from '../domain/markerText';
import type {
  EditMarkerCalibration,
  IgnoredEditMarker,
  MarkerDeleteCandidate,
  StrokeStats,
  WordCandidate,
} from '../domain/markerTypes';
import type {Rect} from '../domain/textboxModel';
import {textLeftX} from '../domain/textboxLayout';
import {loadMarkerStrokeStats} from '../supernote/markerStrokeRead';
import {logEditMarker} from '../utils/editMarkerLog';
import type {TextboxMeasurer} from './markerMeasure';

/**
 * Recognizing one delete marker: which textbox and line it lands on and which words it covers,
 * measured with the device's text layout. Every decision is logged for "Save Diagnostics".
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
  measurer: TextboxMeasurer,
  preloadedStrokeStats?: StrokeStats,
): Promise<{candidate?: MarkerCandidate; ignored?: IgnoredEditMarker; fontLocked?: boolean}> {
  const currentEditMarkerCalibration: EditMarkerCalibration = measurer.calibration;
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

  const targetTextbox = centeredTextboxes[0];
  const measured = await measurer.measure(targetTextbox);
  if (!measured) {
    return buildRejectedResult(
      marker,
      'Detailed text layout data was unavailable for the target textbox.',
      {
        stroke: buildStrokeLogSummary(marker, strokeStats),
        targetTextbox: buildTextboxLogSummary(targetTextbox),
      },
    );
  }
  if (!measured.fontReadable) {
    return {
      ...buildRejectedResult(marker, measurer.locked(targetTextbox, measured), {
        targetTextbox: buildTextboxLogSummary(targetTextbox),
      }),
      fontLocked: true,
    };
  }
  const measurement = measured.measurement;

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

  const textboxRect = targetTextbox.textBox.textRect;
  const rawTextboxWidth = rectWidth(textboxRect);
  const effectiveMeasurementWidth = Math.max(
    24,
    rawTextboxWidth - currentEditMarkerCalibration.widthAdjustment,
  );
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
