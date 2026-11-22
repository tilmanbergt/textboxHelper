/**
 * Which textboxes of a note belong to which linked file (technical-design-linked-files.md §1.2).
 * Every linked file starts with a divider textbox (block tag `k: 'f'`, the file's name under a
 * NOTE title); its segment is everything after it in reading order up to the next divider. So
 * several files can share pages, and typed or split textboxes belong to the file they sit in.
 *
 * Notes linked before dividers existed have tags but no divider: when exactly one such file is on
 * the note, it owns the textboxes before the first divider that lie on the pages from its first to
 * its last tag, as such notes were read before.
 *
 * The aside area (`noteRegions.ts`, technical-design-aside-area.md) ends the last file: nothing in
 * it belongs to any file. Pure.
 */
import {isAsideDivider, splitAtAside} from './noteRegions';
import type {SourceItem} from './sourceExport';

export type FileSegments = {
  /** Each file's textboxes, in reading order, its divider left out. */
  bySource: Map<string, SourceItem[]>;
  /** Files in note order: by their divider, a file without divider first. */
  order: string[];
  /** Textboxes before the first divider that belong to no file. */
  orphans: SourceItem[];
  /** Files whose divider is on the note. */
  withDivider: Set<string>;
  /** A second divider of a file is ignored (its textboxes count for the file before it). */
  extraDividers: number;
  /** The textboxes of the aside area, its divider left out: in no file. */
  aside: SourceItem[];
};

export function isDivider(item: SourceItem): boolean {
  return item.tag?.k === 'f' && !!item.tag.s;
}

export function segmentByFile(all: SourceItem[]): FileSegments {
  const {text: items, aside} = splitAtAside(all, item => item.tag);
  const bySource = new Map<string, SourceItem[]>();
  const order: string[] = [];
  const withDivider = new Set<string>();
  let extraDividers = 0;
  let current: string | null = null;
  const before: SourceItem[] = [];

  for (const item of items) {
    if (isDivider(item)) {
      const sourceId = item.tag?.s as string;
      if (withDivider.has(sourceId)) {
        extraDividers++;
        continue;
      }
      withDivider.add(sourceId);
      order.push(sourceId);
      bySource.set(sourceId, []);
      current = sourceId;
      continue;
    }
    if (current === null) {
      before.push(item);
    } else {
      bySource.get(current)?.push(item);
    }
  }

  // Files tagged on the note but without a divider (linked before dividers existed).
  const undivided = [
    ...new Set(
      items
        .filter(item => item.tag?.s && item.tag.k !== 'f' && !withDivider.has(item.tag.s))
        .map(item => item.tag?.s as string),
    ),
  ];
  let orphans = before;
  if (undivided.length === 1) {
    // As those notes were read before: from the first to the last page holding a tag of the file.
    const pages = before.filter(item => item.tag?.s === undivided[0]).map(item => item.page);
    const first = Math.min(...pages);
    const last = Math.max(...pages);
    const owned = (item: SourceItem) => item.page >= first && item.page <= last;
    bySource.set(undivided[0], before.filter(owned));
    order.unshift(undivided[0]);
    orphans = before.filter(item => !owned(item));
  }
  return {
    bySource,
    order,
    orphans: orphans.filter(item => item.text.trim()),
    withDivider,
    extraDividers,
    aside: aside.filter(item => !isAsideDivider(item.tag)),
  };
}

/**
 * Blocks of each file that sit in another file's segment and that file hasn't adopted (the move
 * not confirmed): their own file keeps them at their place (technical-design-linked-files.md §6).
 * `adopted` gives each file's confirmed ids.
 */
export function heldElsewhere(segments: FileSegments, adopted: Map<string, string[]>): Map<string, Set<number>> {
  const held = new Map<string, Set<number>>();
  for (const [owner, items] of segments.bySource) {
    const confirmed = new Set(adopted.get(owner) ?? []);
    for (const item of items) {
      const tag = item.tag;
      if (!tag?.s || tag.s === owner || !Number.isInteger(tag.i) || confirmed.has(tag.id)) {
        continue;
      }
      const set = held.get(tag.s) ?? new Set<number>();
      set.add(tag.i as number);
      held.set(tag.s, set);
    }
  }
  return held;
}

/** Each file's blocks in the aside area: source id → block indexes (they count as set aside). */
export function asideBlocks(segments: FileSegments): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  for (const item of segments.aside) {
    const tag = item.tag;
    if (!tag?.s || !Number.isInteger(tag.i)) {
      continue;
    }
    const set = result.get(tag.s) ?? new Set<number>();
    set.add(tag.i as number);
    result.set(tag.s, set);
  }
  return result;
}
