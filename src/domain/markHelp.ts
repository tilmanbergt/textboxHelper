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
  /** Whether the mark takes tagged handwriting, written as the very next thing after it. */
  needsText: boolean;
  /** How to draw it: one or two sentences. */
  draw: string;
  /** The limits that matter, short; not every rule. */
  keep: string[];
};

export type HelpBlock = {title: string; text: string};

/**
 * A block of Getting started (technical-design-release-readiness.md §5.1): text, optionally the
 * overview rows of some marks below it, and the cheat sheet button.
 */
export type StartBlock = HelpBlock & {marks?: string[]; cheatSheet?: boolean};

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
    draw: 'Strike the words, then a small circle at the end of the line or just above it. Then, as the very next thing, write the new words anywhere on the page and tag them.',
    keep: [
      'Write the new words as the very next thing after the mark: the text pairs with the mark drawn just before it.',
      'No mark found? The card offers Select mark; nothing needs writing again.',
    ],
  },
  {
    id: 'insert',
    name: 'Insert',
    glance: '∧ or V where the words go',
    needsText: true,
    draw: 'A ∧ or V on the line, its tip between two words or inside a word, big enough for the number between its legs (or draw an empty circle there for it). Then, as the very next thing, write the new text anywhere on the page and tag it.',
    keep: [
      'In a gap it adds words, with spaces; between letters it adds letters, without.',
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
    id: 'delete-letters',
    name: 'Delete letters',
    glance: 'Strike with two short lines',
    needsText: false,
    draw: 'Strike the letters and draw a short line across each end of the strike, exactly where the deletion starts and ends. Nothing to write: exactly what is between the lines goes.',
    keep: [
      'The short lines mark exact places, from one letter to several words, even inside a word; a strike alone takes whole words.',
      'To replace exactly that part, add a small circle after the strike and tag the new text: the number goes into the circle.',
    ],
  },
  {
    id: 'slash',
    name: 'One letter',
    glance: 'A slash through it',
    needsText: false,
    draw: 'A short slash through the letter: on its own it deletes the letter; with tagged text written as the very next thing after it, the text replaces it.',
    keep: [
      'One letter (or punctuation mark) per slash; a slash through a space is ignored.',
      'Draw a small circle just above it if you want the number there.',
    ],
  },
  {
    id: 'punctuation',
    name: 'Punctuation',
    glance: '∧ or V with a filled circle',
    needsText: false,
    draw: 'A ∧ or V with its tip where the mark goes, and a small circle between its legs with the mark written inside: , ; . : \' or -. Nothing to tag.',
    keep: [
      'Commas and full stops attach to the word before; a hyphen in a gap joins the two words.',
      'If it isn\'t read clearly, the review asks you to tap the right mark - it never puts in a letter.',
    ],
  },
  {
    id: 'close-up',
    name: 'Close up',
    glance: 'An arc under the gap',
    needsText: false,
    draw: 'A flat arc under the gap between two words (or over it), from the last letters of one word to the first of the next.',
    keep: [
      'One gap per arc; the arc opens toward its line.',
      'A dash or comma at the gap stays unless you tick "Also remove" in the review.',
    ],
  },
  {
    id: 'close-up-wrap',
    name: 'Close up at a line end, join',
    glance: 'Two arcs, end and start',
    needsText: false,
    draw: 'The same arc twice, as if the words were on one line: one after the last word of the line, one before the first word of the next.',
    keep: ['After a paragraph and before the one right below it, the arcs join the two.'],
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
      'Without the second line a step is the middle of a swap, or listed under To decide.',
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
    draw: 'A < or > in the space between two paragraphs. Then, as the very next thing, write the new paragraph anywhere on the page and tag it.',
    keep: ['The text becomes a textbox of its own; paragraphs below move down to make room.'],
  },
];

/** The keys under the overview. */
export const MARK_HELP_KEYS = {
  text: 'Make the mark, then write the new words as the very next thing, anywhere on the page. Lasso them and tap Insertion or Replacement in the lasso toolbar.',
  numbers: 'Grey numbers are placed by Manuscript when you tag text. They pair the text with its mark; you never write them.',
};

