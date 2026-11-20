import {buildDiffSegments} from './markerDiff';
import type {ChangeHunk, RecognizedEditOperation, TextMutationRange} from './markerTypes';
import type {SwapZones} from './swapMark';
import type {TextSegment} from './textPages';

/**
 * The review's list entries (technical-design-manuscript.md §4.3): one hunk per change, with the
 * changed text in full and the rest of its textbox as context. The list shows a few words of the
 * context, the side bar more (`lastWords`, `firstWords`). Built from the same ranges the review
 * shows, so a hunk reads like the textbox will. Pure.
 */

/** A line break inside a hunk reads as a paragraph sign, so a hunk stays one flowing text. */
const flat = (text: string) => text.replace(/ ?¶?\n/g, ' ¶ ');

export function changeLabel(operation: RecognizedEditOperation): string {
  const number = operation.penEditNumber;
  switch (operation.kind) {
    case 'insert':
      return operation.targetTextboxUuid.startsWith('new:')
        ? `New paragraph ${number ?? ''}`.trim()
        : `Insert ${number ?? ''}`.trim();
    case 'split':
      return 'Paragraph break';
    case 'space':
      return 'Space';
    case 'swap':
      return 'Swap';
    case 'replace':
      return number !== undefined ? `Replace ${number}` : 'Replace';
    default:
      return 'Delete';
  }
}

export function changeMeta(operation: RecognizedEditOperation): string {
  const place =
    operation.kind === 'insert' || operation.kind === 'split' || operation.kind === 'space'
      ? operation.detail
      : `Textbox ${operation.targetTextboxNumInPage} · line ${operation.lineIndex + 1}`;
  return [
    place,
    operation.uncertain ? 'Check place' : null,
    operation.insideSwap ? 'inside a swap' : null,
    operation.swap?.waitingFor?.length ? 'waiting' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * A change inside a textbox: its ranges (as the review shows them) with the textbox text around
 * them. A new paragraph has no textbox: its text is the whole hunk.
 */
export function buildHunk(
  operation: RecognizedEditOperation,
  original: string,
  ranges: TextMutationRange[],
): ChangeHunk {
  const head = {operationId: operation.id, label: changeLabel(operation), meta: changeMeta(operation)};
  if (ranges.length === 0) {
    return {...head, before: '', segments: [], after: ''};
  }
  const from = Math.min(...ranges.map(range => range.start));
  const to = Math.max(...ranges.map(range => range.end));
  const segments = buildDiffSegments(
    original.slice(from, to),
    ranges.map(range => ({...range, start: range.start - from, end: range.end - from})),
  ).map(segment => ({...segment, text: flat(segment.text)}));
  return {
    ...head,
    before: flat(original.slice(0, from)),
    segments,
    after: flat(original.slice(to)),
  };
}

/**
 * A swap: the first part struck at its old place, the second part as it is, the first part in
 * bold at its new place. When the swap also moves punctuation or a capital, the new order is shown
 * whole after the old text struck through. A swap waiting for a change inside it (`result` null)
 * shows its parts greyed.
 */
export function buildSwapHunk(
  operation: RecognizedEditOperation,
  original: string,
  zones: SwapZones,
  result: string | null,
): ChangeHunk {
  const a = original.slice(zones.a0, zones.a1);
  const gap = original.slice(zones.a1, zones.b0);
  const b = original.slice(zones.b0, zones.b1);
  const segments: TextSegment[] =
    result === null
      ? [{text: flat(original.slice(zones.a0, zones.b1)), style: 'muted'}]
      : result === `${b}${gap}${a}`
      ? [
          {text: flat(a), style: 'removed'},
          {text: flat(`${gap}${b}`)},
          {text: flat(`${gap}${a}`), style: 'inserted'},
        ]
      : [
          {text: flat(original.slice(zones.a0, zones.b1)), style: 'removed'},
          {text: ` ${flat(result)}`, style: 'inserted'},
        ];
  return {
    operationId: operation.id,
    label: changeLabel(operation),
    meta: changeMeta(operation),
    before: flat(original.slice(0, zones.a0)),
    segments,
    after: flat(original.slice(zones.b1)),
  };
}

/** Words with the spaces after each, so joining them gives the text back. */
function wordsOf(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

/** The last `count` words of a context before a change, with "…" when it is cut. */
export function lastWords(text: string, count: number): string {
  const words = wordsOf(text);
  return words.length <= count ? text : `…${words.slice(-count).join('')}`;
}

/** The first `count` words of a context after a change, with "…" when it is cut. */
export function firstWords(text: string, count: number): string {
  const words = text.match(/\s*\S+/g) ?? [];
  return words.length <= count ? text : `${words.slice(0, count).join('')} …`;
}
