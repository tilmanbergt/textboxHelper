/**
 * The textbox actions, which of them a selection allows, and their names in the UI (one label per
 * action, DEVELOPMENT-POLICY §4).
 */

export type TextboxActionKind = 'split' | 'splitParagraphs' | 'join' | 'clean' | 'unwrap' | 'log';

export type TextboxActionAvailability = Record<TextboxActionKind, boolean>;

export function createEmptyAvailability(): TextboxActionAvailability {
  return {
    split: false,
    join: false,
    clean: false,
    unwrap: false,
    splitParagraphs: false,
    log: true,
  };
}

/** The actions on the lasso screen, in this order; "Log All Textboxes" is in its Details. */
export const ACTION_ORDER: Array<Exclude<TextboxActionKind, 'log'>> = [
  'split',
  'splitParagraphs',
  'join',
  'clean',
  'unwrap',
];

/** One name per action: toolbar button, screen, dialog title (DEVELOPMENT-POLICY §4). */
export const ACTION_LABELS: Record<TextboxActionKind, string> = {
  log: 'Log All Textboxes',
  split: 'Split Sentences',
  splitParagraphs: 'Split Paragraphs',
  join: 'Join Text Boxes',
  clean: 'Clean Spaces',
  unwrap: 'Remove Line Breaks',
};

/** What the action shows while it runs. */
export const ACTION_PROGRESS_LABELS: Record<TextboxActionKind, string> = {
  log: 'Logging textboxes…',
  split: 'Splitting sentences…',
  splitParagraphs: 'Splitting paragraphs…',
  join: 'Joining textboxes…',
  clean: 'Cleaning spaces…',
  unwrap: 'Removing line breaks…',
};
