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

/** A result segment with the change its new text comes from. */
export type ResultSegment = TextSegment & {op?: string};

/**
 * A paragraph as it will read after all its changes (technical-design-mark-dialogue.md §5.5):
 * its segments, and where in its text each change (by `opId`) is - the start of its new text, or
 * where its removed text was.
 */
export type ParagraphResult = {segments: ResultSegment[]; at: Record<string, number>};

/**
 * The text after all `ranges`, as segments: removed text is left out entirely, new text is bold
 * (`inserted`), a pen edit's text not there yet is muted. The same walk as the apply step
 * (`applyTextMutationRangesDetailed`), the space kept between words included; the apply step's
 * cleanup only takes out whitespace, so its text is aligned back onto the styled characters. Its
 * plain text is the apply step's text.
 */
export function buildParagraphResult(originalText: string, ranges: Array<TextMutationRange & {opId?: string}>): ParagraphResult {
  type Char = {char: string; style?: TextSegment['style']; op?: string};
  let chars: Char[] = [...originalText].map(char => ({char}));
  const places: Array<{op: string; index: number}> = [];
  let offset = 0;
  for (const range of getUniqueTextMutationRanges(ranges) as Array<TextMutationRange & {opId?: string}>) {
    const start = range.start + offset;
    const end = range.end + offset;
    const current = chars.map(item => item.char).join('');
    const replacement = withSpacesKept(current, start, end, range.kind === 'replace' ? range.replacementText || '' : '', range.joins === true);
    const style: TextSegment['style'] | undefined =
      range.kind === 'replace' && replacement.length > 0 ? (range.pending ? 'muted' : 'inserted') : undefined;
    const op = range.opId;
    chars = [
      ...chars.slice(0, start),
      ...[...replacement].map(char => ({char, ...(style ? {style} : {}), ...(style && op ? {op} : {})})),
      ...chars.slice(end),
    ];
    if (op && !places.some(place => place.op === op)) {
      places.push({op, index: start});
    }
    offset += replacement.length - (range.end - range.start);
  }
  const cleaned = normalizeTextAfterEdit(chars.map(item => item.char).join(''));
  const segments: ResultSegment[] = [];
  // Where each styled character lands in the cleaned text.
  const landing: number[] = [];
  let at = 0;
  let index = 0;
  for (const char of cleaned) {
    // The cleanup only removes whitespace (and turns a run of tabs and spaces into one space).
    while (at < chars.length && chars[at].char !== char && !(/\s/.test(char) && /\s/.test(chars[at].char))) {
      landing[at] = index;
      at += 1;
    }
    landing[at] = index;
    pushResult(segments, char, chars[at]?.style, chars[at]?.op);
    at += 1;
    index += 1;
  }
  const where: Record<string, number> = {};
  places.forEach(place => {
    where[place.op] = Math.min(landing[place.index] ?? index, cleaned.length);
  });
  return {segments, at: where};
}

function pushResult(segments: ResultSegment[], text: string, style?: TextSegment['style'], op?: string): void {
  const previous = segments[segments.length - 1];
  if (previous && previous.style === style && previous.op === op) {
    previous.text += text;
    return;
  }
  segments.push({text, ...(style ? {style} : {}), ...(op ? {op} : {})});
}

/**
 * A paragraph result with one change brought forward: its new text underlined in bold, or, for a
 * change that only removes text, the word (or space) where it was underlined. `at` is where the
 * change is in the text (null when the result doesn't hold it, e.g. a change inside a swap).
 */
export function focusResult(result: ParagraphResult, opId: string): {segments: TextSegment[]; at: number | null} {
  const at = result.at[opId] ?? null;
  const plain = (segment: ResultSegment): TextSegment => (segment.style ? {text: segment.text, style: segment.style} : {text: segment.text});
  if (result.segments.some(segment => segment.op === opId)) {
    return {segments: result.segments.map(segment => (segment.op === opId ? {text: segment.text, style: 'focus'} : plain(segment))), at};
  }
  if (at === null) {
    return {segments: result.segments.map(plain), at};
  }
  const text = result.segments.map(segment => segment.text).join('');
  let start = at;
  let end = at;
  if (at > 0 && /\s/.test(text[at - 1])) {
    // Whole words went: the space where they were.
    start = at - 1;
  } else {
    while (start > 0 && !/\s/.test(text[start - 1])) {
      start -= 1;
    }
    while (end < text.length && !/\s/.test(text[end])) {
      end += 1;
    }
  }
  if (start === end) {
    [start, end] = at < text.length ? [at, at + 1] : [Math.max(0, at - 1), at];
  }
  const segments: TextSegment[] = [];
  let position = 0;
  for (const segment of result.segments) {
    const from = position;
    const to = position + segment.text.length;
    position = to;
    const cut = [from, Math.max(from, Math.min(to, start)), Math.max(from, Math.min(to, end)), to];
    [0, 1, 2].forEach(part => {
      const piece = segment.text.slice(cut[part] - from, cut[part + 1] - from);
      if (piece) {
        segments.push(part === 1 ? {text: piece, style: segment.style === 'inserted' ? 'focus' : 'focusPlain'} : plain({...segment, text: piece}));
      }
    });
  }
  return {segments, at};
}
