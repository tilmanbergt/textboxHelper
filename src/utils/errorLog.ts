/**
 * The session's errors and warnings for Report a problem (technical-design-release-readiness.md
 * §4.2). `installErrorCapture()` (index.js) passes every console.error and console.warn on to the
 * console as before and keeps a copy in a ring of the newest 50, in memory only; the error
 * boundary adds screen crashes with `recordCrash`.
 */
import {createErrorRing, errorEntryFromCrash, errorEntryFromLog, type ErrorEntry} from '../domain/errorRing';

export const sessionErrors = createErrorRing(50);

let installed = false;

export function installErrorCapture(): void {
  if (installed) {
    return;
  }
  installed = true;
  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      try {
        sessionErrors.add(errorEntryFromLog(level, args, new Date().toISOString()));
      } catch {
        // Recording must never break logging.
      }
      original(...args);
    };
  }
}

export function recordCrash(error: unknown, componentStack?: string | null): void {
  sessionErrors.add(errorEntryFromCrash(error, componentStack, new Date().toISOString()));
}

export function sessionErrorSnapshot(): {entries: ErrorEntry[]; droppedCount: number} {
  return {entries: sessionErrors.entries(), droppedCount: sessionErrors.droppedCount()};
}
