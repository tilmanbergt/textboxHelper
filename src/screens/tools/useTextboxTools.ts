/**
 * State and flows of the lasso screen (technical-design-calmer-screens.md §3.5): reads the lasso
 * selection once, offers every action with its result, applies the chosen one, and runs "Log All
 * Textboxes" for Details. When exactly one action can be chosen, it is preselected.
 */
import {useCallback, useEffect, useState} from 'react';
import {getTextboxActionPreview, performTextboxAction} from '../../actions/textboxEdits';
import {ACTION_ORDER, ACTION_PROGRESS_LABELS, type TextboxActionKind} from '../../domain/textboxActionKinds';
import type {TextboxActionPreview} from '../../domain/textboxEditPlan';
import {fileNameOf, userMessage} from '../../domain/userMessage';
import type {FrameStatus} from '../../ui/ScreenFrame';

export type ScreenAction = (typeof ACTION_ORDER)[number];

export interface TextboxTools {
  preview: TextboxActionPreview | null;
  loading: boolean;
  busy: boolean;
  applied: boolean;
  action: ScreenAction | null;
  status: FrameStatus | null;
  logBlocks: string[] | null;
  select: (action: ScreenAction) => void;
  apply: () => void;
  logAll: () => void;
}

export function choosableActions(preview: TextboxActionPreview | null): ScreenAction[] {
  if (!preview) {
    return [];
  }
  return ACTION_ORDER.filter(action => !preview.reasons[action] && preview.afterBlocksByAction[action]);
}

export function useTextboxTools(): TextboxTools {
  const [preview, setPreview] = useState<TextboxActionPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [action, setAction] = useState<ScreenAction | null>(null);
  const [status, setStatus] = useState<FrameStatus | null>({text: 'Reading the lasso selection…'});
  const [logBlocks, setLogBlocks] = useState<string[] | null>(null);

  useEffect(() => {
    let active = true;
    getTextboxActionPreview()
      .then(next => {
        if (!active) {
          return;
        }
        setPreview(next);
        const choosable = choosableActions(next);
        setAction(choosable.length === 1 ? choosable[0] : null);
        setStatus(null);
      })
      .catch(error => {
        console.warn('[TextboxTools] preview failed', String(error));
        if (active) {
          setStatus({kind: 'error', text: userMessage(error, 'Could not read the lasso selection.')});
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const select = useCallback(
    (next: ScreenAction) => {
      if (!busy && !applied && choosableActions(preview).includes(next)) {
        setAction(next);
      }
    },
    [applied, busy, preview],
  );

  const run = useCallback(
    (kind: TextboxActionKind, onDone: (message: string, backupPath: string, blocks?: string[]) => void) => {
      setBusy(true);
      setStatus({text: ACTION_PROGRESS_LABELS[kind]});
      performTextboxAction(kind, {
        onProgress: update => setStatus({text: update.message}),
      })
        .then(result => onDone(result.message, result.backupPath, result.previewBlocks))
        .catch(error => {
          console.warn('[TextboxTools] action failed', kind, String(error));
          setStatus({kind: 'error', text: userMessage(error, 'The action could not be applied.')});
        })
        .finally(() => setBusy(false));
    },
    [],
  );

  const apply = useCallback(() => {
    if (!action || busy || applied) {
      return;
    }
    run(action, (message, backupPath) => {
      setApplied(true);
      setStatus({text: backupPath ? `${message} Backup: ${fileNameOf(backupPath)}` : message});
    });
  }, [action, applied, busy, run]);

  const logAll = useCallback(() => {
    if (busy) {
      return;
    }
    run('log', (message, _backupPath, blocks) => {
      setLogBlocks(blocks ?? []);
      setStatus({text: message});
    });
  }, [busy, run]);

  return {preview, loading, busy, applied, action, status, logBlocks, select, apply, logAll};
}
