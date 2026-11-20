/**
 * Recognizes the review's pen edits while the screen is open (technical-design-pen-edits.md §3.6):
 * one at a time, the selected one first, then the others in list order (page by page). Nothing runs while the
 * changes are being applied, and a running recognition is cancelled when the screen closes, so
 * recognition never competes with writing in the note.
 */
import {useEffect, useRef} from 'react';
import {recognizePenEdit} from '../../actions/penEditReview';
import type {PenTextState} from '../../domain/markerTypes';
import {cancelRecognition} from '../../supernote/strokeRecognition';

export function usePenRecognitionQueue(
  order: string[],
  selectedId: string | null,
  states: Record<string, PenTextState>,
  /** The page each pen edit is on. */
  pageOf: Map<string, number>,
  paused: boolean,
  onState: (id: string, state: PenTextState) => void,
): void {
  const running = useRef<string | null>(null);
  const mounted = useRef(true);
  const onStateRef = useRef(onState);
  onStateRef.current = onState;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (running.current) {
        void cancelRecognition();
      }
    };
  }, []);

  useEffect(() => {
    if (paused || running.current) {
      return;
    }
    const queue = selectedId && order.includes(selectedId) ? [selectedId, ...order.filter(id => id !== selectedId)] : order;
    const next = queue.find(id => states[id]?.status === 'waiting');
    const page = next ? pageOf.get(next) : undefined;
    if (!next || page === undefined) {
      return;
    }
    const before = states[next];
    running.current = next;
    onStateRef.current(next, {...before, status: 'recognizing'});
    recognizePenEdit(next, page)
      .then(result => {
        running.current = null;
        if (mounted.current) {
          onStateRef.current(next, result ?? {...before, status: 'failed', text: ''});
        }
      })
      .catch(error => {
        running.current = null;
        console.warn('[PenRecognitionQueue] failed', String(error));
        if (mounted.current) {
          onStateRef.current(next, {...before, status: 'failed', text: ''});
        }
      });
  }, [order, pageOf, paused, selectedId, states]);
}
