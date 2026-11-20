/**
 * State of the Manuscript card's Outline (technical-design-manuscript.md §5, §5.6): the note's
 * textboxes as blocks, read with the export scan when the tab opens, their statuses (kept in the
 * plugin), the edits the Review lists on them, the filter and the selected block. A status change
 * writes at once; a block's first status gives its textbox a block tag.
 */
import {useCallback, useMemo, useState} from 'react';
import {setBlockStatus} from '../../actions/blockStatus';
import {scanTextBoxes} from '../../actions/textboxScan';
import {formatBlockTag} from '../../domain/blockTag';
import type {ScannedTextBox} from '../../domain/exportClassification';
import type {PageReview} from '../../domain/manuscriptPages';
import {buildOutline, type BlockStatus, type OutlineBlock, type OutlineFilter} from '../../domain/outlineModel';
import {userMessage} from '../../domain/userMessage';
import {readBlockStatuses} from '../../storage/blockStatusStore';
import {getSettings} from '../../storage/settingsFile';
import type {FrameStatus} from '../../ui/ScreenFrame';

export interface Outline {
  blocks: OutlineBlock[] | null;
  loading: boolean;
  busy: boolean;
  status: FrameStatus | null;
  filter: OutlineFilter;
  setFilter: (filter: OutlineFilter) => void;
  selectedKey: string | null;
  select: (key: string) => void;
  load: () => void;
  /** Forgets the blocks read; the tab reads them again when it opens (after an apply). */
  clear: () => void;
  setStatus: (block: OutlineBlock, status: BlockStatus) => void;
}

export function useOutline(notePath: string | null, pages: Record<number, PageReview>): Outline {
  const [items, setItems] = useState<ScannedTextBox[] | null>(null);
  const [statuses, setStatuses] = useState<Record<string, BlockStatus>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setFrameStatus] = useState<FrameStatus | null>(null);
  const [filter, setFilter] = useState<OutlineFilter>('all');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!notePath || loading) {
      return;
    }
    setLoading(true);
    setFrameStatus({text: 'Reading the outline…'});
    Promise.all([
      scanTextBoxes({notePath, currentPage: null, scope: 'wholeNote', config: getSettings().export.rules}),
      readBlockStatuses(),
    ])
      .then(([scan, stored]) => {
        setItems(scan.items);
        setStatuses(stored);
        setFrameStatus(null);
      })
      .catch(error => {
        console.warn('[Outline] not read', String(error));
        setFrameStatus({kind: 'error', text: userMessage(error, 'Could not read the outline.')});
      })
      .finally(() => setLoading(false));
  }, [loading, notePath]);

  const blocks = useMemo(() => (items ? buildOutline(items, statuses, pages) : null), [items, pages, statuses]);

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
          setFrameStatus({kind: 'error', text: userMessage(error, 'Could not set the status.')});
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
    filter,
    setFilter,
    selectedKey,
    select: setSelectedKey,
    load,
    clear: useCallback(() => setItems(null), []),
    setStatus,
  };
}
