/**
 * Paging long styled text by lines (ui/PagedText.tsx, technical-design-calmer-screens.md §3.2).
 *
 * The UI measures the text once at the box's width (React Native's `onTextLayout` reports the
 * laid-out lines) and hands the lines here. A page is as many whole lines as fit the box height;
 * the visible box then renders only the segments cut to that page's character range. Nothing
 * scrolls, and a page never ends in the middle of a line.
 */

export type TextSegmentStyle = 'removed' | 'inserted' | 'heading' | 'muted';

export type TextSegment = {
  text: string;
  style?: TextSegmentStyle;
};

/** One laid-out line as the UI reports it: its text and its height in dp. */
export type MeasuredLine = {
  text: string;
  height: number;
};

/** A line as a character range of the whole text. */
export type TextLine = {
  start: number;
  end: number;
  height: number;
};

/** A page as a character range of the whole text, plus the lines on it. */
export type TextPage = {
  start: number;
  end: number;
  firstLine: number;
  lineCount: number;
};

export function segmentsText(segments: TextSegment[]): string {
  return segments.map(segment => segment.text).join('');
}

/**
 * Character ranges of the measured lines. The line texts are expected to add up to the whole
 * text; if they fall short (a host that trims a trailing newline or space), the rest is added to
 * the last line, and if they run over, the ranges are cut at the text's end, so the pages always
 * cover exactly the whole text.
 */
export function lineRanges(lines: MeasuredLine[], totalLength: number): TextLine[] {
  const ranges: TextLine[] = [];
  let offset = 0;
  for (const line of lines) {
    const start = Math.min(offset, totalLength);
    const end = Math.min(offset + line.text.length, totalLength);
    ranges.push({start, end, height: line.height});
    offset += line.text.length;
  }
  if (ranges.length > 0 && offset < totalLength) {
    ranges[ranges.length - 1].end = totalLength;
  }
  return ranges.filter((range, index) => index === 0 || range.end > range.start);
}

/**
 * Greedy pages: as many whole lines as fit `viewportHeight`, at least one line per page (an
 * oversize line is clipped by the box rather than leaving a page empty).
 */
export function pageRanges(lines: TextLine[], viewportHeight: number): TextPage[] {
  const pages: TextPage[] = [];
  let index = 0;
  while (index < lines.length) {
    let used = 0;
    let count = 0;
    while (index + count < lines.length) {
      const height = lines[index + count].height;
      if (count > 0 && used + height > viewportHeight) {
        break;
      }
      used += height;
      count += 1;
    }
    pages.push({
      start: lines[index].start,
      end: lines[index + count - 1].end,
      firstLine: index,
      lineCount: count,
    });
    index += count;
  }
  return pages;
}

/** The page that holds `charIndex` (the last page for an index past the end, 0 for no pages). */
export function pageIndexForChar(pages: TextPage[], charIndex: number): number {
  for (let index = 0; index < pages.length; index += 1) {
    if (charIndex < pages[index].end) {
      return index;
    }
  }
  return Math.max(0, pages.length - 1);
}

/** The segments cut to the character range [start, end), keeping each piece's style. */
export function sliceSegments(segments: TextSegment[], start: number, end: number): TextSegment[] {
  const result: TextSegment[] = [];
  let offset = 0;
  for (const segment of segments) {
    const segmentStart = offset;
    const segmentEnd = offset + segment.text.length;
    offset = segmentEnd;
    const from = Math.max(start, segmentStart);
    const to = Math.min(end, segmentEnd);
    if (to <= from) {
      continue;
    }
    result.push({
      text: segment.text.slice(from - segmentStart, to - segmentStart),
      ...(segment.style ? {style: segment.style} : {}),
    });
  }
  return result;
}
