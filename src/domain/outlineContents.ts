import {headingTitleOf} from './headingText';
import {matchesFilter, rank, type OutlineBlock, type OutlineFilter} from './outlineModel';
import {canMoveBefore, type MoveTarget} from './outlinePlan';

/**
 * What the Outline's two columns show (technical-design-outline-sections.md §1.3): the contents
 * (linked files and headings, indented) and, for each entry, its own paragraphs — the ones before
 * its first child heading, since everything after belongs to a subsection. Built from the blocks
 * in reading order (the planned order while changes are planned), so the screen holds no structure
 * logic of its own. Also the moves the details panel offers, as targets for the plan. Pure.
 *
 * Pseudo entries: "Start" holds the paragraphs before the first heading of a note without linked
 * files; "Not in a file" the textboxes before the first file of a linked note (written nowhere).
 *
 * The aside area (technical-design-aside-area.md §2.2) is the last top entry: its divider's entry,
 * with the headings typed in the area (or set aside with their section) below it, built like a
 * file's. A note set aside before the divider existed gets a pseudo entry "Set aside" in its place.
 * Every entry says whether it is in the aside area; the views show either the text or the area.
 */

export type ContentsEntryKind = 'file' | 'heading' | 'start' | 'orphans' | 'aside';

export type ContentsEntry = {
  /** The divider's or heading's block key; START / ORPHANS / ASIDE for the pseudo entries. */
  key: string;
  kind: ContentsEntryKind;
  /** Its level: file 0, heading 1–3; pseudo entries take the top level. */
  level: number;
  /** Indentation: 0 at the top. */
  depth: number;
  title: string;
  parent: string | null;
  children: string[];
  /** Its own paragraphs, in order. */
  own: string[];
  /** Every block of its section, the heading or divider first. */
  section: string[];
  /** Edits waiting on its own paragraphs (and its heading), and in its whole section. */
  pendingOwn: number;
  pendingAll: number;
  /** The aside area's entry or one below it. */
  aside: boolean;
};

export type Contents = {
  entries: ContentsEntry[];
  byKey: Map<string, ContentsEntry>;
  /** The entry each block belongs to (a heading or divider: its own entry). */
  ownerOf: Map<string, string>;
  /** The text has no headings and no files: one pane, the Start entry's paragraphs. */
  flat: boolean;
};

export const START = '#start';
export const ORPHANS = '#orphans';
export const ASIDE = '#aside';

const PSEUDO_TITLE: Record<string, string> = {
  [START]: 'Start',
  [ORPHANS]: 'Not in a file',
  [ASIDE]: 'Set aside',
};

function titleOf(block: OutlineBlock): string {
  const text = block.kind === 'heading' ? headingTitleOf(block.text) : block.text;
  return text.split('\n')[0].trim();
}

export function buildContents(order: OutlineBlock[]): Contents {
  const entries: ContentsEntry[] = [];
  const byKey = new Map<string, ContentsEntry>();
  const ownerOf = new Map<string, string>();
  const hasFiles = order.some(block => block.kind === 'file');
  const pending = (block: OutlineBlock) => block.pendingEdits ?? 0;

  const add = (entry: ContentsEntry): ContentsEntry => {
    entries.push(entry);
    byKey.set(entry.key, entry);
    return entry;
  };
  const pseudo = (key: string, level: number): ContentsEntry =>
    byKey.get(key) ??
    add({
      key,
      kind: key === START ? 'start' : key === ORPHANS ? 'orphans' : 'aside',
      level,
      depth: 0,
      title: PSEUDO_TITLE[key],
      parent: null,
      children: [],
      own: [],
      section: [],
      pendingOwn: 0,
      pendingAll: 0,
      aside: key === ASIDE,
    });

  let stack: ContentsEntry[] = [];
  let inAside = false;
  for (const block of order) {
    if (block.aside && !inAside) {
      // The aside area starts: a top entry of its own, never under the text's last heading.
      inAside = true;
      stack = block.kind === 'aside' ? [] : [pseudo(ASIDE, 0)];
    }
    if (block.kind === 'paragraph') {
      const owner =
        stack[stack.length - 1] ?? pseudo(hasFiles ? ORPHANS : START, hasFiles ? 0 : 1);
      owner.own.push(block.key);
      owner.pendingOwn += pending(block);
      ownerOf.set(block.key, owner.key);
      for (const open of stack.length > 0 ? stack : [owner]) {
        open.section.push(block.key);
        open.pendingAll += pending(block);
      }
      continue;
    }
    const level = rank(block);
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1] ?? null;
    const entry = add({
      key: block.key,
      kind: block.kind === 'file' ? 'file' : block.kind === 'aside' ? 'aside' : 'heading',
      level,
      depth: parent ? parent.depth + 1 : 0,
      title: titleOf(block),
      parent: parent?.key ?? null,
      children: [],
      own: [],
      section: [],
      pendingOwn: pending(block),
      pendingAll: 0,
      aside: inAside,
    });
    parent?.children.push(entry.key);
    ownerOf.set(block.key, entry.key);
    stack.push(entry);
    for (const open of stack) {
      open.section.push(block.key);
      open.pendingAll += pending(block);
    }
  }
  const flat = entries.every(entry => entry.kind === 'start' || entry.aside);
  return {entries, byKey, ownerOf, flat};
}

