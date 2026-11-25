/**
 * The errors of this plugin session, for Report a problem (technical-design-release-readiness.md
 * §4.2): a ring of the newest entries in memory, never written to disk by itself. Entries carry
 * what the plugin logs anyway (module prefix, message, a shortened stack), cut to a fixed length.
 */
export type ErrorEntry = {
  /** ISO time. */
  at: string;
  /** "error" for console.error and crashes, "warn" for console.warn. */
  level: 'error' | 'warn';
  /** The `[Module]` prefix of the log line, or "screen" for a crash caught by the error boundary. */
  module: string;
  message: string;
  stack?: string;
};

export type ErrorRing = {
  add: (entry: ErrorEntry) => void;
  /** Oldest first. */
  entries: () => ErrorEntry[];
  /** How many entries were pushed out of the ring since the plugin started. */
  droppedCount: () => number;
};

export const MAX_MESSAGE = 500;
export const MAX_STACK = 1500;

export function createErrorRing(size = 50): ErrorRing {
  const ring: ErrorEntry[] = [];
  let dropped = 0;
  return {
    add(entry) {
      ring.push(entry);
      if (ring.length > size) {
        ring.shift();
        dropped += 1;
      }
    },
    entries: () => [...ring],
    droppedCount: () => dropped,
  };
}

/** A log call's arguments as one entry: "[Module] text" first, the rest joined. Never throws. */
export function errorEntryFromLog(level: ErrorEntry['level'], args: unknown[], at: string): ErrorEntry {
  const parts = args.map(describe);
  const first = parts[0] ?? '';
  const prefix = /^\[([^\]]+)\]\s*/.exec(first);
  const module = prefix ? prefix[1] : '';
  const rest = [prefix ? first.slice(prefix[0].length) : first, ...parts.slice(1)].filter(Boolean).join(' ');
  const errorArg = args.find((a): a is Error => a instanceof Error);
  const entry: ErrorEntry = {at, level, module, message: cut(rest, MAX_MESSAGE)};
  if (errorArg?.stack) {
    entry.stack = cut(errorArg.stack, MAX_STACK);
  }
  return entry;
}

/** An error caught by a screen's error boundary. */
export function errorEntryFromCrash(error: unknown, componentStack: string | null | undefined, at: string): ErrorEntry {
  const stack = [error instanceof Error ? error.stack : '', componentStack ?? ''].filter(Boolean).join('\n');
  return {
    at,
    level: 'error',
    module: 'screen',
    message: cut(describe(error), MAX_MESSAGE),
    ...(stack ? {stack: cut(stack, MAX_STACK)} : {}),
  };
}

function describe(value: unknown): string {
  try {
    if (value instanceof Error) {
      return `${value.name}: ${value.message}`;
    }
    if (typeof value === 'string') {
      return value;
    }
    if (value === undefined) {
      return 'undefined';
    }
    return JSON.stringify(value) ?? String(value);
  } catch {
    return '[unprintable]';
  }
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
