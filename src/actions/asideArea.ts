import {asideDividerTag, formatBlockTag, parseBlockTag} from '../domain/blockTag';
import {asideStart} from '../domain/noteRegions';
import type {LayoutBlock, Placement} from '../domain/outlineLayout';
import {getSettings} from '../storage/settingsFile';
import type {StyledTextboxInsert} from '../supernote/noteTextInsertion';
import {estimateTextboxHeight} from '../supernote/textboxMetrics';
import {readNoteTextboxes} from './linkedFiles';

/**
 * The aside divider the plugin writes (technical-design-aside-area.md §3.3): a textbox "Set aside"
 * in the style of a `#` heading, tagged `k: 'a'`, at the top of the aside area's first page. Its
 * title follows from the title sync. Shared by the Outline's apply and Clean up, which both can set
 * blocks aside into a note that has no aside area yet. The user may rename it on the page: the tag
 * makes it the divider, not its text. A file added to a linked note goes before the aside area,
 * so it doesn't land in it (`textEndPage`).
 */

/** The divider's key while it is planned (it has no block yet). */
export const ASIDE_DIVIDER_KEY = '#aside-divider';

export const ASIDE_DIVIDER_TEXT = 'Set aside';

function dividerStyle(): StyledTextboxInsert['style'] {
  const heading = getSettings().import.structure.heading1;
  return {
    fontSize: heading.fontSize,
    fontPath: null,
    textAlign: 0,
    textBold: heading.bold ? 1 : 0,
    textItalics: 0,
    textFrameWidthType: 0,
    textFrameStyle: 0,
    textEditable: 0,
  };
}

/** The divider as a block to lay out: the text area's width, its measured height. */
export async function asideDividerBlock(area: {left: number; right: number}): Promise<LayoutBlock> {
  const style = dividerStyle();
  const height = await estimateTextboxHeight(ASIDE_DIVIDER_TEXT, area.right - area.left, style.fontSize, undefined);
  return {
    key: ASIDE_DIVIDER_KEY,
    page: -1,
    rect: {left: area.left, right: area.right, top: 0, bottom: Math.ceil(height)},
    startsPage: true,
  };
}

/** The divider textbox to insert at its place. */
export function asideDividerInsert(place: Placement): StyledTextboxInsert {
  return {
    text: ASIDE_DIVIDER_TEXT,
    rect: place.rect,
    userData: formatBlockTag(asideDividerTag(new Date())),
    style: dividerStyle(),
  };
}

/**
 * The last page of the note's text: the page before its aside area starts, or the last page when
 * it has none. A file added to a linked note goes after it (technical-design-aside-area.md §3.3).
 */
export async function textEndPage(notePath: string, pageCount: number): Promise<number> {
  const items = await readNoteTextboxes(notePath, pageCount);
  const start = asideStart(items.map(item => parseBlockTag(item.userData)));
  return start === null ? pageCount - 1 : Math.max(0, items[start].page - 1);
}