/** The aside area's entry, if the note has one. */
export function asideEntry(contents: Contents): ContentsEntry | null {
  return contents.entries.find(entry => entry.kind === 'aside') ?? null;
}

/** Whether a view shows an entry: the text views the text, the aside view the aside area. */
export function inView(entry: ContentsEntry, filter: OutlineFilter): boolean {
  return entry.aside === (filter === 'aside');
}

/** One pane for this view: the text without headings and files, or the aside area without headings. */
export function isFlat(contents: Contents, filter: OutlineFilter): boolean {
  if (filter !== 'aside') {
    return contents.flat;
  }
  return (asideEntry(contents)?.children.length ?? 0) === 0;
}

export type ContentsRow = {
  entry: ContentsEntry;
  /** Nothing in its section matches the filter. */
  dim: boolean;
  /** How many of its child entries are folded into it (nothing in them matches). */
  folded: number;
};

/**
 * The Contents column for a filter: every top entry, dim when nothing in it matches; child entries
 * without matches folded into their parent. With All, everything of the text shows; with Set aside,
 * everything of the aside area.
 */
export function contentsRows(
  contents: Contents,
  blocks: Map<string, OutlineBlock>,
  view: OutlineFilter,
): ContentsRow[] {
  // In the aside area nothing is dimmed or folded: it shows whole, like All in the text.
  const filter: OutlineFilter = view === 'aside' ? 'all' : view;
  const matches = (entry: ContentsEntry) =>
    entry.section.some(key => {
      const block = blocks.get(key);
      return !!block && matchesFilter(block, filter);
    });
  const shown = new Set<string>();
  const rows: ContentsRow[] = [];
  for (const entry of contents.entries.filter(item => inView(item, view))) {
    const visible =
      filter === 'all' ||
      (entry.parent === null ? true : shown.has(entry.parent) && matches(entry));
    if (!visible) {
      continue;
    }
    shown.add(entry.key);
    const folded =
      filter === 'all'
        ? 0
        : entry.children.filter(key => {
            const child = contents.byKey.get(key);
            return !!child && !matches(child);
          }).length;
    rows.push({entry, dim: filter !== 'all' && !matches(entry), folded});
  }
  return rows;
}

/** An entry's own paragraphs for a filter, and how many it hides. */
export function ownRows(
  entry: ContentsEntry,
  blocks: Map<string, OutlineBlock>,
  filter: OutlineFilter,
): {rows: OutlineBlock[]; hidden: number} {
  const all = entry.own
    .map(key => blocks.get(key))
    .filter((block): block is OutlineBlock => !!block);
  const rows = all.filter(block => matchesFilter(block, filter));
  return {rows, hidden: all.length - rows.length};
}

/** What follows an entry's own paragraphs: its child entries with their own paragraph counts. */
export function followingEntries(
  contents: Contents,
  entry: ContentsEntry,
): {entry: ContentsEntry; paragraphs: number}[] {
  return entry.children
    .map(key => contents.byKey.get(key))
    .filter((child): child is ContentsEntry => !!child)
    .map(child => ({entry: child, paragraphs: child.own.length}));
}

