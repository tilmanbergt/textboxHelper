/**
 * The symbols the screens draw as text, in one place (technical-design-outline-sections.md §7.2):
 * the device font may lack one, and then only this file changes. ✎ ○ ◐ ● are known to show on the
 * A5 X; the arrows and ▸ are still to be checked on the device.
 */
export const GLYPH = {
  up: '↑',
  down: '↓',
  top: '⤒',
  end: '⤓',
  to: '→',
  folded: '▸',
  edits: '✎',
  more: '⋯',
  next: '›',
  dot: '·',
  /** A linked file (an emoji may be missing from the device font). */
  file: '§',
  /** The aside area (technical-design-aside-area.md §5.2); still to be checked on the device. */
  aside: '▤',
  /**
   * Images of a block in the Outline (technical-design-comments-images.md §6), after the double
   * frame on the page; still to be checked on the device.
   */
  image: '▣',
} as const;
