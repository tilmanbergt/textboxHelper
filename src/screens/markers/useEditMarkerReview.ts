/**
 * State and flows of the edit-marker review (technical-design-calmer-screens.md §3.4): reads the
 * markers once when the screen opens, re-reads after a calibration change, applies the whole
 * preview, and keeps the status line. After a successful apply the screen stays open with the
 * result; the preview is read again so the page's new state shows.
 */
import {useCallback, useEffect, useState} from 'react';
import {
  applyEditMarkerPreview,
  getEditMarkerCalibration,
  getEditMarkerPreview,
  resetEditMarkerCalibration,
  saveEditMarkerDiagnostics,
  setEditMarkerCalibration,
} from '../../actions/editMarkers';
import type {
  EditMarkerCalibration,
  EditMarkerPreview,
  EditMarkerPreviewScope,
} from '../../domain/markerTypes';
import {fileNameOf, userMessage} from '../../domain/userMessage';
import {updateSettings} from '../../storage/settingsFile';
import type {FrameStatus} from '../../ui/ScreenFrame';

export interface EditMarkerReview {
  preview: EditMarkerPreview | null;
  loading: boolean;
  busy: boolean;
  applied: boolean;
  status: FrameStatus | null;
  calibration: EditMarkerCalibration;
  changeCalibration: (next: Partial<EditMarkerCalibration>) => void;
  resetCalibration: () => void;
  refresh: () => void;
  saveDiagnostics: () => void;
  apply: () => void;
}

export function useEditMarkerReview(scope: EditMarkerPreviewScope): EditMarkerReview {
  const [preview, setPreview] = useState<EditMarkerPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [status, setStatus] = useState<FrameStatus | null>({text: 'Reading markers…'});
  const [calibration, setCalibration] = useState<EditMarkerCalibration>(getEditMarkerCalibration);

  const load = useCallback(
    async (keepStatus = false) => {
      setLoading(true);
      if (!keepStatus) {
        setStatus({text: 'Reading markers…'});
      }
      try {
        const next = await getEditMarkerPreview(scope);
        setPreview(next);
        if (!keepStatus) {
          setStatus(next.fontWarning ? {text: next.fontWarning} : null);
        }
      } catch (error) {
        console.warn('[EditMarkerReview] preview failed', String(error));
        setPreview(null);
        setStatus({
          kind: 'error',
          text: userMessage(
            error,
            scope === 'page' ? 'Could not read the markers on this page.' : 'Could not read the lasso selection.',
          ),
        });
      } finally {
        setLoading(false);
      }
    },
    [scope],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Calibration is kept between sessions so it can be tuned over time (settings file).
  const remember = (next: EditMarkerCalibration) => {
    setCalibration(next);
    updateSettings(current => ({...current, markers: {calibration: next}}));
  };

  const changeCalibration = useCallback(
    (next: Partial<EditMarkerCalibration>) => {
      if (loading || busy) {
        return;
      }
      remember(setEditMarkerCalibration(next));
      void load();
    },
    [busy, load, loading],
  );

  const resetCalibration = useCallback(() => {
    if (loading || busy) {
      return;
    }
    remember(resetEditMarkerCalibration());
    void load();
  }, [busy, load, loading]);

  const refresh = useCallback(() => {
    if (!loading && !busy) {
      void load();
    }
  }, [busy, load, loading]);

  const saveDiagnostics = useCallback(() => {
    if (loading || busy) {
      return;
    }
    saveEditMarkerDiagnostics()
      .then(path => setStatus({text: `Diagnostics saved to EXPORT: ${fileNameOf(path)}`}))
      .catch(error => {
        console.warn('[EditMarkerReview] diagnostics failed', String(error));
        setStatus({kind: 'error', text: userMessage(error, 'Could not save the diagnostics.')});
      });
  }, [busy, loading]);

  const apply = useCallback(() => {
    if (!preview?.canApply || loading || busy) {
      return;
    }
    setBusy(true);
    setStatus({text: 'Writing the backup…'});
    applyEditMarkerPreview(preview, {
      onProgress: update => setStatus({text: update.message}),
    })
      .then(async result => {
        setApplied(true);
        setStatus({text: `${result.message} Backup: ${fileNameOf(result.backupPath)}`});
        await load(true);
      })
      .catch(error => {
        console.warn('[EditMarkerReview] apply failed', String(error));
        setStatus({kind: 'error', text: userMessage(error, 'The changes could not be applied.')});
      })
      .finally(() => setBusy(false));
  }, [busy, load, loading, preview]);

  return {
    preview,
    loading,
    busy,
    applied,
    status,
    calibration,
    changeCalibration,
    resetCalibration,
    refresh,
    saveDiagnostics,
    apply,
  };
}
