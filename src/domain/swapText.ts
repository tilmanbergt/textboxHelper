import {SPLIT_SIGN} from './paragraphMarks';
import type {SwapZones} from './swapMark';

/**
 * The text of a swap (technical-design-swap-space-marks.md §5.2, §6.2): the two parts change
 * places, punctuation at their ends stays where it was, and a capital at a sentence's start can
 * move to the new first word. Other changes inside a part are made first, then the parts swap.
 * Pure.
 */

const LEADING = /^[([{„«“‘'"¿¡]+/;
const TRAILING = /[.,;:!?…)\]}»”’'"]+$/;

function split(part: string): {lead: string; core: string; trail: string} {
  const lead = part.match(LEADING)?.[0] ?? '';
  const rest = part.slice(lead.length);
  const trail = rest.match(TRAILING)?.[0] ?? '';
  const core = rest.slice(0, rest.length - trail.length);
  // A part that is only punctuation keeps it as its core.
  return core ? {lead, core, trail} : {lead: '', core: part, trail: ''};
}

const isUpper = (char: string) => char !== char.toLowerCase() && char === char.toUpperCase();
const isLower = (char: string) => char !== char.toUpperCase() && char === char.toLowerCase();

/** Whether the text before `offset` ends a sentence (or there is none). */
export function startsSentence(text: string, offset: number): boolean {
  const before = text.slice(0, offset);
  const trimmed = before.trimEnd();
  return trimmed === '' || /\n\s*$/.test(before) || /[.!?…]["'”’»)\]]*$/.test(trimmed);
}

/** Whether "Fix capitals" applies: the first part starts a sentence with a capital, the second with a small letter. */
export function capsAvailable(a: string, b: string, sentenceStart: boolean): boolean {
  if (!sentenceStart) {
    return false;
  }
  const coreA = split(a).core;
  const coreB = split(b).core;
  return isUpper(coreA.charAt(0)) && isLower(coreB.charAt(0));
}

function keepsCapital(core: string): boolean {
  const word = core.split(/\s/)[0];
  return word === 'I' || (word.length > 1 && word === word.toUpperCase() && word !== word.toLowerCase());
}

/** The two parts swapped: punctuation stays in its slot; with `fixCase`, the capital moves. */
export function swapParts(a: string, gap: string, b: string, fixCase: boolean, sentenceStart: boolean): string {
  const partA = split(a);
  const partB = split(b);
  let coreA = partA.core;
  let coreB = partB.core;
  if (fixCase && capsAvailable(a, b, sentenceStart)) {
    coreB = coreB.charAt(0).toUpperCase() + coreB.slice(1);
    if (!keepsCapital(coreA)) {
      coreA = coreA.charAt(0).toLowerCase() + coreA.slice(1);
    }
  }
  return `${partA.lead}${coreB}${partA.trail}${gap}${partB.lead}${coreA}${partB.trail}`;
}

/** Another change in the same textbox, as the swap sees it. */
export type ChangeNearSwap = {
  id: string;
  start: number;
  end: number;
  /** Its new text ('' for a delete). */
  text: string;
  ready: boolean;
};

export type SwapComposition =
  | {kind: 'ok'; text: string; innerIds: string[]; capsAvailable: boolean}
  | {kind: 'conflict'; reason: string}
  | {kind: 'waiting'; waitingIds: string[]};

type Zone = 'outside' | 'a' | 'gap' | 'b' | 'crossing';

function zoneOf(zones: SwapZones, start: number, end: number): Zone {
  const {a0, a1, b0, b1} = zones;
  if (start === end) {
    if (start <= a0 || start >= b1) {
      return 'outside';
    }
    return start < a1 ? 'a' : start > b0 ? 'b' : 'gap';
  }
  if (end <= a0 || start >= b1) {
    return 'outside';
  }
  if (start >= a0 && end <= a1) {
    return 'a';
  }
  if (start >= b0 && end <= b1) {
    return 'b';
  }
  if (start >= a1 && end <= b0) {
    return 'gap';
  }
  return 'crossing';
}

function applyInside(text: string, from: number, changes: ChangeNearSwap[]): string {
  let result = text;
  [...changes]
    .sort((left, right) => right.start - left.start || right.end - left.end)
    .forEach(change => {
      const start = change.start - from;
      const end = change.end - from;
      result = `${result.slice(0, start)}${change.text}${result.slice(end)}`;
    });
  return result;
}

/**
 * The swap with the other changes of its textbox: the ones inside a part (or the gap) are made
 * first and the edited parts swapped; a change before or after it stays its own. A change
 * reaching over an edge, a paragraph break inside, or a part left empty is a conflict; a change
 * inside that isn't ready yet (a pen edit being recognized or skipped) makes the swap wait.
 */
export function composeSwap(
  original: string,
  zones: SwapZones,
  changes: ChangeNearSwap[],
  fixCase: boolean,
): SwapComposition {
  const inner: Array<ChangeNearSwap & {zone: 'a' | 'gap' | 'b'}> = [];
  for (const change of changes) {
    const zone = zoneOf(zones, change.start, change.end);
    if (zone === 'outside') {
      continue;
    }
    if (zone === 'crossing') {
      return {kind: 'conflict', reason: 'Another change reaches over an edge of the swapped parts: apply it first, then swap.'};
    }
    if (change.text.includes(SPLIT_SIGN)) {
      return {kind: 'conflict', reason: 'A paragraph break inside the swap: apply it first, then swap.'};
    }
    inner.push({...change, zone});
  }
  const waiting = inner.filter(change => !change.ready).map(change => change.id);
  if (waiting.length > 0) {
    return {kind: 'waiting', waitingIds: waiting};
  }
  const part = (zone: 'a' | 'gap' | 'b', from: number, to: number) =>
    applyInside(
      original.slice(from, to),
      from,
      inner.filter(change => change.zone === zone),
    );
  const a = part('a', zones.a0, zones.a1);
  const gap = part('gap', zones.a1, zones.b0);
  const b = part('b', zones.b0, zones.b1);
  if (!a.trim() || !b.trim()) {
    return {kind: 'conflict', reason: 'One swapped part is deleted completely: nothing to swap with.'};
  }
  const sentenceStart = startsSentence(original, zones.a0);
  return {
    kind: 'ok',
    text: swapParts(a, gap, b, fixCase, sentenceStart),
    innerIds: inner.map(change => change.id),
    capsAvailable: capsAvailable(a, b, sentenceStart),
  };
}

/** "big" ⇄ "red": the two parts for the review's row, shortened. */
export function swapSummary(a: string, b: string, limit = 24): string {
  const short = (part: string) => {
    const clean = part.replace(/\s+/g, ' ').trim();
    return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
  };
  return `"${short(a)}" ⇄ "${short(b)}"`;
}
