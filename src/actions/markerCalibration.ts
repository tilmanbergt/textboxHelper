import type {EditMarkerCalibration} from '../domain/markerTypes';
import {DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION} from '../domain/textboxLayout';
import {writeJsonExportFile} from '../storage/exportFile';
import {logEditMarker, markerDiagnostics} from '../utils/editMarkerLog';

/**
 * The edit-marker calibration (where NOTE draws a textbox's text, tuned in Settings → Calibration)
 * and the diagnostics of the last marker preview. The calibration is kept for the session here and
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

/**
 * Writes the trace of the last edit-marker preview as JSON to the EXPORT folder, only when the
 * user taps "Save Diagnostics". It contains the stages of every marker (sources, stroke and word
 * positions, the reason a marker was ignored) and short text previews of the textboxes involved.
 */
export async function saveEditMarkerDiagnostics(): Promise<string> {
  const snapshot = markerDiagnostics.snapshot();
  if (snapshot.entries.length === 0) {
    throw new Error('No page has been read yet.');
  }
  const createdAt = new Date().toISOString();
  const fileName = `textboxhelper-marker-diagnostics-${createdAt.replace(/[:.]/g, '-')}.json`;
  return writeJsonExportFile(fileName, {
    kind: 'edit-marker-diagnostics',
    createdAt,
    pages: diagnosticsPages.map(page => page + 1),
    entryCount: snapshot.entries.length,
    droppedCount: snapshot.droppedCount,
    entries: snapshot.entries,
  });
}
