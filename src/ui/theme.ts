/**
 * Style constants every screen reads from (taken from Kept GTD's ui/theme.ts). The device is
 * grayscale e-ink: black is a fill and border colour, never a way to mark text. Text is marked by
 * weight, underline and strikethrough (DEVELOPMENT-POLICY §4).
 *
 * FONT.large  - screen titles.
 * FONT.medium - body text, list entries, buttons, inputs.
 * FONT.small  - secondary text: context, hints, captions, counts.
 */
export const FONT = {
  large: 22,
  medium: 17,
  small: 15,
} as const;

export const COLORS = {
  background: '#ffffff',
  text: '#000000',
  /** Secondary text; 7.5:1 on white. */
  muted: '#555555',
  /** Greyed-out text of something that can't be chosen; 4.5:1 on white. */
  disabled: '#767676',
  border: '#dddddd',
  /** Fill of primary buttons, selected segments and the active tab underline. */
  accent: '#000000',
  accentText: '#ffffff',
} as const;

/** Spacing scale for margins, paddings and gaps. */
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
} as const;

export const RADII = {
  sm: 4,
  md: 6,
  pill: 22,
} as const;

/** One line of body text; PagedText and list rows use it so measured and drawn lines agree. */
export const LINE_HEIGHT = {
  medium: 26,
  small: 20,
} as const;
