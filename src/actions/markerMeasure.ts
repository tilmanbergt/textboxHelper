import {
  fontFileName,
  fontLockedReason,
  isDefaultTypefaceStatus,
  NOTE_SYSTEM_FONT_PATH,
} from '../domain/fontPaths';
import {
  textLeftX,
  X_HEIGHT_PER_FONT_SIZE,
  type NativeDetailedMeasurement,
  type TextboxMeasurementCalibration,
} from '../domain/textboxLayout';
import {DEFAULT_FONT_SIZE, type TextElementData} from '../domain/textboxModel';
import {measureDetailedTextLayout} from '../supernote/textboxMetrics';
import {logEditMarker} from '../utils/editMarkerLog';
import type {CaretTextbox} from '../domain/marks/textboxView';

/**
 * One measurement per textbox and review (technical-design-swap-space-marks.md §2): every mark
 * analysis asks here, so a textbox is measured once and all marks agree on its words. A textbox
 * whose font fell back to the standard font is locked: its words were measured in the wrong font,
 * so no mark on it is placed. The locked textboxes a mark landed on are collected for the
 * review's one line about them.
 */

export type MeasuredTextbox = {
  measurement: NativeDetailedMeasurement;
  /** Lines and words in page pixels, as the caret and shape marks use them. */
  box: CaretTextbox;
  fontReadable: boolean;
  fontName: string;
};

export type TextboxMeasurer = {
  measure(textbox: TextElementData): Promise<MeasuredTextbox | null>;
  /** Records that a mark on this textbox was ignored because of its font; returns the reason. */
  locked(textbox: TextElementData, measured: MeasuredTextbox): string;
  /** The locked textboxes a mark landed on: their numbers and font names. */
  lockedTextboxes(): Array<{numInPage: number; fontName: string}>;
  calibration: TextboxMeasurementCalibration;
};

export function caretTextboxOf(
  textbox: TextElementData,
  measurement: NativeDetailedMeasurement,
  calibration: TextboxMeasurementCalibration,
): CaretTextbox {
  const rect = textbox.textBox.textRect;
  const x = textLeftX(rect.left, calibration);
  const y = rect.top + calibration.offsetY;
  return {
    uuid: textbox.uuid,
    numInPage: textbox.numInPage,
    rect: {...rect},
    text: textbox.textBox.textContentFull || '',
    lines: measurement.lines.map(line => ({
      index: line.index,
      start: line.start,
      end: line.end,
      top: y + line.top,
      bottom: y + line.bottom,
      baseline: y + line.baseline,
    })),
    xHeight:
      measurement.xHeight && measurement.xHeight > 0
        ? measurement.xHeight
        : (textbox.textBox.fontSize || DEFAULT_FONT_SIZE) * X_HEIGHT_PER_FONT_SIZE,
    words: measurement.words.map(word => ({
      start: word.start,
      end: word.end,
      lineIndex: word.lineIndex,
      left: x + word.left,
      right: x + word.right,
      ...(word.charEdges ? {edges: word.charEdges.map(edge => x + edge)} : {}),
    })),
  };
}

export function createTextboxMeasurer(
  calibration: TextboxMeasurementCalibration,
): TextboxMeasurer {
  const cache = new Map<string, Promise<MeasuredTextbox | null>>();
  const lockedUse = new Map<string, {numInPage: number; fontName: string}>();

  const measureNow = async (
    textbox: TextElementData,
  ): Promise<MeasuredTextbox | null> => {
    const rect = textbox.textBox.textRect;
    const fontPath = textbox.textBox.fontPath || undefined;
    const measurement = await measureDetailedTextLayout(
      textbox.textBox.textContentFull || '',
      rect.right - rect.left,
      textbox.textBox.fontSize || DEFAULT_FONT_SIZE,
      fontPath,
      calibration,
    );
    if (!measurement) {
      return null;
    }
    const fontReadable = !isDefaultTypefaceStatus(measurement.typefaceStatus);
    const fontName = fontFileName(fontPath || NOTE_SYSTEM_FONT_PATH);
    if (!fontReadable) {
      logEditMarker('fontLocked', {
        textboxNumInPage: textbox.numInPage,
        fontPath: fontPath ?? null,
        typefaceStatus: measurement.typefaceStatus ?? null,
      });
    }
    return {
      measurement,
      box: caretTextboxOf(textbox, measurement, calibration),
      fontReadable,
      fontName,
    };
  };

  return {
    calibration,
    measure(textbox) {
      const known = cache.get(textbox.uuid);
      if (known) {
        return known;
      }
      const next = measureNow(textbox).catch(() => null);
      cache.set(textbox.uuid, next);
      return next;
    },
    locked(textbox, measured) {
      lockedUse.set(textbox.uuid, {
        numInPage: textbox.numInPage,
        fontName: measured.fontName,
      });
      return fontLockedReason(measured.fontName);
    },
    lockedTextboxes() {
      return [...lockedUse.values()];
    },
  };
}
