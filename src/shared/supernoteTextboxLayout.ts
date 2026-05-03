import {NativeModules} from 'react-native';
import type {Rect} from 'sn-plugin-lib';
import {rectWidth} from './supernoteTextboxGeometry';

/**
 * Shared textbox layout and sizing logic for Supernote plugins.
 *
 * This is intentionally Supernote-specific rather than abstract:
 * - it assumes NOTE textbox frame rectangles
 * - it uses the plugin's Android native text measurement bridge
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
};

export type NativeDetailedMeasurement = {
  text: string;
  requestedWidth: number;
  requestedFontSize: number;
  includePad: boolean;
  layoutHeight: number;
  lineCount: number;
  maxLineWidth: number;
  lines: NativeDetailedLine[];
  words: NativeDetailedWord[];
};

type TextboxMetricsModuleType = {
  measureTextLayout?: (options: {
    text: string;
    width: number;
    fontSize: number;
    includePad?: boolean;
    fontPath?: string;
  }) => Promise<NativeTextMeasurement>;
  measureTextLayoutDetailed?: (options: {
    text: string;
    width: number;
    fontSize: number;
    includePad?: boolean;
    fontPath?: string;
  }) => Promise<NativeDetailedMeasurement>;
};

const textboxMetricsModule = NativeModules.TextboxMetrics as
  | TextboxMetricsModuleType
  | undefined;

const MIN_TEXTBOX_HEIGHT = 48;
const BOX_HORIZONTAL_PADDING_FACTOR = 0.62;
const BOX_VERTICAL_PADDING_FACTOR = 0.72;
const LINE_HEIGHT_FACTOR = 1.35;

function getRequestedWidth(
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

function countExplicitEmptyLines(text: string): number {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter(line => line.trim().length === 0).length;
}

function getExtraLineStep(fontSize: number): number {
  return Math.max(fontSize + 3, Math.round(fontSize * 1.1));
}

export async function measureTextLayout(
  text: string,
  width: number,
  fontSize: number,
  fontPath?: string,
  calibration: TextboxMeasurementCalibration = DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION,
): Promise<NativeTextMeasurement | null> {
  if (!textboxMetricsModule?.measureTextLayout) {
    return null;
  }

  try {
    return await textboxMetricsModule.measureTextLayout({
      text,
      width: getRequestedWidth(width, calibration),
      fontSize,
      includePad: true,
      ...(fontPath ? {fontPath} : {}),
    });
  } catch {
    return null;
  }
}

export async function measureDetailedTextLayout(
  text: string,
  width: number,
  fontSize: number,
  fontPath?: string,
  calibration: TextboxMeasurementCalibration = DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION,
): Promise<NativeDetailedMeasurement | null> {
  if (!textboxMetricsModule?.measureTextLayoutDetailed) {
    return null;
  }

  try {
    return await textboxMetricsModule.measureTextLayoutDetailed({
      text,
      width: getRequestedWidth(width, calibration),
      fontSize,
      includePad: true,
      ...(fontPath ? {fontPath} : {}),
    });
  } catch {
    return null;
  }
}

/**
 * Estimate the final textbox height for a specific text content and textbox width.
 * Native measurement is preferred; fallback logic keeps the result usable when native
 * layout is unavailable.
 */
export async function estimateTextboxHeight(
  text: string,
  width: number,
  fontSize: number,
  fontPath?: string,
  calibration: TextboxMeasurementCalibration = DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION,
): Promise<number> {
  const nativeMeasurement = await measureTextLayout(
    text,
    width,
    fontSize,
    fontPath,
    calibration,
  );
  const nativeHeight =
    nativeMeasurement?.layoutHeight ?? estimateTextboxHeightFallback(text, width, fontSize);
  const extraEmptyLines = countExplicitEmptyLines(text);
  const extraHeight =
    extraEmptyLines > 0 ? extraEmptyLines * getExtraLineStep(fontSize) : 0;

  return Math.max(MIN_TEXTBOX_HEIGHT, nativeHeight + extraHeight);
}

/**
 * Keep left/top/width fixed and recompute only the textbox height.
 */
export async function buildResizedTextboxRect(
  rect: Rect,
  text: string,
  fontSize: number,
  fontPath?: string,
  calibration: TextboxMeasurementCalibration = DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION,
): Promise<Rect> {
  const height = await estimateTextboxHeight(
    text,
    rectWidth(rect),
    fontSize,
    fontPath,
    calibration,
  );

  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.top + height,
  };
}
