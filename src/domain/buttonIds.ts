/**
 * Central registry for plugin button ids. Keeping them in one place makes toolbar-related changes
 * easy to review without searching through the UI code; `index.js` registers the buttons, and
 * `src/supernote/pluginRouting.ts` passes their presses to the app.
 */

/** Lasso toolbar: the Textbox Tools panel (split, join, clean, remove line breaks, with preview). */
export const BUTTON_ID_TEXTBOX_TOOLS = 6200;
/** NOTE toolbar "Manuscript": the card for the page's edit marks (6270, the lasso review, is gone). */
export const BUTTON_ID_NOTE_MANUSCRIPT = 6280;
// 6290 (Import Text File) and 6300 (Export DOCX) are retired: both are in the Manuscript card's
// Files tab now. Don't reuse them.
/** "Insertion or Replacement": tags lassoed handwriting; the mark written before it says which. */
export const BUTTON_ID_TOOLBAR_PEN_EDIT = 6310;
/** "Comment or Image": tags lassoed handwriting as a comment or an image; never looks for a mark. */
export const BUTTON_ID_TOOLBAR_NOTE = 6320;
