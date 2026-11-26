/**
 * "Put cheat sheet on this page" (technical-design-release-readiness.md §6.2): the cheat sheet of
 * the editing marks goes into the open page as a picture. It changes none of the user's text, so
 * no backup is written; the note is saved afterwards, as after the plugin's other inserts. A
 * picture is never read as an edit mark (marks are strokes and straight lines only). If the host
 * can't insert it, the PNG goes to EXPORT, to be placed with the picture tool.
 */
import {exportCheatSheetFile, writeCheatSheetFile} from '../storage/cheatSheetFile';
import {fileNameOf} from '../domain/userMessage';
import {insertImageOnPage} from '../supernote/noteImage';
import {readNoteInfo, saveCurrentNoteForConsistency} from '../supernote/noteElements';

export type CheatSheetResult = {placed: boolean; message: string};

export async function putCheatSheetOnPage(base64: string): Promise<CheatSheetResult> {
  try {
    const path = await writeCheatSheetFile(base64);
    await insertImageOnPage(path);
    await saveCurrentNoteForConsistency('putting the cheat sheet on the page');
    const page = await readNoteInfo()
      .then(info => info.currentPage + 1)
      .catch(() => null);
    return {
      placed: true,
      message: `Cheat sheet put on ${page ? `page ${page}` : 'this page'}. Close Manuscript to see it; move it with the lasso, erase it like any picture.`,
    };
  } catch (error) {
    console.warn('[CheatSheet] not inserted', String(error));
    const exported = await exportCheatSheetFile(base64);
    return {
      placed: false,
      message: `The cheat sheet could not be put on the page; it is in EXPORT as ${fileNameOf(exported)}. Put it in the note with the picture tool.`,
    };
  }
}
