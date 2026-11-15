import {createDiagnosticLog} from '../domain/diagnosticLog';

/**
 * Every stage of the last edit-marker preview, for "Save Diagnostics" in the review screen. Each
 * marker needs about ten entries, so 4,000 cover a full page of markers.
 */
export const markerDiagnostics = createDiagnosticLog(4000);

export function logEditMarker(stage: string, payload?: unknown): void {
  markerDiagnostics.add(stage, payload);
  if (payload === undefined) {
    console.log(`[EditMarkerActions] ${stage}`);
    return;
  }

  try {
    console.log(`[EditMarkerActions] ${stage}`, JSON.stringify(payload));
  } catch {
    console.log(`[EditMarkerActions] ${stage}`, String(payload));
  }
}
