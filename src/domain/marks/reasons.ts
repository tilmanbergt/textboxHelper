/**
 * Pass 1's reasons, in plain English (technical-design-mark-dialogue.md §13): why strokes are no
 * mark, shown on the "Not a clear mark" card and in To decide.
 */

export const NO_MARK_REASON = 'None of these strokes reads as a mark: a strike with a loop, a slash, or a caret.';

export const VERTICALS_NO_TEXT_REASON =
  'Two verticals across a strike mark exactly what to delete; they take no new text. For new text, draw a small loop after the strike.';

export const MARK_STROKES_UNREADABLE = 'The selected strokes could not be read.';
