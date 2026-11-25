import {formatOperationSnippet} from '../markerText';
import type {EditMarkerOperationKind, IgnoredEditMarker, OperationDraft} from '../markerTypes';
import {trailingDash} from '../paragraphJoin';
import {breakCommaTie} from '../punctText';
import {spaceSnippet} from '../spaceMark';
import {swapSummary} from '../swapText';
import type {PageMark, Refusal, StrokeRef} from './pass2';
import {closeUpSnippet, punctuationAtGap} from './place/closeUp';
import {bracketSnippet} from './place/exact';

/**
 * The review's rows from pass 2 (technical-design-mark-dialogue.md §5.1 step 7): one draft per
 * placed mark - its range in the textbox's text and how the review names it - and one ignored row
 * per mark that was not placed. Pure.
 */

const nums = (strokes: StrokeRef[]) => strokes.map(stroke => stroke.numInPage);

/** An ignored mark as the review lists it ("Ignored marker 12"), with the strokes Remove may take. */
export function ignoredOf(refusal: Refusal): IgnoredEditMarker {
  return {
    markerUuid: refusal.first.id,
    markerNumInPage: refusal.first.numInPage,
    summary: `Ignored marker ${refusal.first.numInPage}`,
    reason: refusal.reason,
    ...(refusal.removable ? {removableNums: refusal.removable} : {}),
  };
}

function base(first: StrokeRef, id: string, kind: OperationDraft['operation']['kind'], strokes: number[]) {
  return {id, kind, markerUuid: first.id, markerNumInPage: first.numInPage, consumedMarkerNums: strokes};
}

