/**
 * Details → Speed (technical-design-manuscript-cache.md §6): how many timings are recorded, Save
 * timings (one JSON file in EXPORT, to hand over) and Clear.
 */
import {useCallback, useState} from 'react';
import {saveTimings} from '../../actions/timingsExport';
import {fileNameOf, userMessage} from '../../domain/userMessage';
import type {FrameStatus} from '../../ui/ScreenFrame';
import {clearPerf, perfSummaryLine} from '../../utils/perf';

export interface TimingsExport {
  /** "124 timings since 16:40." */
  summary: string;
  save: () => void;
  clear: () => void;
  /** Reads the summary line again (when Details opens). */
  update: () => void;
}

export function useTimingsExport(setStatus: (status: FrameStatus | null) => void): TimingsExport {
  const [summary, setSummary] = useState(perfSummaryLine);
  const update = useCallback(() => setSummary(perfSummaryLine()), []);

  const save = useCallback(() => {
    saveTimings()
      .then(path => setStatus({text: `Timings saved to EXPORT: ${fileNameOf(path)}`}))
      .catch(error => {
        console.warn('[Manuscript] timings not saved', String(error));
        setStatus({kind: 'error', text: userMessage(error, 'Could not save the timings.')});
      })
      .finally(update);
  }, [setStatus, update]);

  const clear = useCallback(() => {
    clearPerf();
    update();
    setStatus({text: 'Timings cleared.'});
  }, [setStatus, update]);

  return {summary, save, clear, update};
}
