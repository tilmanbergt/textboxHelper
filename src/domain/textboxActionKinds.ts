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

export const ACTION_ORDER: TextboxActionKind[] = [
  'log',
  'split',
  'join',
  'clean',
  'unwrap',
];

export const ACTION_LABELS: Record<TextboxActionKind, string> = {
  log: 'Log All Textboxes',
  split: 'Split Sentences',
  splitParagraphs: 'Split Paragraphs',
  join: 'Join Text Boxes',
  clean: 'Clean Spaces',
  unwrap: 'Remove Line Breaks',
};
