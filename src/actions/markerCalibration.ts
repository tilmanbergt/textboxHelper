import type {EditMarkerCalibration} from '../domain/markerTypes';
import {DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION} from '../domain/textboxLayout';
import {logEditMarker, markerDiagnostics} from '../utils/editMarkerLog';

/**
 * The edit-marker calibration (where NOTE draws a textbox's text, tuned in Settings → Calibration)
 * and the pages in the diagnostics trace of the last marker preview (Report a problem writes it). The calibration is kept for the session here and
 * stored by the review in `settings.json`.
 */

const DEFAULT_EDIT_MARKER_CALIBRATION: EditMarkerCalibration = {
  ...DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION,
};

let calibration: EditMarkerCalibration = {...DEFAULT_EDIT_MARKER_CALIBRATION};
let diagnosticsPages: number[] = [];

export function getEditMarkerCalibration(): EditMarkerCalibration {
  return {...calibration};
}

export function setEditMarkerCalibration(
  next: Partial<EditMarkerCalibration>,
): EditMarkerCalibration {
  calibration = {...calibration, ...next};
  logEditMarker('calibrationUpdated', calibration);
  return getEditMarkerCalibration();
}

export function resetEditMarkerCalibration(): EditMarkerCalibration {
  calibration = {...DEFAULT_EDIT_MARKER_CALIBRATION};
  logEditMarker('calibrationReset', calibration);
  return getEditMarkerCalibration();
}

/** Starts a new diagnostics trace: when the Manuscript card opens or reads its pages again. */
export function clearMarkerDiagnostics(): void {
  markerDiagnostics.clear();
  diagnosticsPages = [];
}

/** Notes a page whose reading goes into the trace. */
export function noteDiagnosticsPage(page: number): void {
  if (!diagnosticsPages.includes(page)) {
    diagnosticsPages.push(page);
  }
}

/** The pages (1-based) whose reading is in the diagnostics trace, for Report a problem. */
export function diagnosticsPagesRead(): number[] {
  return diagnosticsPages.map(page => page + 1);
}