export const REVIEW_HELP: HelpBlock[] = [
  {
    title: 'Manuscript',
    text: 'The Manuscript button in the note toolbar reads every mark on the page. Strokes away from any textbox are your own handwriting and are left alone.',
  },
  {
    title: 'The list',
    text: 'Every change in reading order: the changed text in full, struck through or in bold, with a few words around it. Tap a change to see it on the right, with more of its text.',
  },
  {
    title: 'Tagged text',
    text: 'It is recognized while you read; until then a grey placeholder stands in. On the right, tap the recognized text to correct it with the Supernote keyboard’s handwriting input, then Done. The handwriting is shown below it.',
  },
  {
    title: 'To decide',
    text: 'The third tab: a numbered mark whose place stayed open (move it with ‹ › and tap Here), tagged text with a ? (Select mark, Insert right here, or keep it as a Comment or an Image), strokes on the text that read as no clear mark (read them as one of the marks offered, Ignore, or Remove), and a comment or image on a page without a paragraph. Select mark: draw the mark (or lasso the one you drew), lasso only the mark and tap Insertion or Replacement within 5 minutes.',
  },
  {
    title: 'Comments and images',
    text: 'Lasso handwriting beside the text and tap Comment or Image, then choose. A comment gets a speech bubble with C, an image a double square frame; neither has a number, and Apply never changes them. Each belongs to the paragraph beside it. The Notes tab lists them: Read a comment, correct it, choose its paragraph with ‹ ›, tick it Done, or Use as text to make it tagged text again; for an image choose Before or After its paragraph. Drop takes the sign off; the handwriting stays. Images are written to the file in a later version.',
  },
  {
    title: 'A comma, a space, a letter',
    text: 'On the right, ‹ › move an edge of the change by one character: one Place for an insertion, Start and End for a delete or replace, and for a swap the start of the first part, where the parts meet, and the end of the second part.',
  },
  {
    title: 'Not wanted',
    text: 'Drop takes a mark or tagged text off the page without applying it; it asks on the right first. For tagged text you keep your handwriting or erase it too.',
  },
  {
    title: 'Apply',
    text: 'Applies every change that is ready, after writing a backup of the page. Tagged text still being recognized stays on the page for another pass. Used marks, numbers and tagged handwriting are removed.',
  },
  {
    title: 'Linked text files',
    text: 'A note imported with "Link to file" names its file (or "3 files") in the header; each file starts with its name as a title. Apply also updates the files that changed ("Also update …", untick it for one Apply). With no marks waiting but the note changed - typed in a textbox, joined, moved - the button is "Update …". A file changed outside since the last write is not overwritten: Files → Save as copy. Deleting a framed "kept as is" block asks before it leaves the file.',
  },
  {
    title: 'Set aside',
    text: 'In the Outline, Set aside moves a paragraph or a section to the end of the note, under the heading “Set aside”: it stays in the note and is never written to a file or exported. Show › Set aside lists it, under your own headings typed there; Move back puts it into the text again. Everything below “Set aside” is aside, also what you move there with the lasso.',
  },
  {
    title: 'Wrong words picked?',
    text: 'If the status line says a font can’t be read, the marks on those textboxes are ignored: copy the font file (same file name) to MyStyle/Manuscript/fonts and open Manuscript again. Settings has the calibration and, under Diagnostics, Report a problem: one file for a bug report.',
  },
];

/** Getting started, the first pages of the help (technical-design-release-readiness.md §5.1). */
export const GETTING_STARTED: StartBlock[] = [
  {
    title: 'What Manuscript does',
    text: 'Your text sits in textboxes in a note. You mark edits by pen as on paper, Manuscript reads the marks, shows every change, and applies the ones you want. Text files come in and go out through Files.',
  },
  {
    title: 'The buttons',
    text: 'Manuscript (note toolbar): the card - Review lists the marks of the pages and applies them, Outline shows headings and paragraphs to move, Files imports, links and exports, Settings. Insertion or Replacement (lasso toolbar): lasso the new words you wrote as the very next thing after a mark, anywhere on the page, to make them its new text. Comment or Image (lasso toolbar): keep handwriting beside the text as a comment or an image. Textbox Tools (lasso toolbar, with textboxes selected): split, join, clean up.',
  },
  {
    title: 'The core marks',
    text: 'More marks - letters, spaces, punctuation, swaps, paragraphs - on the next pages.',
    marks: ['delete', 'replace', 'insert'],
  },
  {
    title: 'First things to do',
    text: 'Import a text: Manuscript → Files → Import a text file. Put the cheat sheet of the marks on a page to keep it at hand. Then mark something and open Manuscript.',
    cheatSheet: true,
  },
  {
    title: 'Good to know',
    text: 'Your text is backed up before every change. Manuscript is developed on the A5 X; other devices are beta. Something wrong? Settings → Diagnostics → Report a problem writes one file for a bug report.',
  },
];
