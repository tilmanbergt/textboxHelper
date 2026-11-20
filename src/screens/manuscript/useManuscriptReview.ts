/**
 * State and flows of the Manuscript card's Review (technical-design-manuscript.md §4.6, from the
 * edit-marker review of technical-design-pen-edits.md §3.6): reads the current page's marks when
 * the card opens and again after a calibration change, recognizes the pen edits while it is open,
 * keeps corrections and edge nudges, applies the ready changes, drops changes, and keeps the
 * status line. After an apply the card stays open and the page is read again.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {dropItems, type DropItem} from '../../actions/editMarkerDrop';
import {applyEditMarkerPreview} from '../../actions/markerApply';
import {
  getEditMarkerCalibration,
  resetEditMarkerCalibration,
  saveEditMarkerDiagnostics,
  setEditMarkerCalibration,
} from '../../actions/markerCalibration';
import {getEditMarkerPreview} from '../../actions/markerPageAnalysis';
import {
  resetRecognition,
  setPenEditCorrection,
  setPenEditEdges,
  startSelectMark,
} from '../../actions/penEditReview';
import {nudgeShift, type EdgeShift} from '../../domain/edgeShift';
import {assembleMarkerPreview, type SwapOptions} from '../../domain/markerAssembly';
import type {
  EditMarkerCalibration,
  EditMarkerPreview,
  PenTextState,
  RecognizedEditOperation,
} from '../../domain/markerTypes';
import {fileNameOf, userMessage} from '../../domain/userMessage';
import {updateSettings} from '../../storage/settingsFile';
import type {FrameStatus} from '../../ui/ScreenFrame';
import {usePenRecognitionQueue} from './usePenRecognitionQueue';

export interface ManuscriptReview {
  preview: EditMarkerPreview | null;
  /**
   * Drops changes from the page without applying them (pen edits keep or lose their handwriting),
   * then reads the page again.
   */
  drop: (items: DropItem[], eraseHandwriting: boolean) => void;
  /** Moves one of a change's edges (its index in `edgeView.edges`) by one character. */
  nudge: (operation: RecognizedEditOperation, edge: number, delta: number) => void;
  /** A swap's "Fix capitals" on or off (kept while the review is open). */
  setFixCase: (operationId: string, fixCase: boolean) => void;
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
  recognizeAgain: (id: string) => void;
  correct: (id: string, text: string | null) => void;
  /**
   * Select mark: the snippet waits for its mark and the card closes (`onDone`); the next tap of
   * the pen-text button on the mark opens the card again at this change.
   */
  selectMark: (id: string, onDone: () => void) => void;
  penStates: Record<string, PenTextState>;
}

