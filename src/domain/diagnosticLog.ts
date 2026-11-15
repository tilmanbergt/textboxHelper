/**
 * A bounded in-memory record of diagnostic log entries for one run of a feature (for example one
 * edit-marker preview). The entries are written to a file only when the user asks for it, so a
 * run's full trace can be read without `adb logcat`.
 *
 * When the limit is reached, further entries are counted but not kept, so the start of a run -
 * usually the most telling part - survives.
 */

export type DiagnosticEntry = {
  /** Milliseconds since the log was last cleared. */
  atMs: number;
  stage: string;
  payload?: unknown;
};

export type DiagnosticSnapshot = {
  entries: DiagnosticEntry[];
  droppedCount: number;
};

export type DiagnosticLog = {
  clear: () => void;
  add: (stage: string, payload?: unknown) => void;
  snapshot: () => DiagnosticSnapshot;
};

export function createDiagnosticLog(maxEntries: number, now: () => number = Date.now): DiagnosticLog {
  let entries: DiagnosticEntry[] = [];
  let droppedCount = 0;
  let startedAt = now();

  return {
    clear() {
      entries = [];
      droppedCount = 0;
      startedAt = now();
    },
    add(stage, payload) {
      if (entries.length >= maxEntries) {
        droppedCount += 1;
        return;
      }
      entries.push(
        payload === undefined
          ? {atMs: now() - startedAt, stage}
          : {atMs: now() - startedAt, stage, payload},
      );
    },
    snapshot() {
      return {entries: [...entries], droppedCount};
    },
  };
}
