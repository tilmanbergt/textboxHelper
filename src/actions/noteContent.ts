import {isNormalTextElement} from '../domain/textboxEditPlan';
import {readPageElements, recycleElements} from '../supernote/noteElements';

/**
 * Whether the note has any textbox: pages are read one after the other until one has a textbox, so
 * a note with text answers after its first page; an empty note opens the Manuscript card on its
 * Files tab (technical-design-settings-layout-files.md §4).
 */
export async function noteHasTextboxes(notePath: string, pageCount: number): Promise<boolean> {
  for (let page = 0; page < pageCount; page++) {
    const elements = await readPageElements(notePath, page, `Could not read page ${page + 1}.`);
    try {
      if (elements.some(isNormalTextElement)) {
        return true;
      }
    } finally {
      await recycleElements(elements);
    }
  }
  return false;
}
