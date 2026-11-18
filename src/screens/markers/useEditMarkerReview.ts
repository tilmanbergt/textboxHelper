/**
 * State and flows of the edit-marker review (technical-design-calmer-screens.md §3.4,
 * technical-design-pen-edits.md §3.6): reads the markers once when the screen opens, re-reads
 * after a calibration change, recognizes the pen edits while the screen is open, keeps skips and
 * corrections, applies the ready changes, and keeps the status line. After a successful apply the screen stays open with the
 * result; the preview is read again so the page's new state shows.
 */
import {useCallback, useEffect, useMemo, useState} from 'react';
import {
  applyEditMarkerPreview,
  getEditMarkerCalibration,
  getEditMarkerPreview,
  resetEditMarkerCalibration,
  saveEditMarkerDiagnostics,
  setEditMarkerCalibration,
} from '../../actions/editMarkers';
import {resetRecognition, setPenEditCorrection, setPenEditReview} from '../../actions/penEditReview';
import {assembleMarkerPreview} from '../../domain/markerAssembly';
import type {
  EditMarkerCalibration,
  EditMarkerPreview,
  EditMarkerPreviewScope,
  PenTextState,
} from '../../domain/markerTypes';
import {fileNameOf, userMessage} from '../../domain/userMessage';
import {updateSettings} from '../../storage/settingsFile';
import type {FrameStatus} from '../../ui/ScreenFrame';
import {usePenRecognitionQueue} from './usePenRecognitionQueue';

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
  /** Recognize the selected pen edit first. */
  setSelectedPenEdit: (id: string | null) => void;
  setSkipped: (id: string, skipped: boolean) => void;
  recognizeAgain: (id: string) => void;
  correct: (id: string, text: string | null) => void;
  penStates: Record<string, PenTextState>;
}

export function useEditMarkerReview(scope: EditMarkerPreviewScope): EditMarkerReview {
  const [analysis, setAnalysis] = useState<EditMarkerPreview | null>(null);
  const [penStates, setPenStates] = useState<Record<string, PenTextState>>({});
  const [selectedPenId, setSelectedPenId] = useState<string | null>(null);
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
        setAnalysis(next);
        setPenStates(next.base?.penStates ?? {});
        if (!keepStatus) {
          setStatus(next.fontWarning ? {text: next.fontWarning} : null);
        }
      } catch (error) {
        console.warn('[EditMarkerReview] preview failed', String(error));
        setAnalysis(null);
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

  // Re-assembled whenever a pen edit's text arrives or changes; no new measuring.
  const preview = useMemo(
    () => (analysis?.base ? assembleMarkerPreview(analysis.base, penStates, analysis.fontWarning) : analysis),
    [analysis, penStates],
  );

  const updatePenState = useCallback((id: string, state: PenTextState) => {
    setPenStates(current => ({...current, [id]: state}));
  }, []);

  const penOrder = useMemo(() => (analysis?.penEdits ?? []).map(view => view.id), [analysis]);
  usePenRecognitionQueue(penOrder, selectedPenId, penStates, analysis?.base?.page ?? null, busy || loading, updatePenState);

  const store = useCallback((id: string, write: () => Promise<void>, state: PenTextState) => {
    updatePenState(id, state);
    write().catch(error => {
      console.warn('[EditMarkerReview] pen edit not stored', String(error));
      setStatus({kind: 'error', text: 'The change to this pen edit could not be stored; it applies only now.'});
    });
  }, [updatePenState]);

  const setSkipped = useCallback(
    (id: string, skipped: boolean) => {
      const current = penStates[id];
      if (current) {
        const review = skipped ? 'skipped' : 'open';
        store(id, () => setPenEditReview(id, review), {...current, review});
      }
    },
    [penStates, store],
  );

  const recognizeAgain = useCallback(
    (id: string) => {
      const current = penStates[id];
      if (current) {
        store(id, () => resetRecognition(id), {...current, status: 'waiting', text: '', correctedText: null});
        setPenEditCorrection(id, null).catch(() => undefined);
      }
    },
    [penStates, store],
  );

  const correct = useCallback(
    (id: string, text: string | null) => {
      const current = penStates[id];
      if (current) {
        const correctedText = text === null ? null : text.trim();
        store(id, () => setPenEditCorrection(id, correctedText), {...current, correctedText, review: 'open'});
        if (current.review === 'skipped') {
          setPenEditReview(id, 'open').catch(() => undefined);
        }
      }
    },
    [penStates, store],
  );

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
    setSelectedPenEdit: setSelectedPenId,
    setSkipped,
    recognizeAgain,
    correct,
    penStates,
  };
}
