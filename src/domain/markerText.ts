import {cloneRect} from './geometry';
import type {
  EditMarkerHighlightRange,
  EditMarkerOperationKind,
  EditMarkerPreview,
  TextMutationPlan,
  TextMutationRange,
} from './markerTypes';
import type {PageElementData, Rect, TextElementData} from './textboxModel';

/**
 * The text side of edit markers: applying deletions and replacements to a textbox's text, the
 * highlight ranges for the preview, and the messages and log summaries the review screen and the
 * diagnostics show.
 */

export function roundNumber(value: number): number {
  return Math.round(value * 100) / 100;
}

export function roundRect(rect: Rect): Rect {
  return {
    left: roundNumber(rect.left),
    top: roundNumber(rect.top),
    right: roundNumber(rect.right),
    bottom: roundNumber(rect.bottom),
  };
}

export function shortenSnippet(text: string, limit = 44): string {
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

export function formatOperationSnippet(
  kind: EditMarkerOperationKind,
  words: string[],
  replacementText?: string,
): string {
  const joined = words.join(' ').trim();
  if (!joined) {
    return kind === 'replace' ? 'Replace text' : 'Delete text';
  }

  const shortened = shortenSnippet(joined);
  if (kind === 'replace') {
    const replacementLabel = replacementText?.trim()
      ? shortenSnippet(replacementText.trim())
      : '(missing)';
    return `Replace "${shortened}" -> "${replacementLabel}"`;
  }

  return `Delete "${shortened}"`;
}

export function buildTextboxLogSummary(textbox: TextElementData): Record<string, unknown> {
  return {
    uuid: textbox.uuid,
    numInPage: textbox.numInPage,
    layerNum: textbox.layerNum,
    rect: roundRect(cloneRect(textbox.textBox.textRect)),
    textPreview: (textbox.textBox.textContentFull || '').slice(0, 80).replace(/\s+/g, ' '),
    textLength: (textbox.textBox.textContentFull || '').length,
    fontSize: textbox.textBox.fontSize,
    fontPath: textbox.textBox.fontPath,
    textAlign: textbox.textBox.textAlign,
    textBold: textbox.textBox.textBold,
  };
}

export function normalizeTextAfterEdit(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\[\s+/g, '[')
    .replace(/\{\s+/g, '{')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * A deletion or replacement never glues the words around it together (technical-design-fine-
 * marks.md §2.1): when the removed text started or ended with a space and the characters that now
 * meet are both letters or digits, one space is put back on that side. Word-level marks never
 * remove a space, so this only acts on exact ranges (verticals around "big "). A range that joins
 * words on purpose (`joins`) is left as it is.
 */
export function withSpacesKept(
  text: string,
  start: number,
  end: number,
  replacement: string,
  joins: boolean,
): string {
  if (joins || end <= start) {
    return replacement;
  }
  const removed = text.slice(start, end);
  const left = text.charAt(start - 1);
  const right = text.charAt(end);
  const startsWithSpace = /^\s/.test(removed);
  const endsWithSpace = /\s$/.test(removed);
  if (!startsWithSpace && !endsWithSpace) {
    return replacement;
  }
  if (replacement === '') {
    return WORD_CHAR.test(left) && WORD_CHAR.test(right) ? ' ' : '';
  }
  const before = startsWithSpace && WORD_CHAR.test(left) && WORD_CHAR.test(replacement.charAt(0)) ? ' ' : '';
  const after =
    endsWithSpace && WORD_CHAR.test(right) && WORD_CHAR.test(replacement.charAt(replacement.length - 1))
      ? ' '
      : '';
  return `${before}${replacement}${after}`;
}

export function getUniqueTextMutationRanges(ranges: TextMutationRange[]): TextMutationRange[] {
  return [...ranges]
    .sort((left, right) => {
      if (left.start !== right.start) {
        return left.start - right.start;
      }

      return left.end - right.end;
    })
    .filter(
      (range, index, allRanges) =>
        index === 0 ||
        range.start !== allRanges[index - 1].start ||
        range.end !== allRanges[index - 1].end ||
        range.kind !== allRanges[index - 1].kind ||
        (range.replacementText || '') !== (allRanges[index - 1].replacementText || ''),
    );
}

export function applyTextMutationRangesDetailed(
  text: string,
  ranges: TextMutationRange[],
): {text: string; insertedRanges: EditMarkerHighlightRange[]} {
  const uniqueRanges = getUniqueTextMutationRanges(ranges);
  let nextText = text;
  let offset = 0;
  const insertedRanges: EditMarkerHighlightRange[] = [];

  for (const range of uniqueRanges) {
    const currentStart = range.start + offset;
    const currentEnd = range.end + offset;
    const replacementText = withSpacesKept(
      nextText,
      currentStart,
      currentEnd,
      range.kind === 'replace' ? range.replacementText || '' : '',
      range.joins === true,
    );
    nextText = `${nextText.slice(0, currentStart)}${replacementText}${nextText.slice(currentEnd)}`;
    if (range.kind === 'replace' && replacementText.length > 0) {
      insertedRanges.push({
        start: currentStart,
        end: currentStart + replacementText.length,
      });
    }
    offset += replacementText.length - (range.end - range.start);
  }

  return {
    text: normalizeTextAfterEdit(nextText),
    insertedRanges: mergeHighlightRanges(insertedRanges),
  };
}

export function applyTextMutationRanges(
  text: string,
  ranges: TextMutationRange[],
): string {
  return applyTextMutationRangesDetailed(text, ranges).text;
}

/** The preview of a page without edit marks or pen edits. */
export function createEmptyPreview(): EditMarkerPreview {
  return {
    hunks: [],
    fontWarning: null,
    operations: [],
    toDecide: [],
    results: {},
    canApply: false,
    applyPlan: null,
    base: null,
    penEdits: [],
    pendingCount: 0,
  };
}

export function mergeHighlightRanges(
  ranges: EditMarkerHighlightRange[],
): EditMarkerHighlightRange[] {
  if (ranges.length === 0) {
    return [];
  }

  const sorted = [...ranges]
    .filter(range => range.end > range.start)
    .sort((left, right) => left.start - right.start);
  const merged: EditMarkerHighlightRange[] = [sorted[0]];

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const previous = merged[merged.length - 1];

    if (current.start <= previous.end) {
      previous.end = Math.max(previous.end, current.end);
      continue;
    }

    merged.push({...current});
  }

  return merged;
}

export function cloneTextElementForMutation<Textbox extends TextElementData>(
  element: Textbox,
  mutation: TextMutationPlan,
): Textbox {
  return {
    ...element,
    textBox: {
      ...element.textBox,
      textContentFull: mutation.nextText,
      textRect: cloneRect(mutation.nextTextRect),
    },
  } as Textbox;
}

export function countElementTypes(elements: PageElementData[]): Record<string, number> {
  const counts: Record<string, number> = {};
  elements.forEach(element => {
    const key = `type-${element.type}-layer-${element.layerNum}`;
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}
