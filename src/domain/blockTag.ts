/**
 * The block tag (technical-design-manuscript.md §5.2, decision D2): `tbt:b:` plus compact JSON in a
 * textbox's `userData`. It gives a textbox an identity that survives page reads, renumbering and
 * saves (uuids and numbers don't, host facts §3). The Outline uses `id` for a block's status; the
 * source link (technical-design-source-link.md) adds `s` (source), `i` (source block) and `p`
 * (piece); linked files (technical-design-linked-files.md) add the file divider and its title; the
 * aside area (technical-design-aside-area.md) adds its divider. Pure.
 */

const PREFIX = 'tbt:b:';

export type BlockKind = 'x' | 'f' | 't' | 'a';
const KINDS: BlockKind[] = ['x', 'f', 't', 'a'];

export type BlockTag = {
  v: 1;
  id: string;
  /** Source id (technical-design-source-link.md). */
  s?: string;
  /** Block index in the source. */
  i?: number;
  /** Piece of a block cut by the import. */
  p?: number;
  /**
   * "x": the placeholder of a protected block (technical-design-source-link.md §2.5).
   * "f": a file divider, the textbox with a linked file's name that starts its part of the note.
   * "t": a NOTE title element of ours, over a file divider (technical-design-linked-files.md §1),
   * a heading (technical-design-outline-sections.md §4) or the aside divider.
   * "a": the aside divider, the textbox "Set aside" that starts the aside area: everything after it
   * in reading order is in no file (technical-design-aside-area.md §1).
   */
  k?: BlockKind;
  /** A title of ours over a heading: the heading's level (1–3). */
  h?: number;
  /**
   * On a title of ours: it is the aside divider's title. On a textbox: set aside by an older
   * version, before the aside divider existed; such textboxes still mark where the aside area
   * starts in a note without divider (`noteRegions.ts`). Not written on textboxes any more.
   */
  a?: 1;
};

export function formatBlockTag(tag: BlockTag): string {
  return `${PREFIX}${JSON.stringify(tag)}`;
}

/** The tag in `userData`, or null for anything else (no tag, another plugin's, broken). */
export function parseBlockTag(userData: unknown): BlockTag | null {
  if (typeof userData !== 'string' || !userData.startsWith(PREFIX)) {
    return null;
  }
  try {
    const value = JSON.parse(userData.slice(PREFIX.length)) as Record<string, unknown>;
    if (value?.v !== 1 || typeof value.id !== 'string' || !value.id) {
      return null;
    }
    const tag: BlockTag = {v: 1, id: value.id};
    if (typeof value.s === 'string') {
      tag.s = value.s;
    }
    if (Number.isInteger(value.i)) {
      tag.i = value.i as number;
    }
    if (Number.isInteger(value.p)) {
      tag.p = value.p as number;
    }
    if (KINDS.includes(value.k as BlockKind)) {
      tag.k = value.k as BlockKind;
    }
    if (value.a === 1) {
      tag.a = 1;
    }
    if (Number.isInteger(value.h)) {
      tag.h = value.h as number;
    }
    return tag;
  } catch {
    return null;
  }
}

/** A new block id: "b-" + time in base 36 + four random characters. */
export function newBlockId(now: Date, random: () => number = Math.random): string {
  const tail = Array.from({length: 4}, () => Math.floor(random() * 36).toString(36)).join('');
  return `b-${now.getTime().toString(36)}${tail}`;
}

/** The tag of a linked file's divider textbox. */
export function dividerTag(sourceId: string, now: Date): BlockTag {
  return {v: 1, id: newBlockId(now), s: sourceId, k: 'f'};
}

/** The tag of the NOTE title element over a linked file's divider. */
export function titleTag(sourceId: string, now: Date): BlockTag {
  return {v: 1, id: newBlockId(now), s: sourceId, k: 't'};
}

/** The tag of the NOTE title element of ours over a heading of this level. */
export function headingTitleTag(level: number, now: Date): BlockTag {
  return {v: 1, id: newBlockId(now), k: 't', h: level};
}

/** The tag of the aside divider textbox. */
export function asideDividerTag(now: Date): BlockTag {
  return {v: 1, id: newBlockId(now), k: 'a'};
}

/** The tag of the NOTE title element of ours over the aside divider. */
export function asideTitleTag(now: Date): BlockTag {
  return {v: 1, id: newBlockId(now), k: 't', a: 1};
}
