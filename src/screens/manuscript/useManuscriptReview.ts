/**
 * State and flows of the Manuscript card's Review (technical-design-manuscript.md §4.2, §4.6, from
 * the edit-marker review of technical-design-pen-edits.md §3.6): reads the current page when the
 * card opens and further pages on request, recognizes the pen edits of the pages read while it is
 * open, keeps corrections and edge nudges, applies the ready changes of every read page at once,
 * drops changes, and keeps the status line. After an apply the card stays open and the pages are
 * read again.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {dropItems, type DropItem} from '../../actions/editMarkerDrop';
import {applyMarkerPlans} from '../../actions/markerApply';
import {
  clearMarkerDiagnostics,
  getEditMarkerCalibration,
  resetEditMarkerCalibration,
  saveEditMarkerDiagnostics,
  setEditMarkerCalibration,
} from '../../actions/markerCalibration';
import {forgetPages, openCachedNote} from '../../actions/manuscriptCache';
import {currentPenStates, readMarkerPage, type MarkerPageRead} from '../../actions/markerPageAnalysis';
import {
  confirmPenEditPlace,
  placePenEditHere,
  resetRecognition,
  setPenEditCorrection,
  setPenEditEdges,
  startSelectMark,
} from '../../actions/penEditReview';
import {nudgeShift, type EdgeShift} from '../../domain/edgeShift';
import {
  checkOrder,
  combinePages,
  listChanged,
  readPages as readPageList,
  type ManuscriptView,
  type PageReview,
} from '../../domain/manuscriptPages';
import {assembleMarkerPreview, type RowOptions} from '../../domain/markerAssembly';
import type {EditMarkerCalibration, PenTextState, RecognizedEditOperation} from '../../domain/markerTypes';
import {fileNameOf, userMessage} from '../../domain/userMessage';
import {updateSettings} from '../../storage/settingsFile';
import {readNoteInfo, type NoteInfo} from '../../supernote/noteElements';
import type {FrameStatus} from '../../ui/ScreenFrame';
import {perfEvent, startTiming, timed} from '../../utils/perf';
import {usePageChecks} from './usePageChecks';
import {usePenRecognitionQueue} from './usePenRecognitionQueue';
import {useTimingsExport} from './useTimingsExport';
import type {PunctuationChar} from '../../domain/marks/shapes/punct';
import type {ToDecideItem} from '../../domain/marks/toDecide';
import {rememberIgnored} from '../../storage/ignoredMarks';

export interface ManuscriptReview {
  note: NoteInfo | null;
  /** Every page's state, assembled with the pen edits' current text. */
  pages: Record<number, PageReview>;
  view: ManuscriptView;
  /** Reads these pages (one after the other); a page read before is read again. */
  readPages: (pages: number[]) => void;
  /** Checks a page read before again, in the background (a tapped chip). */
  recheckPage: (page: number) => void;
  /** Pages being checked in the background (shown from what was read before until then). */
  checking: number[];
  /**
   * Drops changes from a page without applying them (pen edits keep or lose their handwriting),
   * then reads that page again.
   */
  drop: (page: number, items: DropItem[], eraseHandwriting: boolean) => void;
  /** Moves one of a change's edges (its index in `edgeView.edges`) by one character. */
  nudge: (operation: RecognizedEditOperation, edge: number, delta: number) => void;
  /** A swap's "Fix capitals" on or off (kept while the review is open). */
  setFixCase: (operationId: string, fixCase: boolean) => void;
  /** A close-up's "Also remove" punctuation on or off (kept while the review is open). */
  setRemovePunct: (operationId: string, removePunct: boolean) => void;
  /** A punctuation circle's mark, picked by the user (kept while the review is open). */
  setPunctChar: (operationId: string, char: PunctuationChar) => void;
  /** "Insert right here": tagged text without a usable mark goes in where its handwriting starts. */
  placeHere: (page: number, id: string) => void;
  /**
   * Here on a place that stayed open (technical-design-mark-dialogue.md §2.7): a pen edit stores
   * it (`confirmed`, with its edges) and the page is read again; an unclear plain mark becomes the
   * change of the reading chosen (`option`), kept while the review is open.
   */
  here: (page: number, item: ToDecideItem, edges: EdgeShift | null, option?: number) => void;
  /** Ignore an unclear mark: remembered for this page, and the page is read again. */
  ignore: (page: number, item: ToDecideItem) => void;
  loading: boolean;
  busy: boolean;
  applied: boolean;
  status: FrameStatus | null;
  calibration: EditMarkerCalibration;
  changeCalibration: (next: Partial<EditMarkerCalibration>) => void;
  resetCalibration: () => void;
  /** Reads every page read so far again, from scratch (Settings → Calibration: Refresh preview). */
  refresh: () => void;
  /** Checks every page read so far again; unchanged pages keep their analysis (after an Outline apply). */
  recheck: () => void;
  saveDiagnostics: () => void;
  timings: ReturnType<typeof useTimingsExport>;
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
  const [note, setNote] = useState<NoteInfo | null>(null);
  // Pages as read (previews as the analysis left them; assembled below).
  const [analyses, setAnalyses] = useState<Record<number, PageReview>>({});
  const [penStates, setPenStates] = useState<Record<string, PenTextState>>({});
  const [selectedPenId, setSelectedPenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [status, setStatus] = useState<FrameStatus | null>({text: 'Reading the page…'});
  const [calibration, setCalibration] = useState<EditMarkerCalibration>(getEditMarkerCalibration);
  // Edge nudges of plain marks: kept while the review is open (a pen edit's go with it).
  const [plainShifts, setPlainShifts] = useState<Record<string, EdgeShift>>({});
  const [swapOptions, setSwapOptions] = useState<RowOptions>({});
  // Unclear plain marks made a change with Here: by page and item, the reading chosen.
  const [chosen, setChosen] = useState<Record<number, Record<string, number>>>({});
  const noteRef = useRef<NoteInfo | null>(null);

  /** Reads pages one after the other; each shows in the list as soon as it is read. */
  const read = useCallback(async (pages: number[], keepStatus = false, reuse = false) => {
    const info = noteRef.current;
    if (!info || pages.length === 0) {
      return;
    }
    setLoading(true);
    let failed = 0;
    for (const page of pages) {
      setAnalyses(current => ({...current, [page]: {state: 'reading'}}));
      if (!keepStatus) {
        setStatus({text: pages.length > 1 ? `Reading page ${page + 1}…` : 'Reading the page…'});
      }
      try {
        const {preview} = await readMarkerPage(info.notePath, page, {reuse});
        setChosen(current => ({...current, [page]: {}}));
        setAnalyses(current => ({...current, [page]: {state: 'read', preview}}));
        setPenStates(current => ({...current, ...(preview.base?.penStates ?? {})}));
      } catch (error) {
        failed += 1;
        console.warn('[Manuscript] page not read', page, String(error));
        const message = userMessage(error, `Could not read page ${page + 1}.`);
        setAnalyses(current => ({...current, [page]: {state: 'failed', message}}));
        setStatus({kind: 'error', text: message});
      }
    }
    if (!keepStatus && failed === 0) {
      setStatus(null);
    }
    setLoading(false);
  }, []);

  const onCheckedRef = useRef<(page: number, result: MarkerPageRead) => void>(() => undefined);
  const checks = usePageChecks(
    useCallback(() => noteRef.current?.notePath ?? null, []),
    useCallback((page: number, result: MarkerPageRead) => onCheckedRef.current(page, result), []),
    useCallback(() => undefined, []),
  );
  const {enqueue, pause, resume, stop} = checks;

  // Opening: pages read before show at once from the cache; the current page is read (or checked,
  // when cached) first, then the cached pages are checked nearest first
  // (technical-design-manuscript-cache.md §4).
  useEffect(() => {
    clearMarkerDiagnostics();
    const endFirstList = startTiming('card.firstList');
    timed('card.noteInfo', readNoteInfo)
      .then(async info => {
        noteRef.current = info;
        const cached = openCachedNote(info.notePath, info.pageCount);
        perfEvent('card.open', {
          page: info.currentPage,
          pageCount: info.pageCount,
          cachedPages: cached.size,
          currentCached: cached.has(info.currentPage),
        });
        if (cached.size > 0) {
          const states = await currentPenStates(
            [...cached.values()].flatMap(preview => Object.keys(preview.base?.penStates ?? {})),
          );
          setAnalyses(Object.fromEntries([...cached].map(([page, preview]) => [page, {state: 'read', preview}])));
          setPenStates(states);
        }
        setNote(info);
        if (!cached.has(info.currentPage)) {
          await read([info.currentPage]);
        } else {
          setLoading(false);
          setStatus(null);
        }
        endFirstList({fromCache: cached.has(info.currentPage)});
        enqueue(checkOrder(info.currentPage, [...cached.keys()]));
      })
      .catch(error => {
        console.warn('[Manuscript] note not read', String(error));
        setLoading(false);
        setStatus({kind: 'error', text: userMessage(error, 'Could not read this note.')});
      });
  }, [enqueue, read]);

  // A page checked in the background: unchanged → only its pen edits' states are new; changed →
  // its new analysis replaces the shown one, and the status line says so when the list differs.
  onCheckedRef.current = (page: number, result: MarkerPageRead) => {
    const {preview, reused} = result;
    const before = analyses[page];
    setPenStates(current => {
      const next = {...current};
      Object.entries(preview.base?.penStates ?? {}).forEach(([id, state]) => {
        if (next[id]?.status !== 'recognizing') {
          next[id] = state;
        }
      });
      return next;
    });
    if (reused) {
      return;
    }
    if (before?.state === 'read') {
      const oldIds = new Set(before.preview.operations.map(operation => operation.id));
      setPlainShifts(current =>
        Object.fromEntries(Object.entries(current).filter(([id]) => !oldIds.has(id))),
      );
    }
    setAnalyses(current => ({...current, [page]: {state: 'read', preview}}));
    if (listChanged(before, preview)) {
      setStatus({text: `Page ${page + 1} changed since it was read: its list is updated.`});
    }
  };

  // Re-assembled whenever a pen edit's text arrives or changes; no new measuring. An unclear mark
  // the user made a change of with Here goes from To decide to the changes.
  const pages = useMemo(() => {
    const assembled: Record<number, PageReview> = {};
    for (const [key, review] of Object.entries(analyses)) {
      const page = Number(key);
      const base = review.state === 'read' ? review.preview.base : null;
      if (review.state !== 'read' || !base) {
        assembled[page] = review;
        continue;
      }
      const made = chosen[page] ?? {};
      const extra = base.toDecide.flatMap(item => {
        const option = made[item.key];
        const draft = option === undefined ? null : item.options?.[option]?.draft;
        return draft ? [draft] : [];
      });
      assembled[page] = {
        state: 'read',
        preview: assembleMarkerPreview(
          extra.length > 0
            ? {...base, drafts: [...base.drafts, ...extra], toDecide: base.toDecide.filter(item => made[item.key] === undefined)}
            : base,
          penStates,
          review.preview.fontWarning,
          plainShifts,
          swapOptions,
        ),
      };
    }
    return assembled;
  }, [analyses, chosen, penStates, plainShifts, swapOptions]);
  const view = useMemo(() => combinePages(pages), [pages]);

  // Status: the font warning of a page read, unless something else is said.
  const shownStatus = status ?? (view.fontWarning ? {text: view.fontWarning} : null);

  const updatePenState = useCallback((id: string, state: PenTextState) => {
    setPenStates(current => ({...current, [id]: state}));
  }, []);

  // The pen edits of every read page, page by page, and the page each is on.
  const penPages = useMemo(() => {
    const result = new Map<string, number>();
    for (const page of readPageList(analyses)) {
      const review = analyses[page];
      if (review.state === 'read') {
        review.preview.penEdits.forEach(penEdit => result.set(penEdit.id, page));
      }
    }
    return result;
  }, [analyses]);
  const penOrder = useMemo(() => [...penPages.keys()], [penPages]);
  usePenRecognitionQueue(penOrder, selectedPenId, penStates, penPages, busy || loading, updatePenState);

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
      stop()
        .then(() => startSelectMark(id, 'review'))
        .then(onDone)
        .catch(error => {
          console.warn('[Manuscript] select mark not stored', String(error));
          setStatus({kind: 'error', text: 'Could not remember the text for Select mark. Please try again.'});
        });
    },
    [busy, loading, stop],
  );

  /**
   * Reads every page read so far again (after a calibration change, an apply or a drop); with
   * `reuse`, pages whose fingerprint is unchanged keep their analysis.
   */
  const rereadAll = useCallback(
    async (keepStatus = false, reuse = true) => {
      await stop();
      clearMarkerDiagnostics();
      setPlainShifts({});
      setSwapOptions({});
      setChosen({});
      return read(readPageList(analyses), keepStatus, reuse);
    },
    [analyses, read, stop],
  );

  const readPages = useCallback(
    (list: number[]) => {
      if (!loading && !busy) {
        // A foreground read waits for the page being checked; the checks go on after it.
        void pause()
          .then(() => read(list))
          .finally(resume);
      }
    },
    [busy, loading, pause, read, resume],
  );

  const recheckPage = useCallback(
    (page: number) => {
      if (!busy && analyses[page]?.state === 'read') {
        enqueue([page], true);
      }
    },
    [analyses, busy, enqueue],
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
      void rereadAll();
    },
    [busy, loading, rereadAll],
  );

  const resetCalibration = useCallback(() => {
    if (loading || busy) {
      return;
    }
    remember(resetEditMarkerCalibration());
    void rereadAll();
  }, [busy, loading, rereadAll]);

  const refresh = useCallback(() => {
    if (!loading && !busy) {
      void rereadAll(false, false);
    }
  }, [busy, loading, rereadAll]);

  const recheck = useCallback(() => {
    if (!loading && !busy) {
      void rereadAll(false, true);
    }
  }, [busy, loading, rereadAll]);

  const timings = useTimingsExport(setStatus);

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
    if (view.plans.length === 0 || loading || busy) {
      return;
    }
    setBusy(true);
    const appliedPages = view.plans.map(plan => plan.page);
    const notePath = noteRef.current?.notePath;
    stop()
      .then(() =>
        timed(
          'review.apply',
          () =>
            applyMarkerPlans(view.plans, {
              onProgress: update => setStatus({text: update.message}),
              leftForLater: view.pendingCount,
            }),
          {pages: appliedPages.length, edits: view.readyCount},
        ),
      )
      .then(async result => {
        if (notePath) {
          forgetPages(notePath, appliedPages);
        }
        setApplied(true);
        setStatus({text: `${result.message} Backup: ${fileNameOf(result.backupPath)}`});
        await rereadAll(true);
      })
      .catch(error => {
        console.warn('[Manuscript] apply failed', String(error));
        setStatus({kind: 'error', text: userMessage(error, 'The changes could not be applied.')});
      })
      .finally(() => setBusy(false));
  }, [busy, loading, rereadAll, stop, view]);

  const drop = useCallback(
    (page: number, items: DropItem[], eraseHandwriting: boolean) => {
      const review = pages[page];
      if (review?.state !== 'read' || loading || busy || items.length === 0) {
        return;
      }
      setBusy(true);
      setStatus({text: eraseHandwriting ? 'Writing the backup…' : 'Dropping…'});
      stop()
        .then(() =>
          timed('review.drop', () => dropItems(review.preview, items, eraseHandwriting), {
            page,
            items: items.length,
          }),
        )
        .then(async result => {
          setStatus({text: result.message});
          forgetPages(review.preview.base?.notePath ?? noteRef.current?.notePath ?? '', [page]);
          await read([page], true);
        })
        .catch(error => {
          console.warn('[Manuscript] drop failed', String(error));
          setStatus({kind: 'error', text: userMessage(error, 'Could not drop them from the page.')});
        })
        .finally(() => setBusy(false));
    },
    [busy, loading, pages, read, stop],
  );

  const setRowOption = useCallback(
    (operationId: string, change: RowOptions[string]) => {
      if (!busy && !applied) {
        setSwapOptions(current => ({...current, [operationId]: {...current[operationId], ...change}}));
      }
    },
    [applied, busy],
  );
  const setFixCase = useCallback(
    (operationId: string, fixCase: boolean) => setRowOption(operationId, {fixCase}),
    [setRowOption],
  );
  const setRemovePunct = useCallback(
    (operationId: string, removePunct: boolean) => setRowOption(operationId, {removePunct}),
    [setRowOption],
  );
  const setPunctChar = useCallback(
    (operationId: string, char: PunctuationChar) => setRowOption(operationId, {char}),
    [setRowOption],
  );

  /** Stores something about a page's pen edit or marks, then reads the page again. */
  const storeAndReread = useCallback(
    (page: number, write: () => Promise<void>, failure: string) => {
      if (loading || busy || applied) {
        return;
      }
      setBusy(true);
      stop()
        .then(write)
        .then(async () => {
          forgetPages(noteRef.current?.notePath ?? '', [page]);
          await read([page], true);
        })
        .catch(error => {
          console.warn('[Manuscript] not stored', String(error));
          setStatus({kind: 'error', text: failure});
        })
        .finally(() => setBusy(false));
    },
    [applied, busy, loading, read, stop],
  );

  const placeHere = useCallback(
    (page: number, id: string) =>
      storeAndReread(page, () => placePenEditHere(id), 'Could not store "Insert right here". Please try again.'),
    [storeAndReread],
  );

  const here = useCallback(
    (page: number, item: ToDecideItem, edges: EdgeShift | null, option?: number) => {
      const penId = item.penEditId;
      if (penId) {
        storeAndReread(
          page,
          async () => {
            await setPenEditEdges(penId, edges);
            await confirmPenEditPlace(penId);
          },
          'Could not store the place. Please try again.',
        );
        return;
      }
      const draft = option === undefined ? null : item.options?.[option]?.draft;
      if (!draft || busy || applied) {
        return;
      }
      setChosen(current => ({...current, [page]: {...current[page], [item.key]: option as number}}));
      if (edges && edges.length > 0) {
        setPlainShifts(current => ({...current, [draft.operation.id]: edges}));
      }
    },
    [applied, busy, storeAndReread],
  );

  const ignore = useCallback(
    (page: number, item: ToDecideItem) => {
      const notePath = noteRef.current?.notePath;
      const key = item.ignore;
      if (notePath && key) {
        storeAndReread(page, () => rememberIgnored(notePath, page, key), 'Could not remember Ignore. Please try again.');
      }
    },
    [storeAndReread],
  );

  return {
    note,
    pages,
    here,
    ignore,
    view,
    readPages,
    recheckPage,
    checking: checks.checking,
    drop,
    nudge,
    setFixCase,
    setRemovePunct,
    setPunctChar,
    placeHere,
    loading,
    busy,
    applied,
    status: shownStatus,
    calibration,
    changeCalibration,
    resetCalibration,
    refresh,
    recheck,
    saveDiagnostics,
    timings,
    apply,
    setSelectedPenEdit: setSelectedPenId,
    recognizeAgain,
    correct,
    selectMark,
    penStates,
  };
}
