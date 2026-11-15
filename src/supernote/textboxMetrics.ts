import {NativeModules} from 'react-native';
import type {Rect} from 'sn-plugin-lib';
import {
  buildFontFallbackPaths,
  buildFontWarning,
  isDefaultTypefaceStatus,
} from '../domain/fontPaths';
import {rectWidth} from '../domain/geometry';
import type {MeasureTextboxHeight} from '../domain/paginationCore';
import {
  DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION,
  countExplicitEmptyLines,
  estimateTextboxHeightFallback,
  getExtraLineStep,
  getRequestedWidth,
  type NativeDetailedMeasurement,
  type NativeTextMeasurement,
  type TextboxMeasurementCalibration,
} from '../domain/textboxLayout';

/**
 * Native text measurement through the plugin's Android module (`TextboxMetricsModule.kt`): the
 * textbox font with its readable fallbacks, the unreadable fonts collected per action, and the
 * final textbox height. The pure parts live in `src/domain/textboxLayout.ts`.
 */

type TextboxMetricsModuleType = {
  measureTextLayout?: (options: {
    text: string;
    width: number;
    fontSize: number;
    includePad?: boolean;
    fontPath?: string;
    fontFallbackPaths?: string[];
  }) => Promise<NativeTextMeasurement>;
  measureTextLayoutDetailed?: (options: {
    text: string;
    width: number;
    fontSize: number;
    includePad?: boolean;
    fontPath?: string;
    fontFallbackPaths?: string[];
  }) => Promise<NativeDetailedMeasurement>;
};

const textboxMetricsModule = NativeModules.TextboxMetrics as
  | TextboxMetricsModuleType
  | undefined;

/** Font paths whose font couldn't be loaded since the last `resetFontWarnings`. */
const unreadableFontPaths = new Set<string>();

/** Starts collecting unreadable fonts for one action (a preview, a split, an import). */
export function resetFontWarnings(): void {
  unreadableFontPaths.clear();
}

/** The warning for fonts that couldn't be loaded since the last reset, or null. */
export function getFontWarning(): string | null {
  return buildFontWarning([...unreadableFontPaths]);
}

function noteTypefaceStatus(fontPath: string | undefined, typefaceStatus?: string): void {
  if (fontPath && isDefaultTypefaceStatus(typefaceStatus)) {
    unreadableFontPaths.add(fontPath);
  }
}

/**
 * The font options for a native measurement: the textbox's font path and the readable places to
 * try when that path can't be opened (`fontPaths.ts`).
 */
function buildFontOptions(fontPath?: string): {fontPath?: string; fontFallbackPaths?: string[]} {
  return fontPath ? {fontPath, fontFallbackPaths: buildFontFallbackPaths(fontPath)} : {};
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
    const measurement = await textboxMetricsModule.measureTextLayout({
      text,
      width: getRequestedWidth(width, calibration),
      fontSize,
      includePad: true,
      ...buildFontOptions(fontPath),
    });
    noteTypefaceStatus(fontPath, measurement?.typefaceStatus);
    return measurement;
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
    const measurement = await textboxMetricsModule.measureTextLayoutDetailed({
      text,
      width: getRequestedWidth(width, calibration),
      fontSize,
      includePad: true,
      ...buildFontOptions(fontPath),
    });
    noteTypefaceStatus(fontPath, measurement?.typefaceStatus);
    return measurement;
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
  addExplicitEmptyLineHeight: boolean = true,
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
 // const measuredLineCount =
  //  nativeMeasurement?.lineCount ?? estimateLineCount(text, width, fontSize);
  const extraEmptyLines = countExplicitEmptyLines(text);
  const extraHeight =
    addExplicitEmptyLineHeight && extraEmptyLines > 0
      ? extraEmptyLines * getExtraLineStep(fontSize)
      : 0;
  //const oneLineMinimum =
   //   ? getOneLineSupernoteMinimumHeight(fontSize)
   //   : MIN_TEXTBOX_HEIGHT;
   //const heightWithMinimum = Math.max(oneLineMinimum, nativeHeight + extraHeight);
   const heightWithoutMinimum = nativeHeight + extraHeight;
      console.log(
        '[TextboxHeightDebug] oneLineMinimumComparison',
        JSON.stringify({
          textPreview: text.slice(0, 120),
          width,
          fontSize,
          nativeHeight,
          extraEmptyLines,
          extraHeight,
          heightWithoutMinimum,
        }),
      );
return heightWithoutMinimum;
  // return heightWithMinimum;
}

/** `estimateTextboxHeight` with the default calibration, as the pagination expects it. */
export const measureTextboxHeight: MeasureTextboxHeight = (
  text,
  width,
  fontSize,
  fontPath,
  addExplicitEmptyLineHeight,
) =>
  estimateTextboxHeight(
    text,
    width,
    fontSize,
    fontPath,
    DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION,
    addExplicitEmptyLineHeight,
  );

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
