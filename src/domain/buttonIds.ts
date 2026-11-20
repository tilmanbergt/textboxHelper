/**
 * Central registry for plugin button ids. Keeping them in one place makes toolbar-related changes
 * easy to review without searching through the UI code; `index.js` registers the buttons, and
 * `src/supernote/pluginRouting.ts` passes their presses to the app.
 */

/** Lasso toolbar: the Textbox Tools panel (split, join, clean, remove line breaks, with preview). */
export const BUTTON_ID_TEXTBOX_TOOLS = 6200;
/** NOTE toolbar "Manuscript": the card for the page's edit marks (6270, the lasso review, is gone). */
export const BUTTON_ID_NOTE_MANUSCRIPT = 6280;
export const BUTTON_ID_IMPORT_TEXT_FILE = 6290;
export const BUTTON_ID_EXPORT_DOCX = 6300;
/** "Insertion or Replacement": tags lassoed handwriting; the mark written before it says which. */
export const BUTTON_ID_TOOLBAR_PEN_EDIT = 6310;
