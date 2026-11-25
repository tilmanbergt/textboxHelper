/**
 * A textbox's text as the review shows its changes (technical-design-calmer-screens.md §3.4): the
 * original text with every removed range struck through and, for a replace, the replacement in
 * bold right after it. A pen edit whose text isn't there yet shows a muted placeholder instead.
 *
 * Built on the original text and the same sorted, de-duplicated ranges the apply step uses
 * (`getUniqueTextMutationRanges`), so what is struck through is exactly what will be removed.
 * The whitespace cleanup after an edit (double spaces collapsed) is not shown. Overlapping ranges
 * are shown once: a range is cut to start where the previous one ended.
 */
import {getUniqueTextMutationRanges, normalizeTextAfterEdit, withSpacesKept} from './markerText';
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
      push(segments, `${gap}${range.replacementText}`, range.pending ? 'muted' : 'inserted');
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

/**
 * A paragraph as it will read after its changes (technical-design-mark-dialogue.md §5.5): removed
 * text is left out entirely, new text is bold (`inserted`), a pen edit's text not there yet is
 * muted. The same walk as the apply step (`applyTextMutationRangesDetailed`), the space kept
 * between words included; the apply step's cleanup only takes out whitespace, so its text is
 * aligned back onto the styled characters. Its plain text is the apply step's text.
 */
export function buildResultSegments(originalText: string, ranges: TextMutationRange[]): TextSegment[] {
  type Char = {char: string; style?: TextSegment['style']};
  let chars: Char[] = [...originalText].map(char => ({char}));
  let offset = 0;
  for (const range of getUniqueTextMutationRanges(ranges)) {
    const start = range.start + offset;
    const end = range.end + offset;
    const current = chars.map(item => item.char).join('');
    const replacement = withSpacesKept(current, start, end, range.kind === 'replace' ? range.replacementText || '' : '', range.joins === true);
    const style: TextSegment['style'] | undefined =
      range.kind === 'replace' && replacement.length > 0 ? (range.pending ? 'muted' : 'inserted') : undefined;
    chars = [...chars.slice(0, start), ...[...replacement].map(char => ({char, ...(style ? {style} : {})})), ...chars.slice(end)];
    offset += replacement.length - (range.end - range.start);
  }
  const cleaned = normalizeTextAfterEdit(chars.map(item => item.char).join(''));
  const segments: TextSegment[] = [];
  let at = 0;
  for (const char of cleaned) {
    // The cleanup only removes whitespace (and turns a run of tabs and spaces into one space).
    while (at < chars.length && chars[at].char !== char && !(/\s/.test(char) && /\s/.test(chars[at].char))) {
      at += 1;
    }
    push(segments, char, chars[at]?.style);
    at += 1;
  }
  return segments;
}
