/**
 * The one place that knows the Markdown heading syntax a textbox's text uses
 * (technical-design-outline-sections.md §1.1). The text decides whether a textbox is a heading and
 * of which level, never its look: `## Methods` is a level-2 heading on the page, in the Outline and
 * in the linked file alike. As in Obsidian, one to six `#` then a space or tab start a heading;
 * `#tag` doesn't. The Outline knows three levels: deeper ones count as level 3, their text stays
 * as it is. Pure.
 */

export type HeadingLevel = 1 | 2 | 3;

export const HEADING_LEVELS: HeadingLevel[] = [1, 2, 3];

const HEADING = /^(#{1,6})[ \t]+(\S.*)$/s;

function match(text: string): RegExpMatchArray | null {
  return text.trimStart().match(HEADING);
}

/** The level of the text's leading `#`s: 0 = not a heading. */
export function headingLevelOf(text: string): 0 | HeadingLevel {
  const found = match(text);
  return found ? (Math.min(3, found[1].length) as HeadingLevel) : 0;
}

/** The text without its leading `#`s and the space after them; the text itself when it has none. */
export function headingTitleOf(text: string): string {
  const found = match(text);
  return found ? found[2] : text;
}

/** The text with `level` `#`s in front (0 removes them); the title keeps every character. */
export function withHeadingLevel(text: string, level: 0 | HeadingLevel): string {
  const title = headingTitleOf(text);
  return level === 0 ? title : `${'#'.repeat(level)} ${title}`;
}
