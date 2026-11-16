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
Draw the delete line, then two short vertical lines crossing it. Below the paragraph, write the replacement as a line in a textbox that starts with #, for example "# corrected phrase". Several replacements are matched in reading order.

## Review and apply
The review shows each changed textbox with the removed words struck through and replacements in bold. Apply changes all of them at once; a backup of the page is written first. Only recognized markers are removed from the page.

## From where
The note button reads every marker on the page. The lasso toolbar button reads only the lassoed markers and textboxes.

## Wrong words picked?
Details has the calibration (X offset, Width) and Save Diagnostics for a bug report. The values are kept for next time.`;
