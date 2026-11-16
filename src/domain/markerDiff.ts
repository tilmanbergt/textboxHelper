/**
 * The edit-marker review's view of one textbox (technical-design-calmer-screens.md §3.4): the
 * original text with every removed range struck through and, for a replace, the replacement in
 * bold right after it.
 *
 * Built on the original text and the same sorted, de-duplicated ranges the apply step uses
 * (`getUniqueTextMutationRanges`), so what is struck through is exactly what will be removed.
 * The whitespace cleanup after an edit (double spaces collapsed) is not shown. Overlapping ranges
 * are shown once: a range is cut to start where the previous one ended.
 */
import {getUniqueTextMutationRanges} from './markerText';
import type {TextMutationRange} from './markerTypes';
import type {TextSegment} from './textPages';

export function buildDiffSegments(originalText: string, ranges: TextMutationRange[]): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const range of getUniqueTextMutationRanges(ranges)) {
    const start = Math.min(Math.max(range.start, cursor), originalText.length);
    const end = Math.min(Math.max(range.end, start), originalText.length);
    push(segments, originalText.slice(cursor, start));
    push(segments, originalText.slice(start, end), 'removed');
    if (range.kind === 'replace' && range.replacementText) {
      const gap = end > start ? ' ' : '';
      push(segments, `${gap}${range.replacementText}`, 'inserted');
    }
    cursor = Math.max(cursor, end);
  }
  push(segments, originalText.slice(cursor));
  return segments;
}

function push(segments: TextSegment[], text: string, style?: TextSegment['style']): void {
  if (!text) {
    return;
  }
  const previous = segments[segments.length - 1];
  if (previous && previous.style === style) {
    previous.text += text;
    return;
  }
  segments.push(style ? {text, style} : {text});
}
