/**
 * The block tag (technical-design-manuscript.md §5.2, decision D2): `tbt:b:` plus compact JSON in a
 * textbox's `userData`. It gives a textbox an identity that survives page reads, renumbering and
 * saves (uuids and numbers don't, host facts §3). The Outline uses `id` for a block's status; the
 * source link (technical-design-source-link.md) adds `s` (source), `i` (source block) and `p`
 * (piece); linked files (technical-design-linked-files.md) add the file divider and its title.
 * Pure.
 */

const PREFIX = 'tbt:b:';

export type BlockKind = 'x' | 'f' | 't';
const KINDS: BlockKind[] = ['x', 'f', 't'];

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
   * "t": a NOTE title element of ours, over a file divider (technical-design-linked-files.md §1)
   * or a heading (technical-design-outline-sections.md §4).
   */
  k?: BlockKind;
  /** A title of ours over a heading: the heading's level (1–3). */
  h?: number;
  /** 1: set aside by the Outline; a linked file leaves it out (technical-design-source-link.md §2.4). */
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

/**
 * A textbox's `userData` with the block tag marked as set aside (or not): the Outline sets it when
 * it sets a block aside and clears it when it moves the block back. Anything that isn't a block
 * tag comes back unchanged.
 */
export function withAside(userData: string | null, aside: boolean): string | null {
  const tag = parseBlockTag(userData);
  if (!tag || !!tag.a === aside) {
    return userData;
  }
  const next: BlockTag = {...tag};
  if (aside) {
    next.a = 1;
  } else {
    delete next.a;
  }
  return formatBlockTag(next);
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
