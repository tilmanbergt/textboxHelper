import type {Rect} from 'sn-plugin-lib';
import type {
  NativeDetailedMeasurement,
  NativeDetailedWord,
  TextboxMeasurementCalibration,
} from './supernoteTextboxLayout';

/**
 * Shared text hit-testing helpers for Supernote plugins.
 *
 * These helpers convert native text layout metrics into page-space word boxes and
 * provide coarse coordinate-to-word / coordinate-to-character lookup utilities.
 */

export type PageWordCandidate = NativeDetailedWord & {
  absoluteLeft: number;
  absoluteRight: number;
  absoluteTop: number;
  absoluteBottom: number;
  absoluteCenterX: number;
  absoluteCenterY: number;
  overlapRatio: number;
  projectedY: number;
};

export function buildPageWordCandidates(
  measurement: NativeDetailedMeasurement,
  textRect: Rect,
  calibration: TextboxMeasurementCalibration,
  markerRect: Rect,
  projectY: (absoluteCenterX: number) => number,
): PageWordCandidate[] {
  return measurement.words.map(word => {
    const absoluteLeft = textRect.left + calibration.offsetX + word.left;
    const absoluteRight = textRect.left + calibration.offsetX + word.right;
    const absoluteTop = textRect.top + calibration.offsetY + word.top;
    const absoluteBottom = textRect.top + calibration.offsetY + word.bottom;
    const absoluteCenterX = textRect.left + calibration.offsetX + word.centerX;
    const absoluteCenterY = textRect.top + calibration.offsetY + word.centerY;
    const overlapLeft = Math.max(absoluteLeft, markerRect.left);
    const overlapRight = Math.min(absoluteRight, markerRect.right);
    const overlapWidth = Math.max(0, overlapRight - overlapLeft);
    const overlapRatio = word.width > 0 ? overlapWidth / word.width : 0;

    return {
      ...word,
      absoluteLeft,
      absoluteRight,
      absoluteTop,
      absoluteBottom,
      absoluteCenterX,
      absoluteCenterY,
      overlapRatio,
      projectedY: projectY(absoluteCenterX),
    };
  });
}

export function findLineBandWordCandidates(
  wordCandidates: PageWordCandidate[],
): PageWordCandidate[] {
  return wordCandidates.filter(candidate => {
    const wordHeight = Math.max(1, candidate.absoluteBottom - candidate.absoluteTop);
    const bandTop = candidate.absoluteTop + wordHeight * 0.2;
    const bandBottom = candidate.absoluteBottom - wordHeight * 0.2;
    return candidate.projectedY >= bandTop && candidate.projectedY <= bandBottom;
  });
}

export function findCandidateLineIndexes(
  wordCandidates: PageWordCandidate[],
): number[] {
  return [...new Set(wordCandidates.map(candidate => candidate.lineIndex))];
}

export function findWordAtPoint(
  wordCandidates: PageWordCandidate[],
  x: number,
  y: number,
): PageWordCandidate | null {
  const containingWord = wordCandidates.find(
    word =>
      x >= word.absoluteLeft &&
      x <= word.absoluteRight &&
      y >= word.absoluteTop &&
      y <= word.absoluteBottom,
  );

  if (containingWord) {
    return containingWord;
  }

  if (wordCandidates.length === 0) {
    return null;
  }

  return [...wordCandidates].sort((left, right) => {
    const leftDistance = Math.hypot(left.absoluteCenterX - x, left.absoluteCenterY - y);
    const rightDistance = Math.hypot(right.absoluteCenterX - x, right.absoluteCenterY - y);
    return leftDistance - rightDistance;
  })[0];
}

/**
 * Approximate character hit-testing using the nearest measured word box.
 * This is intentionally simple but good enough for plugin-side coordinate mapping.
 */
export function findCharacterOffsetAtPoint(
  wordCandidates: PageWordCandidate[],
  x: number,
  y: number,
): number | null {
  const word = findWordAtPoint(wordCandidates, x, y);
  if (!word) {
    return null;
  }

  const wordLength = Math.max(1, word.end - word.start);
  const relativeX =
    word.absoluteRight <= word.absoluteLeft
      ? 0
      : (Math.min(word.absoluteRight, Math.max(word.absoluteLeft, x)) - word.absoluteLeft) /
        (word.absoluteRight - word.absoluteLeft);
  const offsetInWord = Math.min(
    wordLength,
    Math.max(0, Math.round(relativeX * wordLength)),
  );

  return Math.min(word.end, word.start + offsetInWord);
}

