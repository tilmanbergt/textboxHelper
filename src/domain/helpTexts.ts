/**
 * Help texts shown by the "?" button (ui/HelpOverlay.tsx). A help text is plain text: a line that
 * starts with "## " is a heading, everything else is body text. Paragraphs are separated by a
 * blank line.
 */
import type {TextSegment} from './textPages';

export function helpTextToSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const lines = text.replace(/\r\n/g, '\n').trim().split('\n');
  lines.forEach((line, index) => {
    const isLast = index === lines.length - 1;
    const ending = isLast ? '' : '\n';
    if (line.startsWith('## ')) {
      segments.push({text: `${line.slice(3)}${ending}`, style: 'heading'});
    } else {
      segments.push({text: `${line}${ending}`});
    }
  });
  return mergeAdjacent(segments);
}

function mergeAdjacent(segments: TextSegment[]): TextSegment[] {
  const merged: TextSegment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (previous && previous.style === segment.style) {
      previous.text += segment.text;
    } else {
      merged.push({...segment});
    }
  }
  return merged;
}

export const EDIT_MARKERS_HELP = `## Delete words
Draw a horizontal line through the words you want to remove, with the pen or the straight-line tool. One line of text per marker.

## Replace words
Draw the delete line, then a small circle right after its end or just above the line (or two short vertical lines across it). Right after, write the new words anywhere on the page, lasso them and tap Insertion or Replacement in the lasso toolbar. A circled number appears left of the words, and the same number in your circle at the mark.

## Insert words
Draw a V or ∧ on the line, its tip between two words or inside a word. Right after, write the new text anywhere on the page, lasso it and tap Insertion or Replacement. The number appears between the ends of the caret's legs, so draw it big enough. Between words the spaces are added for you; inside a word the text goes in as written.

## Insert or break paragraphs
A < or > beside the text (one stroke or two lines meeting at the tip) points with its tip between two lines; a step mark (draw under the line to the right, straight up, then on above the next word, or the same falling) marks a word gap. On its own, a < or > breaks the paragraph there; a step needs a second short line next to its upright (_||‾), as two lines mean a break. Followed by tagged text, the text becomes a paragraph of its own there. Between two paragraphs a < or > puts the new text in as a new paragraph. A tip in the middle of a line is unclear and is ignored. Paragraphs below move down to make room.

## Swap two parts
Draw a line above the first part and below the second, joined by a vertical between them: up at the start, over the first part, down between the parts, under the second part, up at the end (|‾‾|__|), or the other way round (under first, over second). Over several lines, draw only three pieces: a start corner (a short vertical, then a line over or under the first words), the middle piece where the first part ends and the second begins (its lines reach past the word on each side), and an end corner (a line ending in a short vertical). The lines in between are optional. A vertical inside a word cuts it there. Punctuation stays where it was; at a sentence's start, "Fix capitals" moves the capital to the new first word. A delete or replacement inside a part is made first, then the parts swap.

## Insert a space
Draw a ∧ under the gap (or a V over it) with a small cross (+, × or #) at its tip: a space goes in there, e.g. inside "thisword".

## One button, the mark decides
Insertion or Replacement tags the lassoed text. The mark you drew just before it decides what it is: a delete line with a circle makes it a replacement, a caret an insertion.

## No mark found?
If no mark is found just before the text, a card says so. Select mark now: draw the mark (or lasso the one you drew), lasso only the mark and tap Insertion or Replacement again within 5 minutes. The text never needs to be written again. Or choose Fix in review: the text waits under Ignored, where Select mark does the same and brings you back to the review.

## Review and apply
The review recognizes the tagged handwriting while you read; until then a grey placeholder stands in the text, with a picture of the handwriting below. Tap the recognized text to fix it: write with the Supernote keyboard's handwriting input, then Done. Skip for later leaves a change on the page for another pass. Apply changes everything that is ready; a backup of the page is written first. Only used markers, carets and tagged handwriting are removed from the page.

## A comma, a space, a letter
Below the selected change, Start and End show the characters around its edges with a bar; ‹ › move the edge by one character (an insertion or paragraph break has one Place). A comma right after a crossed-out word stays unless your line reaches it. "Check place" means the caret's tip was between two lines or inside a word: look at where it went.

## From where
The note button reads every marker on the page. The lasso toolbar button reads only the lassoed markers and textboxes.

## Wrong words picked?
If the status line says a font can't be read, the marks on those textboxes are ignored: copy the font file (same file name) to MyStyle/TextboxHelper/fonts and open the review again. Details has the calibration (X offset, Width) and Save Diagnostics for a bug report. The values are kept for next time.

## Not used, or not wanted
The Ignored tab lists marks and tagged text the review could not use. Drop takes one off the page without applying it, Drop all every one listed; both ask first. For tagged text you choose: keep your handwriting (only the numbers and the mark go) or erase it too (a backup is written first). A change you don't want can be dropped from the Changes tab the same way. Strokes away from any textbox may be your own handwriting and are never offered.`;

export const TEXTBOX_TOOLS_HELP = `## The actions
Split Sentences: one textbox becomes one textbox per sentence.
Split Paragraphs: one textbox becomes one textbox per paragraph.
Join Text Boxes: textboxes stacked in one column become one, in reading order.
Clean Spaces: repeated spaces and spaces before punctuation go.
Remove Line Breaks: manual line breaks inside the textbox go.

## Choosing
An action that doesn't fit the lasso selection is greyed, with the reason next to it. After shows the result, Before the textboxes as they are now.

## Apply
A backup of the textboxes is written first; the status line names it. The same actions are in the lasso toolbar, where they apply right away.`;

export const IMPORT_HELP = `## The file
A plain UTF-8 .txt file in INBOX (or a folder inside it). Choose › opens the Supernote file selector. Windows and Unix line endings both work.

## Layout
Continuous text: the text flows through textboxes that fill each page from top to bottom.
Paragraph textboxes: each paragraph starts as its own textbox; several can share a page, and a very long paragraph continues in another textbox.

## Paragraphs
Blank lines: paragraphs are separated by an empty line.
Every line: each non-empty line becomes its own paragraph.

## Headings
With "Recognize #, ##, ###", a line starting with "# ", "## " or "### " becomes a heading in its own size. Example:
# My Topic
This is the first paragraph.
## A section

## Where it goes
Into the current page when its writing area is empty, otherwise onto new pages after it. The preview shows the first pages to scale. Font size and margins are under Layout.`;

export const EXPORT_HELP = `## What is exported
The text of the note's textboxes, in reading order, as a Word file (DOCX) in the Supernote's EXPORT folder. The note doesn't change.

## Headings, paragraphs, comments
Each textbox gets a class from its font size and style: heading, paragraph, comment or meta. Headings and paragraphs are always exported, comments only with "Include comments", meta never. Textboxes in a Supernote title area count as headings. The rules are under Rules.

## Pages
This page, the whole note, or a page range. The list on the right updates by itself after every change.`;

