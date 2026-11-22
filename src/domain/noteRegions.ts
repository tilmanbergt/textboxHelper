/**
 * Where the aside area starts (technical-design-aside-area.md §1.2): the one place that knows it,
 * so the write-back, the Outline, the layout of an apply and the DOCX export agree. The aside area
 * is the end of the note from the aside divider (block tag `k: 'a'`) on; everything in it — set
 * aside, typed there, moved there with the lasso — is in no file and is never written or exported.
 * Position decides, not a tag on the textbox: a textbox moved above the divider is back in the text.
 *
 * Notes set aside before the divider existed carry `a` on the set-aside textboxes. Without a divider,
 * the aside area starts at the first such textbox after the last textbox of a linked file's text,
 * so a set-aside block moved back by hand doesn't pull the text after it into the aside area. The
 * next Outline apply gives such a note its divider. Pure.
 */
import type {BlockTag} from './blockTag';

/** Whether a tag is the aside divider's. */
export function isAsideDivider(tag: BlockTag | null | undefined): boolean {
  return tag?.k === 'a';
}

/** A set-aside textbox of a note from before the divider (legacy). */
function setAsideBefore(tag: BlockTag | null | undefined): boolean {
  return tag?.a === 1 && tag.k !== 't';
}

/**
 * The index of the first item of the aside area (the divider, or the first legacy set-aside
 * textbox), or null when the note has none. `tags`: the items' tags in reading order.
 */
export function asideStart(tags: (BlockTag | null | undefined)[]): number | null {
  const divider = tags.findIndex(isAsideDivider);
  if (divider >= 0) {
    return divider;
  }
  let lastLinked = -1;
  tags.forEach((tag, index) => {
    if (tag?.s && !setAsideBefore(tag) && tag.k !== 't') {
      lastLinked = index;
    }
  });
  const legacy = tags.findIndex((tag, index) => index > lastLinked && setAsideBefore(tag));
  return legacy >= 0 ? legacy : null;
}

/** Whether the note's aside area starts at a divider (false: none, or legacy only). */
export function hasAsideDivider(tags: (BlockTag | null | undefined)[]): boolean {
  return tags.some(isAsideDivider);
}

/** Items split at the aside area's start: the text, and the aside area (its divider included). */
export function splitAtAside<T>(
  items: T[],
  tagOf: (item: T) => BlockTag | null | undefined,
): {text: T[]; aside: T[]} {
  const start = asideStart(items.map(tagOf));
  return start === null
    ? {text: items, aside: []}
    : {text: items.slice(0, start), aside: items.slice(start)};
}
