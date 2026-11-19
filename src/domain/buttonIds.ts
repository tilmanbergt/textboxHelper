/**
 * Central registry for plugin button ids. Keeping them in one place makes toolbar-related changes
 * easy to review without searching through the UI code; `index.js` registers the buttons, and
 * `src/supernote/pluginRouting.ts` passes their presses to the app.
 */

export const BUTTON_ID_TEXTBOX_TOOLS = 6200;
export const BUTTON_ID_TOOLBAR_SPLIT_TEXTBOX = 6230;
export const BUTTON_ID_TOOLBAR_SPLIT_PARAGRAPHS_TEXTBOX = 6235;
export const BUTTON_ID_TOOLBAR_JOIN_TEXTBOXES = 6240;
export const BUTTON_ID_TOOLBAR_CLEAN_TEXTBOX_SPACES = 6250;
export const BUTTON_ID_TOOLBAR_REMOVE_LINE_BREAKS = 6260;
export const BUTTON_ID_TOOLBAR_APPLY_EDIT_MARKERS = 6270;
export const BUTTON_ID_NOTE_APPLY_ALL_EDIT_MARKERS = 6280;
export const BUTTON_ID_IMPORT_TEXT_FILE = 6290;
export const BUTTON_ID_EXPORT_DOCX = 6300;
/** "Insertion or Replacement": tags lassoed handwriting; the mark written before it says which. */
export const BUTTON_ID_TOOLBAR_PEN_EDIT = 6310;
