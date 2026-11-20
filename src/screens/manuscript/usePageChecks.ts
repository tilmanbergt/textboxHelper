/**
 * The Manuscript card's background checks (technical-design-manuscript-cache.md §4): pages read
 * before are shown from the cache and checked again here, one at a time, without blocking the card.
 * A page whose fingerprint is unchanged keeps its analysis; a changed one is read again. Anything
 * that writes (or reads in the foreground) first waits for the page being checked (`pause`, `stop`),
 * so the SDK never reads and writes at the same time.
 */
import {useCallback, useEffect, useRef, useState} from 'react';
import {readMarkerPage, type MarkerPageRead} from '../../actions/markerPageAnalysis';

export interface PageChecks {
  /** Pages waiting to be checked or being checked (their chips are faint). */
  checking: number[];
  /** Adds pages to the queue; `first` puts them at its front (a tapped chip). */
  enqueue: (pages: number[], first?: boolean) => void;
  /** Waits for the page being checked, then holds the queue until `resume`. */
  pause: () => Promise<void>;
  resume: () => void;
  /** Waits for the page being checked and empties the queue. */
  stop: () => Promise<void>;
}

export function usePageChecks(
  /** The open note's path, read when a check runs (it is known only once the card has read it). */
  notePathOf: () => string | null,
  onChecked: (page: number, read: MarkerPageRead) => void,
  onFailed: (page: number, error: unknown) => void,
): PageChecks {
  const [checking, setChecking] = useState<number[]>([]);
  const queue = useRef<number[]>([]);
  const running = useRef<Promise<void> | null>(null);
  const paused = useRef(false);
  const alive = useRef(true);
  const handlers = useRef({onChecked, onFailed, notePathOf});
  handlers.current = {onChecked, onFailed, notePathOf};

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      queue.current = [];
    };
  }, []);

  const show = () => alive.current && setChecking([...queue.current]);

  const run = useCallback(() => {
    const notePath = handlers.current.notePathOf();
    if (running.current || paused.current || !notePath) {
      return;
    }
    running.current = (async () => {
      while (queue.current.length > 0 && !paused.current && alive.current) {
        const page = queue.current[0];
        try {
          const read = await readMarkerPage(notePath, page, {reuse: true});
          if (alive.current) {
            handlers.current.onChecked(page, read);
          }
        } catch (error) {
          console.warn('[Manuscript] page not checked', page, String(error));
          if (alive.current) {
            handlers.current.onFailed(page, error);
          }
        }
        queue.current = queue.current.filter(item => item !== page);
        show();
      }
      running.current = null;
    })();
  }, []);

  const enqueue = useCallback(
    (pages: number[], first = false) => {
      const rest = queue.current.filter(page => !pages.includes(page));
      // The page being checked stays where it is (it is read already).
      queue.current = first && rest.length > 0 && running.current
        ? [rest[0], ...pages.filter(page => page !== rest[0]), ...rest.slice(1)]
        : first
        ? [...pages, ...rest]
        : [...rest, ...pages];
      show();
      run();
    },
    [run],
  );

  const pause = useCallback(async () => {
    paused.current = true;
    await running.current;
  }, []);

  const resume = useCallback(() => {
    paused.current = false;
    run();
  }, [run]);

  const stop = useCallback(async () => {
    paused.current = true;
    queue.current = [];
    await running.current;
    show();
    paused.current = false;
  }, []);

  return {checking, enqueue, pause, resume, stop};
}
