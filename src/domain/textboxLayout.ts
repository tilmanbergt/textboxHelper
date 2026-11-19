/**
 * Textbox sizing without the device: the measurement types the native module returns, the
 * calibration, and the estimate used when native measurement is unavailable. The native calls
 * live in `src/supernote/textboxMetrics.ts`.
 *
 * This is intentionally Supernote-specific rather than abstract:
 * - it assumes NOTE textbox frame rectangles
 * - it supports the calibrated width correction learned from device testing
 */

export type TextboxMeasurementCalibration = {
  offsetX: number;
  offsetY: number;
  widthAdjustment: number;
};

/**
 * Current hardened default. The manual UI calibration in the marker tool is temporary;
 * once device behavior is stable this constant should remain the shared single source of truth.
 */
export const DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION: TextboxMeasurementCalibration = {
  offsetX: 0,
  offsetY: 0,
  widthAdjustment: 30,
};

export type NativeTextMeasurement = {
  text: string;
  requestedWidth: number;
  requestedFontSize: number;
  includePad: boolean;
  /** The font file the measurement was asked to use, if any. */
  fontPath?: string | null;
  /** Which typeface was used: "loaded", "loaded from <path> …", or "default: <reason>". */
  typefaceStatus?: string;
  layoutHeight: number;
  lineCount: number;
  maxLineWidth: number;
};

export type NativeDetailedLine = {
  index: number;
  start: number;
  end: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  baseline: number;
  width: number;
};

export type NativeDetailedWord = {
  start: number;
  end: number;
  tokenStart: number;
  tokenEnd: number;
  lineIndex: number;
  text: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  /**
   * Where each character of the word starts, and where its last one ends (length = characters +
   * 1), in the same coordinates as `left`. Missing from native builds before it was added.
   */
  charEdges?: number[];
};

export type NativeDetailedMeasurement = {
  text: string;
  requestedWidth: number;
  requestedFontSize: number;
  includePad: boolean;
  /** The font file the measurement was asked to use, if any. */
  fontPath?: string | null;
  /** Which typeface was used: "loaded", "loaded from <path> …", or "default: <reason>". */
  typefaceStatus?: string;
  layoutHeight: number;
  lineCount: number;
  maxLineWidth: number;
  lines: NativeDetailedLine[];
  words: NativeDetailedWord[];
};

const MIN_TEXTBOX_HEIGHT = 48;
// const SUPERNOTE_ONE_LINE_FONT_SIZE_OFFSET = 5;
// const SUPERNOTE_ONE_LINE_HEIGHT_FACTOR = 2.3;
const BOX_HORIZONTAL_PADDING_FACTOR = 0.62;
const BOX_VERTICAL_PADDING_FACTOR = 0.72;
const LINE_HEIGHT_FACTOR = 1.35;

/**
 * Where a textbox's text starts on the page. NOTE draws text with an inner margin on both sides;
 * the width adjustment takes off both, so its half is the left margin (device: words were drawn
 * about 15–18 px right of where they were measured while the X offset was 0). The X offset adds
 * to it.
 */
export function textLeftX(textRectLeft: number, calibration: TextboxMeasurementCalibration): number {
  return textRectLeft + calibration.offsetX + Math.max(0, calibration.widthAdjustment) / 2;
}

export function getRequestedWidth(
  width: number,
  calibration: TextboxMeasurementCalibration,
): number {
  return Math.max(24, width - calibration.widthAdjustment);
}

function estimateLineCount(text: string, width: number, fontSize: number): number {
  const normalized = text.replace(/\r\n?/g, '\n');
  const maxCharactersPerLine = Math.max(
    1,
    Math.floor(
      (width - fontSize * BOX_HORIZONTAL_PADDING_FACTOR * 2) /
        Math.max(6, fontSize * 0.54),
    ),
  );
  let lineCount = 0;

  normalized.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) {
      lineCount += 1;
      return;
    }

    let currentLineLength = 0;
    trimmed.split(/\s+/).forEach(word => {
      const wordLength = word.length;
      if (currentLineLength === 0) {
        currentLineLength = wordLength;
        return;
      }

      if (currentLineLength + 1 + wordLength <= maxCharactersPerLine) {
        currentLineLength += 1 + wordLength;
        return;
      }

      lineCount += 1;
      currentLineLength = wordLength;
    });

    if (currentLineLength > 0) {
      lineCount += 1;
    }
  });

  return Math.max(1, lineCount);
}

export function estimateTextboxHeightFallback(
  text: string,
  width: number,
  fontSize: number,
): number {
  const lineCount = estimateLineCount(text, width, fontSize);
  const lineHeight = Math.max(fontSize * LINE_HEIGHT_FACTOR, fontSize + 10);
  const verticalPadding = Math.max(12, fontSize * BOX_VERTICAL_PADDING_FACTOR);
  return Math.max(
    MIN_TEXTBOX_HEIGHT,
    Math.ceil(lineCount * lineHeight + verticalPadding * 2),
  );
}

export function countExplicitEmptyLines(text: string): number {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter(line => line.trim().length === 0).length;
}

export function getExtraLineStep(fontSize: number): number {
  return Math.max(fontSize + 3, Math.round(fontSize * 1.1));
}
