/**
 * What the Outline tab shows (technical-design-outline-sections.md §7.1): the filter, the entry
 * open on the right, what the panel shows (the entry or a paragraph — whichever was tapped last),
 * and the Move to mode. Everything structural comes from `domain/outlineContents.ts` over the
 * blocks as planned; set-aside and deleted blocks stay visible at their old place, marked.
 *
 * Show › Set aside shows only the aside area, the other choices only the text
 * (technical-design-aside-area.md §5.2). Move back is Move to with the text's entries as targets;
 * once planned, the view jumps to the text at the entry it went to.
 */
import {useCallback, useMemo, useState} from 'react';
import {
  buildContents,
  contentsRows,
  initialEntry,
  inView,
  isFlat,
  ownRows,
  type Contents,
  type ContentsEntry,
  type ContentsRow,
} from '../../../domain/outlineContents';
import type {OutlineBlock, OutlineFilter} from '../../../domain/outlineModel';
import type {PlannedOrder} from '../../../domain/outlinePlan';
import type {Outline} from './useOutline';

/** The panel's subject: an entry of the Contents, or a paragraph on the right. */
export type Subject = {kind: 'entry'; key: string} | {kind: 'block'; key: string};

export interface OutlineView {
  filter: OutlineFilter;
  setFilter: (filter: OutlineFilter) => void;
  contents: Contents | null;
  /** The blocks as shown (planned, with removed ones at their old place), by key. */
  shown: Map<string, OutlineBlock>;
  /** The blocks that stay in the text, as planned: what moves are computed on. */
  order: OutlineBlock[];
  /** The Contents of `order`, for moves. */
  moveContents: Contents;
  /** One pane: the view has no headings and no files. */
  flat: boolean;
  rows: ContentsRow[];
  open: ContentsEntry | null;
  own: {rows: OutlineBlock[]; hidden: number};
  openEntry: (key: string) => void;
  subject: Subject | null;
  selectBlock: (key: string) => void;
  /** Move to mode: the paragraph or file being moved; the Contents column shows → targets. */
  moving: string | null;
  /** Move back: the moving block goes from the aside area into the text (its entries are the targets). */
  movingBack: boolean;
  setMoving: (key: string | null, back?: boolean) => void;
  /** After a Move back: the text, the entry it went to, the block selected. */
  showInText: (entryKey: string, blockKey: string) => void;
}

/** The planned order, with set-aside and deleted blocks put back after the block before them. */
export function shownOrder(all: OutlineBlock[], planned: PlannedOrder | null): OutlineBlock[] {
  if (!planned) {
    return all;
  }
  const result = [...planned.order];
  [...planned.aside, ...planned.deleted]
    .sort((a, b) => all.findIndex(item => item.key === a.key) - all.findIndex(item => item.key === b.key))
    .forEach(block => {
      const index = all.findIndex(item => item.key === block.key);
      const before = all[index - 1];
      const at = before ? result.findIndex(item => item.key === before.key) : -1;
      result.splice(at + 1, 0, block);
    });
  return result;
}

export function useOutlineView(outline: Outline): OutlineView {
  const {blocks, planned, selectedKey, select} = outline;
  const [filter, setFilter] = useState<OutlineFilter>('all');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [subjectKind, setSubjectKind] = useState<'entry' | 'block'>('entry');
  const [moving, setMovingState] = useState<{key: string; back: boolean} | null>(null);

  const all = useMemo(() => blocks ?? [], [blocks]);
  const display = useMemo(() => shownOrder(all, planned), [all, planned]);
  const order = useMemo(() => planned?.order ?? all, [all, planned]);
  const contents = useMemo(() => (blocks ? buildContents(display) : null), [blocks, display]);
  const moveContents = useMemo(() => buildContents(order), [order]);
  const shown = useMemo(() => new Map(display.map(block => [block.key, block])), [display]);
  // Moving back, the Contents shows the text whatever the view.
  const rowsView: OutlineFilter = moving?.back ? 'all' : filter;
  const flat = !!contents && isFlat(contents, rowsView);

  const chosen = contents && openKey ? contents.byKey.get(openKey) : undefined;
  const open =
    (chosen && inView(chosen, filter) ? chosen : undefined) ??
    (contents ? contents.byKey.get(initialEntry(contents, filter) ?? '') : undefined) ??
    null;
  const rows = useMemo(
    () => (contents ? contentsRows(contents, shown, rowsView) : []),
    [contents, rowsView, shown],
  );
  const own = useMemo(
    () => (open ? ownRows(open, shown, filter) : {rows: [], hidden: 0}),
    [filter, open, shown],
  );

  const subjectBlock = subjectKind === 'block' && selectedKey && shown.has(selectedKey) ? selectedKey : null;
  const subject: Subject | null = subjectBlock
    ? {kind: 'block', key: subjectBlock}
    : open
    ? {kind: 'entry', key: open.key}
    : null;

  const openEntry = useCallback((key: string) => {
    setOpenKey(key);
    setSubjectKind('entry');
  }, []);
  const selectBlock = useCallback(
    (key: string) => {
      select(key);
      setSubjectKind('block');
    },
    [select],
  );
  const setMoving = useCallback(
    (key: string | null, back = false) => setMovingState(key ? {key, back} : null),
    [],
  );
  const showInText = useCallback(
    (entryKey: string, blockKey: string) => {
      setFilter('all');
      setOpenKey(entryKey);
      select(blockKey);
      setSubjectKind('block');
    },
    [select],
  );

  return {
    filter,
    setFilter,
    contents,
    shown,
    order,
    moveContents,
    flat,
    rows,
    open,
    own,
    openEntry,
    subject,
    selectBlock,
    moving: moving && order.some(block => block.key === moving.key) ? moving.key : null,
    movingBack: !!moving?.back,
    setMoving,
    showInText,
  };
}
