/**
 * State of the Manuscript card's Outline (technical-design-manuscript.md §5, §5.6): the note's
 * textboxes as blocks, read with the export scan when the tab opens, their statuses (kept in the
 * plugin), the edits the Review lists on them, the filter and the selected block. A status change
 * writes at once; a block's first status gives its textbox a block tag. Moves, set aside and
 * delete are planned and applied together; after every change of the plan the touched pages are
 * checked for what is in the way.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {setBlockStatus} from '../../../actions/blockStatus';
import {cachedOutline, forgetOutline, rememberOutline} from '../../../actions/manuscriptCache';
import {applyCleanup, checkCleanup, type CleanupCheck} from '../../../actions/cleanupApply';
import {
  applyOutlinePlan,
  checkRebuild,
  type RebuildCheck,
} from '../../../actions/outlineApply';
import type {CleanupScope} from '../../../domain/cleanupLayout';
import {scanTextBoxes} from '../../../actions/textboxScan';
import {formatBlockTag} from '../../../domain/blockTag';
import type {ScannedTextBox} from '../../../domain/exportClassification';
import {unreadPages, type PageReview} from '../../../domain/manuscriptPages';
import {
  buildOutline,
  type BlockStatus,
  type OutlineBlock,
} from '../../../domain/outlineModel';
import {
  CLEANUP_KEY,
  plannedOrder,
  undoFor,
  undoLast,
  type MoveTarget,
  type PlannedChange,
  type PlannedOrder,
} from '../../../domain/outlinePlan';
import {headingLevelOf, type HeadingLevel} from '../../../domain/headingText';
import type {SourceRecord} from '../../../domain/sourceRecord';
import {fileNameOf, userMessage} from '../../../domain/userMessage';
import {readBlockStatuses} from '../../../storage/blockStatusStore';
import {getSettings} from '../../../storage/settingsFile';
import type {NoteInfo} from '../../../supernote/noteElements';
import type {FrameStatus} from '../../../ui/ScreenFrame';
import {perfEvent, timed} from '../../../utils/perf';

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
  check: RebuildCheck | CleanupCheck | null;
  checking: boolean;
  move: (key: string, before: MoveTarget) => void;
  /** Plans a heading level (0: a paragraph); with its subheadings shifting along, or alone. */
  setLevel: (key: string, level: 0 | HeadingLevel, withSubheadings: boolean) => void;
  setAside: (key: string) => void;
  remove: (key: string) => void;
  /** Plans Clean up layout of the whole note or one file (technical-design-settings-layout-files.md §2). */
  cleanUp: (scope: CleanupScope) => void;
  undo: (key: string) => void;
  undoLastChange: () => void;
  apply: () => void;
  /** True once the plan was applied: the card's button closes it. */
  applied: boolean;
}

export function useOutline(
  note: NoteInfo | null,
  pages: Record<number, PageReview>,
  /** The linked files' records: headings of notes linked before keep their level by them. */
  records: SourceRecord[] = [],
): Outline {
  const notePath = note?.notePath ?? null;
  const [items, setItems] = useState<ScannedTextBox[] | null>(null);
  const [statuses, setStatuses] = useState<Record<string, BlockStatus>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setFrameStatus] = useState<FrameStatus | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlannedChange[]>([]);
  const [check, setCheck] = useState<RebuildCheck | CleanupCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [applied, setApplied] = useState(false);

  const pageCount = note?.pageCount ?? 0;
  const planRef = useRef(plan);
  planRef.current = plan;

  // A scan cached for this note shows at once and is checked by scanning again; the new scan
  // replaces it unless something is planned (technical-design-manuscript-cache.md §5).
  const scanning = useRef(false);
  const load = useCallback(() => {
    if (!notePath || loading || scanning.current) {
      return;
    }
    scanning.current = true;
    const cached = cachedOutline(notePath, pageCount);
    if (cached) {
      setItems(cached);
      perfEvent('outline.cacheShown', {blocks: cached.length});
    }
    setLoading(!cached);
    setFrameStatus({text: cached ? 'Checking the outline…' : 'Reading the outline…'});
    Promise.all([
      timed(
        'outline.scan',
        () =>
          scanTextBoxes({
            notePath,
            currentPage: null,
            scope: 'wholeNote',
            config: getSettings().export.rules,
          }),
        {pages: pageCount, cached: !!cached},
      ),
      readBlockStatuses(),
    ])
      .then(([scan, stored]) => {
        rememberOutline(notePath, pageCount, scan.items);
        setStatuses(stored);
        const changed = !cached || JSON.stringify(cached) !== JSON.stringify(scan.items);
        if (changed && cached && planRef.current.length > 0) {
          setFrameStatus({
            text: 'The note changed since the outline was read. Apply checks every page first.',
          });
          return;
        }
        setItems(scan.items);
        setFrameStatus(changed && cached ? {text: 'The note changed: the outline is updated.'} : null);
      })
      .catch(error => {
        console.warn('[Outline] not read', String(error));
        setFrameStatus({
          kind: 'error',
          text: userMessage(error, 'Could not read the outline.'),
        });
      })
      .finally(() => {
        scanning.current = false;
        setLoading(false);
      });
  }, [loading, notePath, pageCount]);

  const blocks = useMemo(() => {
    if (!items) {
      return null;
    }
    const bySource = new Map(records.map(record => [record.sourceId, record]));
    return buildOutline(items, statuses, pages, {
      defaultLevel: getSettings().outline.defaultHeadingLevel,
      // Records made before headings kept their #s hold a heading's text without them.
      recordLevel: tag => {
        const block = tag.s && Number.isInteger(tag.i) ? bySource.get(tag.s)?.blocks[tag.i as number] : undefined;
        return block?.role === 'heading' && headingLevelOf(block.text) === 0 ? block.level : null;
      },
    });
  }, [items, pages, records, statuses]);
  const planned = useMemo(
    () => (blocks && plan.length > 0 ? plannedOrder(blocks, plan) : null),
    [blocks, plan],
  );

  // The Review's knowledge of the pages: edits waiting on each, and pages not read yet.
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
    timed<RebuildCheck | CleanupCheck>('outline.check', () =>
      currentPlan.cleanup
        ? checkCleanup(notePath, pageCount, current, currentPlan, currentPages)
        : checkRebuild(notePath, pageCount, current, currentPlan, currentPages),
    )
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

  // A block's new change replaces its earlier one of the same sort: a level and a move go together.
  const change = useCallback((next: PlannedChange) => {
    const sameSort = (item: PlannedChange) => (item.kind === 'level') === (next.kind === 'level');
    setPlan(current => [...current.filter(item => item.key !== next.key || !sameSort(item)), next]);
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
    timed(
      'outline.apply',
      () => {
        const progress = (message: string) => setFrameStatus({text: message});
        return 'kind' in check
          ? applyCleanup(notePath, pageCount, blocks, planned, check, progress)
          : applyOutlinePlan(notePath, pageCount, blocks, planned, check, progress);
      },
      {changes: plan.length},
    )
      .then(result => {
        forgetOutline(notePath);
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
  }, [blocks, busy, check, notePath, pageCount, plan.length, planned]);

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
            // The cached scan doesn't know the new tag: the next opening scans again.
            forgetOutline(notePath);
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
    setLevel: useCallback(
      (key: string, level: 0 | HeadingLevel, withSubheadings: boolean) =>
        change({kind: 'level', key, level, withSubheadings}),
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
    cleanUp: useCallback(
      (scope: CleanupScope) => change({kind: 'cleanup', key: CLEANUP_KEY, scope}),
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
