import {createPerfLog, type PerfEntry} from '../domain/perfLog';

/**
 * The plugin's timings (technical-design-manuscript-cache.md §6): one log for the whole run of the
 * plugin's JS, kept across card openings; saved to EXPORT by `actions/timingsExport.ts`.
 */

const clock: () => number =
  typeof globalThis.performance?.now === 'function' ? () => globalThis.performance.now() : Date.now;

/** When this module was loaded: how long the plugin's JS has been running (does it survive?). */
const loadedAt = Date.now();

export const perfLog = createPerfLog(3000, clock);
/** Wall-clock time of the last clear (the log itself counts in `clock` time). */
let recordingSince = Date.now();

export function clearPerf(): void {
  perfLog.clear();
  recordingSince = Date.now();
}

type Detail = {page?: number} & Record<string, unknown>;

function entry(stage: string, ms: number | null, detail?: Detail): Omit<PerfEntry, 'atMs'> {
  if (!detail) {
    return {stage, ms};
  }
  const {page, ...rest} = detail;
  return {
    stage,
    ms,
    ...(page === undefined ? {} : {page}),
    ...(Object.keys(rest).length > 0 ? {detail: rest} : {}),
  };
}

/** Runs `work` and records how long it took (also when it fails). */
export async function timed<T>(stage: string, work: () => Promise<T>, detail?: Detail): Promise<T> {
  const start = clock();
  let ok = true;
  try {
    return await work();
  } catch (error) {
    ok = false;
    throw error;
  } finally {
    perfLog.add(entry(stage, clock() - start, ok ? detail : {...detail, failed: true}));
  }
}

/** Starts a measurement that is ended later (`end` may add details known only then). */
export function startTiming(stage: string, detail?: Detail): (more?: Record<string, unknown>) => void {
  const start = clock();
  let ended = false;
  return more => {
    if (!ended) {
      ended = true;
      perfLog.add(entry(stage, clock() - start, {...detail, ...more}));
    }
  };
}

/** Records something that happened, without a duration (a cache hit, the card opening). */
export function perfEvent(stage: string, detail?: Detail): void {
  perfLog.add(entry(stage, null, detail));
}

/** "124 timings since 16:40" for Settings → Diagnostics. */
export function perfSummaryLine(): string {
  const count = perfLog.entries().length;
  const since = new Date(recordingSince);
  const time = `${String(since.getHours()).padStart(2, '0')}:${String(since.getMinutes()).padStart(2, '0')}`;
  return count === 0 ? 'No timings yet.' : `${count} timing${count === 1 ? '' : 's'} since ${time}.`;
}

/** When this module was loaded, for the timings file. */
export function jsContextAgeMs(): number {
  return Date.now() - loadedAt;
}

/** Wall-clock time of the last clear. */
export function recordingStartedAt(): number {
  return recordingSince;
}