/** The draft of one placed mark. */
export function draftOf(mark: PageMark): OperationDraft {
  switch (mark.kind) {
    case 'line': {
      const {view, span, words, strike} = mark;
      const text = view.text;
      const kind: EditMarkerOperationKind = mark.owner ? 'replace' : 'delete';
      // Two verticals: exactly between them, letter by letter (technical-design-fine-marks.md §3);
      // shown bracketed when an edge cuts a word.
      const insideWord =
        span.exact &&
        ((span.start > 0 && /\S/.test(text.charAt(span.start - 1)) && /\S/.test(text.charAt(span.start))) ||
          (/\S/.test(text.charAt(span.end - 1)) && /\S/.test(text.charAt(span.end))));
      const wordTexts = insideWord ? [bracketSnippet(text, span.start, span.end)] : words.map(word => word.text);
      return {
        range: {kind, start: span.start, end: span.end},
        operation: {
          ...base(strike, `${strike.id}:${view.uuid}`, kind, mark.consumed),
          targetTextboxUuid: view.uuid,
          targetTextboxNumInPage: view.numInPage,
          lineIndex: mark.lineIndex,
          summary: formatOperationSnippet(kind, wordTexts),
          detail: `Textbox ${view.numInPage}, line ${mark.lineIndex + 1} - ${words.length} ${words.length === 1 ? 'word' : 'words'}`,
          words: wordTexts,
          textStart: span.start,
          ...(mark.owner ? {penEditId: mark.owner.id, penEditNumber: mark.owner.number} : {}),
        },
      };
    }
    case 'split':
      return {
        range: {kind: 'replace', start: mark.offset, end: mark.offset},
        operation: {
          ...base(mark.strokes[0], `split:${mark.strokes[0].id}`, 'split', nums(mark.strokes)),
          targetTextboxUuid: mark.view.uuid,
          targetTextboxNumInPage: mark.view.numInPage,
          lineIndex: 0,
          summary: 'Paragraph break',
          detail: `Textbox ${mark.view.numInPage} · ${mark.direction === 'step' ? 'at a word gap' : 'between two lines'}`,
          words: [],
          textStart: mark.offset,
        },
      };
    case 'punct': {
      // Read by the plugin only: a circle it can't read waits for the user's pick in the review.
      const reading = mark.reading.punct ?? {char: null, tie: false};
      const char = reading.tie ? breakCommaTie(mark.mode) : reading.char;
      return {
        range: {kind: 'replace', start: mark.offset, end: mark.offset},
        operation: {
          ...base(mark.strokes[0], `punct:${mark.strokes[0].id}`, 'punct', nums(mark.strokes)),
          targetTextboxUuid: mark.view.uuid,
          targetTextboxNumInPage: mark.view.numInPage,
          lineIndex: 0,
          summary: 'Insert punctuation',
          detail: `Textbox ${mark.view.numInPage}`,
          words: [],
          textStart: mark.offset,
          punct: {offset: mark.offset, mode: mark.mode, char, source: char ? 'own' : 'none', tie: reading.tie},
          ...(mark.uncertain ? {uncertain: mark.uncertain} : {}),
        },
      };
    }
    case 'space': {
      const snippet = spaceSnippet(mark.view.text, mark.offset);
      return {
        range: {kind: 'replace', start: mark.offset, end: mark.offset, replacementText: ' '},
        operation: {
          ...base(mark.strokes[0], `space:${mark.strokes[0].id}`, 'space', nums(mark.strokes)),
          targetTextboxUuid: mark.view.uuid,
          targetTextboxNumInPage: mark.view.numInPage,
          lineIndex: 0,
          summary: `Space · ${snippet}`,
          detail: `Textbox ${mark.view.numInPage} · ${snippet}`,
          words: [],
          textStart: mark.offset,
          ...(mark.uncertain ? {uncertain: mark.uncertain} : {}),
        },
      };
    }
    case 'swap': {
      const text = mark.view.text;
      const {a0, a1, b0, b1} = mark.zones;
      const a = text.slice(a0, a1);
      const b = text.slice(b0, b1);
      return {
        range: {kind: 'replace', start: a0, end: b1, replacementText: `${b}${text.slice(a1, b0)}${a}`},
        operation: {
          ...base(mark.strokes[0], `swap:${mark.strokes[0].id}`, 'swap', nums(mark.strokes)),
          targetTextboxUuid: mark.view.uuid,
          targetTextboxNumInPage: mark.view.numInPage,
          lineIndex: mark.lineIndex,
          summary: `Swap · ${swapSummary(a, b)}`,
          detail: `Textbox ${mark.view.numInPage} · line ${mark.lineIndex + 1}`,
          words: [a, b],
          textStart: a0,
          swap: {zones: mark.zones, fixCase: true, capsAvailable: false},
          ...(mark.uncertain ? {uncertain: mark.uncertain} : {}),
        },
      };
    }
    case 'closeUp': {
      const text = mark.view.text;
      return {
        range: {kind: 'replace', start: mark.start, end: mark.end, replacementText: '', joins: true},
        operation: {
          ...base(mark.strokes[0], `closeUp:${mark.strokes[0].id}`, 'closeUp', nums(mark.strokes)),
          targetTextboxUuid: mark.view.uuid,
          targetTextboxNumInPage: mark.view.numInPage,
          lineIndex: 0,
          summary: `Close up · ${closeUpSnippet(text, mark.start, mark.end)}`,
          detail: `Textbox ${mark.view.numInPage} · ${mark.where}`,
          words: [],
          textStart: mark.start,
          closeUp: {gapStart: mark.start, gapEnd: mark.end, punct: punctuationAtGap(text, mark.start, mark.end), removePunct: false},
        },
      };
    }
    case 'join': {
      const upperText = mark.upper.text;
      const lowerText = mark.lower.text;
      return {
        range: {kind: 'replace', start: upperText.length, end: upperText.length},
        operation: {
          ...base(mark.strokes[0], `join:${mark.strokes[0].id}`, 'join', nums(mark.strokes)),
          targetTextboxUuid: mark.upper.uuid,
          targetTextboxNumInPage: mark.upper.numInPage,
          lineIndex: mark.lineIndex,
          summary: `Join · "…${upperText.trimEnd().slice(-16)}" + "${lowerText.trimStart().slice(0, 16)}…"`,
          detail: `Textboxes ${mark.upper.numInPage} + ${mark.lower.numInPage}`,
          words: [],
          textStart: upperText.length,
          join: {belowUuid: mark.lower.uuid, belowNumInPage: mark.lower.numInPage, hyphen: trailingDash(upperText), removeHyphen: false},
        },
      };
    }
    case 'slash': {
      const kind: EditMarkerOperationKind = mark.owner ? 'replace' : 'delete';
      const shown = bracketSnippet(mark.view.text, mark.offset, mark.offset + 1);
      return {
        range: {kind, start: mark.offset, end: mark.offset + 1},
        operation: {
          ...base(mark.strokes[0], `${mark.strokes[0].id}:${mark.view.uuid}`, kind, nums(mark.strokes)),
          targetTextboxUuid: mark.view.uuid,
          targetTextboxNumInPage: mark.view.numInPage,
          lineIndex: mark.lineIndex,
          summary: formatOperationSnippet(kind, [shown]),
          detail: `Textbox ${mark.view.numInPage}, line ${mark.lineIndex + 1} - 1 letter`,
          words: [shown],
          textStart: mark.offset,
          ...(mark.uncertain ? {uncertain: mark.uncertain} : {}),
          ...(mark.owner ? {penEditId: mark.owner.id, penEditNumber: mark.owner.number} : {}),
        },
      };
    }
  }
}

/** The textboxes a mark changes (a join changes two). */
export function textboxesOf(mark: PageMark): string[] {
  return mark.kind === 'join' ? [mark.upper.uuid, mark.lower.uuid] : [mark.view.uuid];
}
