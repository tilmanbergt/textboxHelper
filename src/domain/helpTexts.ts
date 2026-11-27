/**
 * Help texts shown by the "?" button (ui/HelpOverlay.tsx). A help text is plain text: a line that
 * starts with "## " is a heading, everything else is body text. Paragraphs are separated by a
 * blank line. The edit-marker help, with its pictures, is in domain/markHelp.ts.
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

export const TEXTBOX_TOOLS_HELP = `## The actions
Split Sentences: one textbox becomes one textbox per sentence.
Split Paragraphs: one textbox becomes one textbox per paragraph.
Join Text Boxes: textboxes stacked in one column become one, in reading order.
Clean Spaces: repeated spaces and spaces before punctuation go.
Remove Line Breaks: manual line breaks inside the textbox go.

## Choosing
An action that doesn't fit the lasso selection is greyed, with the reason next to it. After shows the result, Before the textboxes as they are now.

## Apply
A backup of the textboxes is written first; the status line names it.`;

export const IMPORT_HELP = `## The file
A plain UTF-8 .txt file from any folder, for example INBOX. Choose › opens the Supernote file selector in the folder the note sits in. Windows and Unix line endings both work.

## Layout
Continuous text: the text flows through textboxes that fill each page from top to bottom.
Paragraph textboxes: each paragraph starts as its own textbox; several can share a page, and a very long paragraph continues in another textbox.

## Paragraphs
Blank lines: paragraphs are separated by an empty line.
Every line: each non-empty line becomes its own paragraph.

## Headings
With "Recognize #, ##, ###", a line starting with "# ", "## " or "### " becomes a heading in its own size (Layout ›, the Manuscript card's Settings → Layout). Example:
# My Topic
This is the first paragraph.
## A section

## Link to file
In the Paragraph boxes layout, "Link to file" places one textbox per heading, paragraph or list of the file and remembers where each came from, so changes can be written back to the file. Blank lines separate the blocks, and headings of every level are recognized. Frontmatter stays out of the note and is kept. Code, formulas, tables, quotes and callouts, HTML, comments, embeds and horizontal lines are kept exactly as they are: a framed placeholder stands for each, which can be moved but isn't edited. Links and formatting stay as text. The file starts with its name as a NOTE title, so it shows in the note's table of contents.

## Adding a file
On a note with linked files, Import adds the file: always linked, on a new page after the last one, with its title. Everything below a file's title up to the next title belongs to that file.

## Whole folder
"Whole folder" binds the chosen file's folder to the note: under "Files and order" choose its files and whether the folder is ordered. An ordered folder keeps the note's order of the files in its index.txt (index.md in Obsidian, a list of [[links]] the plugin writes); a folder with an index.txt is ordered by it. New files of the folder are added later from Manuscript → Files. A note is bound to one folder; it can't get files from elsewhere.

## Where it goes
Into the current page when its writing area is empty, otherwise onto new pages after it. The preview shows the first pages to scale. Font sizes, margins and which headings start a new page are set under Layout › (Settings → Layout); the default margins leave room for handwriting on the right and at the bottom.`;

export const URL_IMPORT_HELP = `## What it does
Downloads one text or Markdown file from an address and saves it as a new .txt file. Then Import opens on that file with its preview; your note changes only when you tap Import there.

## The address
http:// or https://; without one, http:// is used. For VoiceDraft on your phone: http://<the phone's address>:8787/current.md, with the phone on the same Wi-Fi and VoiceDraft sharing the session. Recent: the last five addresses; tap one to use it, Edit to change it in the field, ✕ to forget it.

## What is accepted
Plain text and Markdown (text/plain, text/markdown) in UTF-8, up to 2 MB. Web pages and other files are refused, and nothing is saved. The download stops after 15 s without an answer.

## Where it goes
A new .txt file in the folder under Save to (INBOX unless you change it). An existing file is never overwritten: the new one gets "(Supernote <date> <time>)" in its name. If the folder can't be written, the file goes to EXPORT and the status says so. The name comes from the server, else the text's title or first # heading, else the address.

## Network
Manuscript uses the network only here, when you tap Download: one request for this address. Nothing from your device is sent, nothing keeps running. The first download of a session asks for internet access.`;

export const EXPORT_HELP = `## What is exported
The text of the note's textboxes, in reading order, as a Word file (DOCX) in the Supernote's EXPORT folder. The note doesn't change.

## Headings, paragraphs, comments
Each textbox gets a class from its font size and style: heading, paragraph, comment or meta. Headings and paragraphs are always exported, comments only with "Include comments", meta never. Textboxes in a Supernote title area count as headings. The rules are under Classification rules › (Settings → Export).

## Pages
This page, the whole note, or a page range. The list on the right updates by itself after every change.`;


/** A short "nothing here" with what the place is for (ui/EmptyState.tsx). */
export type EmptyText = {title: string; text: string};

export const NO_MARKS: EmptyText = {
  title: 'No edit marks on this page.',
  text: 'Delete: draw a line through the words. Replace: add a small loop at its end, then write the new words as the very next thing, anywhere on the page; lasso them and tap Insertion or Replacement. ? shows every mark.',
};

/** The Outline's Set aside view with nothing set aside (technical-design-aside-area.md §5.3). */
export const NOTHING_SET_ASIDE: EmptyText = {
  title: 'Nothing set aside yet.',
  text: 'Material you set aside stays in this note and is never written to your files. Set aside a paragraph or a section from Show › All: it moves to pages at the end of the note, under the heading “Set aside”. Add your own headings there on the page to sort it. Bring something back with Move back, or move it with the lasso above the “Set aside” heading.',
};
