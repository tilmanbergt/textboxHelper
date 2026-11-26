/**
 * A bounded in-memory record of how long the plugin's steps take (technical-design-manuscript-cache.md
 * §6): page reads and their analysis steps, recognition, applies, the Outline scan. Kept across card
 * openings until cleared, and written to a file only when the user asks (Report a problem in Settings → Diagnostics).
 * When the limit is reached, further entries are counted but not kept. Pure.
 */

export type PerfEntry = {
  /** Milliseconds since the log was last cleared. */
  atMs: number;
  stage: string;
  /** Duration; null for an event (a cache hit, the card opening). */
  ms: number | null;
  page?: number;
  detail?: Record<string, unknown>;
};

export type PerfStageSummary = {
  stage: string;
  count: number;
  totalMs: number;
  medianMs: number;
  maxMs: number;
};

export type PerfLog = {
  clear: () => void;
  add: (entry: Omit<PerfEntry, 'atMs'>) => void;
  entries: () => PerfEntry[];
  droppedCount: () => number;
};

export function createPerfLog(maxEntries: number, now: () => number = Date.now): PerfLog {
  let entries: PerfEntry[] = [];
  let dropped = 0;
  let started = now();
  return {
    clear() {
      entries = [];
      dropped = 0;
      started = now();
    },
    add(entry) {
      if (entries.length >= maxEntries) {
        dropped += 1;
        return;
      }
      entries.push({atMs: now() - started, ...entry});
    },
    entries: () => [...entries],
    droppedCount: () => dropped,
  };
}

/** Per stage, in the order the stages first appear: count, total, median and longest time. */
export function summarizePerf(entries: PerfEntry[]): PerfStageSummary[] {
  const byStage = new Map<string, number[]>();
  for (const entry of entries) {
    if (entry.ms === null) {
      continue;
    }
    const list = byStage.get(entry.stage) ?? [];
    list.push(entry.ms);
    byStage.set(entry.stage, list);
  }
  return [...byStage].map(([stage, times]) => {
    const sorted = [...times].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    return {
      stage,
      count: times.length,
      totalMs: round(times.reduce((sum, ms) => sum + ms, 0)),
      medianMs: round(median),
      maxMs: round(sorted[sorted.length - 1]),
    };
  });
}

/** How many times each event (an entry without a duration) happened. */
export function countEvents(entries: PerfEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    if (entry.ms === null) {
      counts[entry.stage] = (counts[entry.stage] ?? 0) + 1;
    }
  }
  return counts;
}

const round = (ms: number) => Math.round(ms * 10) / 10;
