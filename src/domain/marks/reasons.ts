/**
 * Pass 1's reasons, in plain English (technical-design-mark-dialogue.md §13): why strokes are no
 * mark, shown on the "Not a clear mark" card and in To decide.
 */

export const NO_MARK_REASON = 'None of these strokes reads as a mark: a strike with a loop, a slash, or a caret.';

export const VERTICALS_NO_TEXT_REASON =
  'Two short lines at the ends of a strike mark exactly what to delete; they take no new text. For new text, draw a small circle after the strike too.';

export const MARK_STROKES_UNREADABLE = 'The selected strokes could not be read.';

export const STROKES_NO_MARK = 'These strokes over the text read as no mark.';

export const NO_MARK_FOR_TEXT =
  'No mark was found just before it. Select a mark for it, or insert it right here as a new paragraph.';
