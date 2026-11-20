/**
 * State of the Manuscript card's Outline (technical-design-manuscript.md §5, §5.6): the note's
 * textboxes as blocks, read with the export scan when the tab opens, their statuses (kept in the
 * plugin), the edits the Review lists on them, the filter and the selected block. A status change
 * writes at once; a block's first status gives its textbox a block tag. Moves, set aside and
 * delete are planned and applied together; after every change of the plan the touched pages are
 * checked for what is in the way.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {setBlockStatus} from '../../actions/blockStatus';
import {
  applyOutlinePlan,
  checkRebuild,
  type RebuildCheck,
} from '../../actions/outlineApply';
import {scanTextBoxes} from '../../actions/textboxScan';
import {formatBlockTag} from '../../domain/blockTag';
import type {ScannedTextBox} from '../../domain/exportClassification';
import {unreadPages, type PageReview} from '../../domain/manuscriptPages';
import {
  buildOutline,
  type BlockStatus,
  type OutlineBlock,
} from '../../domain/outlineModel';
import {
  plannedOrder,
  undoFor,
  undoLast,
  type MoveTarget,
  type PlannedChange,
  type PlannedOrder,
} from '../../domain/outlinePlan';
import {fileNameOf, userMessage} from '../../domain/userMessage';
import {readBlockStatuses} from '../../storage/blockStatusStore';
import {getSettings} from '../../storage/settingsFile';
import type {NoteInfo} from '../../supernote/noteElements';
import type {FrameStatus} from '../../ui/ScreenFrame';

export interface Outline {
  blocks: OutlineBlock[] | null;
  loading: boolean;
  busy: boolean;
  status: FrameStatus | null;
  selectedKey: string | null;
  select: (key: string) => void;
  load: () => void;
  /** Forgets the blocks read and the plan; the tab reads them again when it opens (after a Review apply). */
  clear: () => void;
  setStatus: (block: OutlineBlock, status: BlockStatus) => void;
  plan: PlannedChange[];
  planned: PlannedOrder | null;
  /** What the touched pages hold in the way of the plan; null while it is checked or there's no plan. */
  check: RebuildCheck | null;
  checking: boolean;
  move: (key: string, before: MoveTarget) => void;
  setAside: (key: string) => void;
  remove: (key: string) => void;
  undo: (key: string) => void;
  undoLastChange: () => void;
  apply: () => void;
  /** True once the plan was applied: the card's button closes it. */
  applied: boolean;
}

