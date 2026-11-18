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
Draw the delete line, then a small circle right after its end or just above the line (or two short vertical lines across it). Right after, write the new words anywhere on the page, lasso them and tap Replacement in the lasso toolbar. A circled number appears left of the words, and the same number in your circle at the mark. The older way still works: a line in a textbox below the paragraph that starts with #.

## Insert a paragraph
Make room between two paragraphs, write the new text there, lasso it and tap Insertion.

## Review and apply
The review recognizes the tagged handwriting while you read; until then a grey placeholder stands in the text, with a picture of the handwriting below. Correct fixes the text (write with the Supernote's handwriting pad), Skip for later leaves it on the page for another pass. Apply changes everything that is ready; a backup of the page is written first. Only used markers and tagged handwriting are removed from the page.

## From where
The note button reads every marker on the page. The lasso toolbar button reads only the lassoed markers and textboxes.

## Wrong words picked?
Details has the calibration (X offset, Width) and Save Diagnostics for a bug report. The values are kept for next time.

## Not used
The Ignored tab lists marks and tagged text the review could not use. Remove deletes one from the page, Remove all every one listed with a button; tap twice to confirm. Strokes away from any textbox may be your own handwriting and are never offered for removal.`;

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

