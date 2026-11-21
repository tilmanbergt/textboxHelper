/**
 * What the Outline tab shows (technical-design-outline-sections.md §7.1): the filter, the entry
 * open on the right, what the panel shows (the entry or a paragraph — whichever was tapped last),
 * and the Move to mode. Everything structural comes from `domain/outlineContents.ts` over the
 * blocks as planned; set-aside and deleted blocks stay visible at their old place, marked.
 */
import {useCallback, useMemo, useState} from 'react';
import {
  buildContents,
  contentsRows,
  initialEntry,
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
  /** One pane: no headings and no files. */
  flat: boolean;
  rows: ContentsRow[];
  open: ContentsEntry | null;
  own: {rows: OutlineBlock[]; hidden: number};
  openEntry: (key: string) => void;
  subject: Subject | null;
  selectBlock: (key: string) => void;
  /** Move to mode: the paragraph or file being moved; the Contents column shows → targets. */
  moving: string | null;
  setMoving: (key: string | null) => void;
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
  const [moving, setMoving] = useState<string | null>(null);

  const all = useMemo(() => blocks ?? [], [blocks]);
  const display = useMemo(() => shownOrder(all, planned), [all, planned]);
  const order = useMemo(() => planned?.order ?? all, [all, planned]);
  const contents = useMemo(() => (blocks ? buildContents(display) : null), [blocks, display]);
  const moveContents = useMemo(() => buildContents(order), [order]);
  const shown = useMemo(() => new Map(display.map(block => [block.key, block])), [display]);
  const flat = !!contents && contents.entries.every(entry => entry.kind === 'start');

  const open =
    (contents && openKey ? contents.byKey.get(openKey) : undefined) ??
    (contents ? contents.byKey.get(initialEntry(contents) ?? '') : undefined) ??
    null;
  const rows = useMemo(
    () => (contents ? contentsRows(contents, shown, filter) : []),
    [contents, filter, shown],
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
    moving: moving && order.some(block => block.key === moving) ? moving : null,
    setMoving,
  };
}
