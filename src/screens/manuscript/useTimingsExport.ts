/**
 * Settings → Diagnostics → Speed (technical-design-manuscript-cache.md §6): how many timings are recorded and
 * Clear. Report a problem writes their summary (technical-design-release-readiness.md §4).
 */
import {useCallback, useState} from 'react';
import type {FrameStatus} from '../../ui/ScreenFrame';
import {clearPerf, perfSummaryLine} from '../../utils/perf';

export interface TimingsExport {
  /** "124 timings since 16:40." */
  summary: string;
  clear: () => void;
  /** Reads the summary line again (when the Diagnostics tab opens). */
  update: () => void;
}

export function useTimingsExport(setStatus: (status: FrameStatus | null) => void): TimingsExport {
  const [summary, setSummary] = useState(perfSummaryLine);
  const update = useCallback(() => setSummary(perfSummaryLine()), []);

  const clear = useCallback(() => {
    clearPerf();
    update();
    setStatus({text: 'Timings cleared.'});
  }, [setStatus, update]);

  return {summary, clear, update};
}