export function useOutline(
  note: NoteInfo | null,
  pages: Record<number, PageReview>,
): Outline {
  const notePath = note?.notePath ?? null;
  const [items, setItems] = useState<ScannedTextBox[] | null>(null);
  const [statuses, setStatuses] = useState<Record<string, BlockStatus>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setFrameStatus] = useState<FrameStatus | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlannedChange[]>([]);
  const [check, setCheck] = useState<RebuildCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [applied, setApplied] = useState(false);

  const load = useCallback(() => {
    if (!notePath || loading) {
      return;
    }
    setLoading(true);
    setFrameStatus({text: 'Reading the outline…'});
    Promise.all([
      scanTextBoxes({
        notePath,
        currentPage: null,
        scope: 'wholeNote',
        config: getSettings().export.rules,
      }),
      readBlockStatuses(),
    ])
      .then(([scan, stored]) => {
        setItems(scan.items);
        setStatuses(stored);
        setFrameStatus(null);
      })
      .catch(error => {
        console.warn('[Outline] not read', String(error));
        setFrameStatus({
          kind: 'error',
          text: userMessage(error, 'Could not read the outline.'),
        });
      })
      .finally(() => setLoading(false));
  }, [loading, notePath]);

  const blocks = useMemo(
    () => (items ? buildOutline(items, statuses, pages) : null),
    [items, pages, statuses],
  );
  const planned = useMemo(
    () => (blocks && plan.length > 0 ? plannedOrder(blocks, plan) : null),
    [blocks, plan],
  );

  // The Review's knowledge of the pages: edits waiting on each, and pages not read yet.
  const pageCount = note?.pageCount ?? 0;
  const reviewPages = useMemo(() => {
    const pendingByPage = new Map<number, number>();
    for (const [page, review] of Object.entries(pages)) {
      if (review.state === 'read') {
        pendingByPage.set(Number(page), review.preview.operations.length);
      }
    }
    return {pendingByPage, unread: unreadPages(pageCount, pages)};
  }, [pageCount, pages]);

  // Every change of the plan, or of what the Review knows: which pages it touches, and what is in
  // the way there. Pen text being recognized doesn't count, so it doesn't read the pages again.
  const latest = useRef({blocks, planned, reviewPages});
  latest.current = {blocks, planned, reviewPages};
  const checkKey = planned
    ? JSON.stringify([
        plan,
        items?.length,
        [...reviewPages.pendingByPage],
        reviewPages.unread,
      ])
    : '';
  useEffect(() => {
    const {
      blocks: current,
      planned: currentPlan,
      reviewPages: currentPages,
    } = latest.current;
    if (!notePath || !current || !currentPlan || !checkKey) {
      setCheck(null);
      return;
    }
    let alive = true;
    setChecking(true);
    checkRebuild(notePath, pageCount, current, currentPlan, currentPages)
      .then(result => alive && setCheck(result))
      .catch(error => {
        console.warn('[Outline] check failed', String(error));
        if (alive) {
          setCheck(null);
          setFrameStatus({
            kind: 'error',
            text: userMessage(
              error,
              'Could not check the pages for the changes.',
            ),
          });
        }
      })
      .finally(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, [checkKey, notePath, pageCount]);

  const change = useCallback((next: PlannedChange) => {
    setPlan(current => [...undoFor(current, next.key), next]);
  }, []);

  const apply = useCallback(() => {
    if (
      !notePath ||
      !blocks ||
      !planned ||
      !check ||
      check.blockers.length > 0 ||
      busy
    ) {
      return;
    }
    setBusy(true);
    applyOutlinePlan(notePath, pageCount, blocks, planned, check, message =>
      setFrameStatus({text: message}),
    )
      .then(result => {
        setApplied(true);
        setPlan([]);
        setItems(null);
        setFrameStatus({
          text: `${result.message} Backup: ${fileNameOf(result.backupPath)}`,
        });
      })
      .catch(error => {
        console.warn('[Outline] apply failed', String(error));
        setFrameStatus({
          kind: 'error',
          text: userMessage(error, 'The changes could not be applied.'),
        });
      })
      .finally(() => setBusy(false));
  }, [blocks, busy, check, notePath, pageCount, planned]);

  const setStatus = useCallback(
    (block: OutlineBlock, next: BlockStatus) => {
      if (!notePath || busy || block.status === next) {
        return;
      }
      setBusy(true);
      setBlockStatus(notePath, block, next)
        .then(({id, statuses: stored}) => {
          setStatuses(stored);
          if (!block.tagId) {
            // The textbox carries its new tag now: the block's key becomes its id.
            setItems(current =>
              (current ?? []).map(item =>
                item.page === block.page && item.numInPage === block.numInPage
                  ? {...item, userData: formatBlockTag({v: 1, id})}
                  : item,
              ),
            );
            setSelectedKey(id);
          }
        })
        .catch(error => {
          console.warn('[Outline] status not set', String(error));
          setFrameStatus({
            kind: 'error',
            text: userMessage(error, 'Could not set the status.'),
          });
        })
        .finally(() => setBusy(false));
    },
    [busy, notePath],
  );

  return {
    blocks,
    loading,
    busy,
    status,
    selectedKey,
    select: setSelectedKey,
    load,
    clear: useCallback(() => {
      setItems(null);
      setPlan([]);
    }, []),
    setStatus,
    plan,
    planned,
    check,
    checking,
    move: useCallback(
      (key: string, before: MoveTarget) => change({kind: 'move', key, before}),
      [change],
    ),
    setAside: useCallback(
      (key: string) => change({kind: 'aside', key}),
      [change],
    ),
    remove: useCallback(
      (key: string) => change({kind: 'delete', key}),
      [change],
    ),
    undo: useCallback(
      (key: string) => setPlan(current => undoFor(current, key)),
      [],
    ),
    undoLastChange: useCallback(
      () => setPlan(current => undoLast(current)),
      [],
    ),
    apply,
    applied,
  };
}