export function useManuscriptReview(): ManuscriptReview {
  const [analysis, setAnalysis] = useState<EditMarkerPreview | null>(null);
  const [penStates, setPenStates] = useState<Record<string, PenTextState>>({});
  const [selectedPenId, setSelectedPenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [status, setStatus] = useState<FrameStatus | null>({text: 'Reading markers…'});
  const [calibration, setCalibration] = useState<EditMarkerCalibration>(getEditMarkerCalibration);
  // Edge nudges of plain marks: kept while the review is open (a pen edit's go with it).
  const [plainShifts, setPlainShifts] = useState<Record<string, EdgeShift>>({});
  const [swapOptions, setSwapOptions] = useState<SwapOptions>({});

  const load = useCallback(
    async (keepStatus = false) => {
      setLoading(true);
      if (!keepStatus) {
        setStatus({text: 'Reading markers…'});
      }
      try {
        const next = await getEditMarkerPreview();
        setAnalysis(next);
        setPenStates(next.base?.penStates ?? {});
        setPlainShifts({});
        setSwapOptions({});
        if (!keepStatus) {
          setStatus(next.fontWarning ? {text: next.fontWarning} : null);
        }
      } catch (error) {
        console.warn('[Manuscript] preview failed', String(error));
        setAnalysis(null);
        setStatus({
          kind: 'error',
          text: userMessage(error, 'Could not read the marks on this page.'),
        });
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Re-assembled whenever a pen edit's text arrives or changes; no new measuring.
  const preview = useMemo(
    () =>
      analysis?.base
        ? assembleMarkerPreview(analysis.base, penStates, analysis.fontWarning, plainShifts, swapOptions)
        : analysis,
    [analysis, penStates, plainShifts, swapOptions],
  );

  const updatePenState = useCallback((id: string, state: PenTextState) => {
    setPenStates(current => ({...current, [id]: state}));
  }, []);

  const penOrder = useMemo(() => (analysis?.penEdits ?? []).map(view => view.id), [analysis]);
  usePenRecognitionQueue(penOrder, selectedPenId, penStates, analysis?.base?.page ?? null, busy || loading, updatePenState);

  const store = useCallback((id: string, write: () => Promise<void>, state: PenTextState) => {
    updatePenState(id, state);
    write().catch(error => {
      console.warn('[Manuscript] pen edit not stored', String(error));
      setStatus({kind: 'error', text: 'The change to this pen edit could not be stored; it applies only now.'});
    });
  }, [updatePenState]);

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
        store(id, () => setPenEditCorrection(id, correctedText), {...current, correctedText});
      }
    },
    [penStates, store],
  );

  // A pen edit's nudges are stored once the taps stop (they come in runs).
  const edgeWrites = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const writes = edgeWrites.current;
    return () => writes.forEach(timer => clearTimeout(timer));
  }, []);

  const nudge = useCallback(
    (operation: RecognizedEditOperation, edge: number, delta: number) => {
      if (busy || applied) {
        return;
      }
      const move = (shift: EdgeShift | null | undefined): EdgeShift => nudgeShift(shift, edge, delta);
      const penId = operation.penEditId;
      if (!penId) {
        setPlainShifts(current => ({...current, [operation.id]: move(current[operation.id])}));
        return;
      }
      const current = penStates[penId];
      if (!current) {
        return;
      }
      const edges = move(current.edges);
      updatePenState(penId, {...current, edges});
      const pending = edgeWrites.current.get(penId);
      if (pending) {
        clearTimeout(pending);
      }
      edgeWrites.current.set(
        penId,
        setTimeout(() => {
          edgeWrites.current.delete(penId);
          setPenEditEdges(penId, edges).catch(error => {
            console.warn('[Manuscript] edges not stored', String(error));
            setStatus({kind: 'error', text: 'The moved edge could not be stored; it applies only now.'});
          });
        }, 500),
      );
    },
    [applied, busy, penStates, updatePenState],
  );

  const selectMark = useCallback(
    (id: string, onDone: () => void) => {
      if (loading || busy) {
        return;
      }
      startSelectMark(id, 'review')
        .then(onDone)
        .catch(error => {
          console.warn('[Manuscript] select mark not stored', String(error));
          setStatus({kind: 'error', text: 'Could not remember the text for Select mark. Please try again.'});
        });
    },
    [busy, loading],
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
        console.warn('[Manuscript] diagnostics failed', String(error));
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
        console.warn('[Manuscript] apply failed', String(error));
        setStatus({kind: 'error', text: userMessage(error, 'The changes could not be applied.')});
      })
      .finally(() => setBusy(false));
  }, [busy, load, loading, preview]);

  const drop = useCallback(
    (items: DropItem[], eraseHandwriting: boolean) => {
      if (!preview || loading || busy || items.length === 0) {
        return;
      }
      setBusy(true);
      setStatus({text: eraseHandwriting ? 'Writing the backup…' : 'Dropping…'});
      dropItems(preview, items, eraseHandwriting)
        .then(async result => {
          setStatus({text: result.message});
          await load(true);
        })
        .catch(error => {
          console.warn('[Manuscript] drop failed', String(error));
          setStatus({kind: 'error', text: userMessage(error, 'Could not drop them from the page.')});
        })
        .finally(() => setBusy(false));
    },
    [busy, load, loading, preview],
  );

  const setFixCase = useCallback(
    (operationId: string, fixCase: boolean) => {
      if (!busy && !applied) {
        setSwapOptions(current => ({...current, [operationId]: {fixCase}}));
      }
    },
    [applied, busy],
  );

  return {
    preview,
    drop,
    nudge,
    setFixCase,
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
    recognizeAgain,
    correct,
    selectMark,
    penStates,
  };
}
