/**
 * The words of the edit-marker help (technical-design-mark-help.md §4): one entry per mark, in
 * the order of the overview, and the blocks about the review that follow the marks. The pictures
 * with the same ids are drawn from docs/user/marks/marks.mjs (`npm run marks`); a test checks
 * that every entry has its picture and icon.
 */

export type MarkHelpEntry = {
  /** The picture's id in docs/user/marks/marks.mjs. */
  id: string;
  name: string;
  /** One line on the overview: what the mark looks like. */
  glance: string;
  /** Whether the mark needs tagged handwriting written right after it. */
  needsText: boolean;
  /** How to draw it: one or two sentences. */
  draw: string;
  /** The limits that matter, short; not every rule. */
  keep: string[];
};

export type HelpBlock = {title: string; text: string};

export const MARK_HELP: MarkHelpEntry[] = [
  {
    id: 'delete',
    name: 'Delete',
    glance: 'A line through the words',
    needsText: false,
    draw: 'A horizontal line through the words, with the pen or the straight-line tool.',
    keep: [
      'One line of text per stroke: draw another for the next line.',
      'A comma right after a struck word stays unless your line reaches it.',
    ],
  },
  {
    id: 'replace',
    name: 'Replace',
    glance: 'Strike, plus a small circle',
    needsText: true,
    draw: 'Strike the words, then a small circle right after the line or just above it (or two short lines across it). Then write the new words and tag them.',
    keep: [
      'Tag right after drawing: the text pairs with the mark drawn just before it.',
      'No mark found? The card offers Select mark; nothing needs writing again.',
    ],
  },
  {
    id: 'insert',
    name: 'Insert',
    glance: '∧ or V where the words go',
    needsText: true,
    draw: 'A ∧ or V on the line, its tip between two words or inside a word, big enough for the number between its legs. Then write the new text and tag it.',
    keep: [
      'Between words the spaces are added for you; inside a word the text goes in as written.',
      '"Check place" means the tip was between two lines: look where the text went.',
    ],
  },
  {
    id: 'space',
    name: 'Space',
    glance: '∧ or V with a small cross',
    needsText: false,
    draw: 'A ∧ under the gap (or a V over it) with a small cross (+, × or #) at its tip. Nothing to write.',
    keep: [
      'Works inside a word: "thisword" becomes "this word".',
      'A caret with no cross and no tagged text is ignored, never guessed.',
    ],
  },
  {
    id: 'swap',
    name: 'Swap',
    glance: 'Over one part, under the next',
    needsText: false,
    draw: 'Up at the start, over the first part, down between the parts, under the second part, up at the end (|‾‾|__|), or under first and over second.',
    keep: [
      'Over several lines, a start corner, the middle piece and an end corner are enough.',
      'Punctuation stays where it was; a delete or replacement inside a part is made first.',
    ],
  },
  {
    id: 'paragraph-step',
    name: 'Break at a word',
    glance: 'Step mark with a second line',
    needsText: false,
    draw: 'Under the line, straight up at the gap, on above the next word (or falling), plus a second short line next to the upright (_||‾).',
    keep: [
      'Without the second line a step is the middle of a swap, or listed under Ignored.',
      'The rest becomes a textbox of its own; paragraphs below move down.',
    ],
  },
  {
    id: 'paragraph-sideways',
    name: 'Break between lines',
    glance: '< or > beside the text',
    needsText: false,
    draw: 'A < or > beside the text, its tip between two lines: one stroke, or two lines meeting at the tip.',
    keep: [
      'A tip in the middle of a line is unclear and is ignored.',
      'Followed by tagged text, the text becomes a paragraph of its own there.',
    ],
  },
  {
    id: 'insert-paragraph',
    name: 'New paragraph',
    glance: '< or > between paragraphs',
    needsText: true,
    draw: 'A < or > in the space between two paragraphs. Then write the new paragraph and tag it.',
    keep: ['The text becomes a textbox of its own; paragraphs below move down to make room.'],
  },
];

/** The keys under the overview. */
export const MARK_HELP_KEYS = {
  text: 'Right after the mark, write the new words anywhere on the page, lasso them and tap Insertion or Replacement in the lasso toolbar.',
  numbers: 'Grey numbers are placed by Textbox Tools when you tag text. They pair the text with its mark; you never write them.',
};

export const REVIEW_HELP: HelpBlock[] = [
  {
    title: 'From where',
    text: 'The note button reads every mark on the page, the lasso toolbar button only the lassoed marks and textboxes. Strokes away from any textbox are your own handwriting and are left alone.',
  },
  {
    title: 'Tagged text',
    text: 'The review recognizes it while you read; until then a grey placeholder stands in, with a picture of the handwriting below. Tap the text to fix it with the Supernote keyboard’s handwriting input, then Done.',
  },
  {
    title: 'No mark found?',
    text: 'A card says so right after tagging. Select mark now: draw the mark (or lasso the one you drew), lasso only the mark and tap Insertion or Replacement again within 5 minutes. Or Fix in review: the text waits under Ignored, where Select mark does the same.',
  },
  {
    title: 'A comma, a space, a letter',
    text: 'Below the selected change, Start and End show the characters around its edges; ‹ › move an edge by one character (an insertion or paragraph break has one Place).',
  },
  {
    title: 'Not used, or not wanted',
    text: 'Ignored lists what the review could not use, each with the reason. Drop takes a mark or tagged text off the page without applying it; for tagged text you keep your handwriting or erase it too.',
  },
  {
    title: 'Apply',
    text: 'Applies every change that is ready, after writing a backup of the page. Skip for later leaves a change on the page for another pass. Used marks, numbers and tagged handwriting are removed.',
  },
  {
    title: 'Wrong words picked?',
    text: 'If the status line says a font can’t be read, the marks on those textboxes are ignored: copy the font file (same file name) to MyStyle/TextboxHelper/fonts and open the review again. Details has the calibration and Save Diagnostics for a bug report.',
  },
];