/** The entry to open first in a view: the first with edits waiting, else the first. */
export function initialEntry(contents: Contents, view: OutlineFilter = 'all'): string | null {
  const entries = contents.entries.filter(entry => inView(entry, view));
  const withEdits = entries.find(entry => entry.pendingOwn > 0);
  return (withEdits ?? entries[0])?.key ?? null;
}

/** The key after a block in the order, or 'end'. */
function after(order: OutlineBlock[], key: string): MoveTarget {
  const at = order.findIndex(block => block.key === key);
  return order[at + 1]?.key ?? 'end';
}

/** Only a target that changes something; else null, so the button is off. */
function checked(order: OutlineBlock[], key: string, target: MoveTarget | null): MoveTarget | null {
  return target !== null && canMoveBefore(order, key, target) ? target : null;
}

export type StepMoves = {up: MoveTarget | null; down: MoveTarget | null; top: MoveTarget | null; end: MoveTarget | null};

/**
 * The steps a paragraph can take within its entry's own paragraphs, or a file among the files:
 * one up, one down, to the top, to the end. Each is a "move before" target, or null.
 */
export function stepMoves(contents: Contents, order: OutlineBlock[], key: string): StepMoves {
  const none = {up: null, down: null, top: null, end: null};
  const block = order.find(item => item.key === key);
  if (!block || block.kind === 'heading') {
    return none;
  }
  const siblings =
    block.kind === 'file'
      ? contents.entries.filter(entry => entry.kind === 'file').map(entry => entry.key)
      : contents.byKey.get(contents.ownerOf.get(key) ?? '')?.own ?? [];
  const at = siblings.indexOf(key);
  if (at < 0) {
    return none;
  }
  const last = siblings[siblings.length - 1];
  // Past the last sibling: what follows its whole section (a file's text, a paragraph alone).
  const pastLast = block.kind === 'file' ? afterSection(contents, order, last) : after(order, last);
  return {
    up: at > 0 ? checked(order, key, siblings[at - 1]) : null,
    down: at < siblings.length - 1 ? checked(order, key, siblings[at + 2] ?? pastLast) : null,
    top: at > 0 ? checked(order, key, siblings[0]) : null,
    end: at < siblings.length - 1 ? checked(order, key, pastLast) : null,
  };
}

function afterSection(contents: Contents, order: OutlineBlock[], key: string): MoveTarget {
  const section = contents.byKey.get(key)?.section ?? [key];
  return after(order, section[section.length - 1]);
}

/**
 * Move to…: where a paragraph lands in another entry — after that entry's own paragraphs, before
 * its first child heading. Null for the paragraph's own entry and for anything that changes
 * nothing. Works the same within the text, within the aside area and from the aside area back
 * into the text (Move back); which entries are offered is the view's choice.
 */
export function moveToEntry(
  contents: Contents,
  order: OutlineBlock[],
  key: string,
  entryKey: string,
): MoveTarget | null {
  const entry = contents.byKey.get(entryKey);
  const block = order.find(item => item.key === key);
  if (!entry || !block || block.kind !== 'paragraph') {
    return null;
  }
  if (contents.ownerOf.get(key) === entryKey) {
    return null;
  }
  const own = entry.own.filter(item => item !== key);
  const lastOwn = own[own.length - 1];
  const divider = entry.kind === 'heading' || entry.kind === 'file' || (entry.kind === 'aside' && entry.key !== ASIDE);
  const anchor = lastOwn ?? (divider ? entry.key : null);
  if (anchor === null && entry.kind === 'aside') {
    // The pseudo entry of a note without divider: the start of the aside area.
    return checked(order, key, order.find(item => item.aside && item.key !== key)?.key ?? 'end');
  }
  if (anchor === null) {
    // An empty pseudo entry at the top: before the first block of the text.
    return checked(order, key, order.find(item => !item.aside)?.key ?? 'end');
  }
  const target = after(order, anchor);
  return checked(order, key, target === key ? after(order, key) : target);
}

/** Move before…: a file goes before another file. Null when that changes nothing. */
export function moveFileBefore(
  order: OutlineBlock[],
  key: string,
  beforeFile: string,
): MoveTarget | null {
  return checked(order, key, beforeFile);
}
