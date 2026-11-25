import {edgeContext, type EdgeShift} from '../edgeShift';
import type {EdgePoint, EdgeView, OperationDraft} from '../markerTypes';
import {draftOf} from './drafts';
import {guessLetter, guessPart, wordsIn} from './linked';
import type {PlaceAt} from './place';
import type {CaretInsertMode} from './place/point';
import {placeReading, type PageMark, type StrokeRef} from './pass2';
import {rectsWithRole, type Reading} from './reading';
import type {TextboxView} from './textboxView';
import {unclearSummary} from './toDecide';
import {applyUserLayer} from './userLayer';

/**
 * The choices To decide offers (technical-design-mark-dialogue.md §5.3): for an unclear mark, one
 * option per reading pass 1 found - where it would act and the change it would make - and for any
 * place the edges and the result line the side shows while ‹ › move it.
 */

export type DecideOption = {
  /** "Slash", "Strike", … */
  label: string;
  /** Why it didn't place by itself; null when it did. */
  reason: string | null;
  /** Where it acts (its guess when it didn't place); null when there is no sensible place. */
  at: PlaceAt | null;
  /** The textbox's text there. */
  text: string;
  /** The change it makes at `at` (plain marks: never text); null when the reading takes none. */
  draft: OperationDraft | null;
};

/** The change a reading makes at a place, as the review's draft; null for one that takes text. */
function draftAt(reading: Reading, at: PlaceAt, view: TextboxView, strokes: StrokeRef[]): OperationDraft | null {
  const consumed = strokes.map(ref => ref.numInPage);
  let mark: PageMark | null = null;
  switch (reading.kind) {
    case 'strike':
    case 'strikeVerticals': {
      const words = wordsIn(view, at.start, at.end);
      mark = words.length > 0 ? {kind: 'line', strike: strokes[0], view, lineIndex: at.lineIndex, words, span: {start: at.start, end: at.end, exact: reading.kind === 'strikeVerticals'}, consumed} : null;
      break;
    }
    case 'slash':
      mark = {kind: 'slash', strokes, view, lineIndex: at.lineIndex, offset: at.start};
      break;
    case 'closeUp':
      mark = at.end > at.start ? {kind: 'closeUp', strokes, view, start: at.start, end: at.end, where: `line ${at.lineIndex + 1}`} : null;
      break;
    case 'space':
      mark = {kind: 'space', strokes, view, offset: at.start};
      break;
    case 'punct':
      mark = {kind: 'punct', strokes, view, offset: at.start, mode: (at.mode as CaretInsertMode) ?? 'betweenWords', reading};
      break;
    case 'sideways':
    case 'step':
      mark = at.mode === 'split' ? {kind: 'split', strokes, view, offset: at.start, direction: reading.direction ?? 'left'} : null;
      break;
    default:
      mark = null;
  }
  return mark ? draftOf(mark) : null;
}

/** The options of an unclear mark: each reading placed, or its nearest place with why. */
export function decideOptions(readings: Reading[], views: TextboxView[], numbers: Map<string, number>): DecideOption[] {
  return readings.map(reading => {
    const place = placeReading(reading, views);
    const rect = rectsWithRole(reading, 'mark')[0] ?? reading.rects[0];
    const at = place.ok
      ? place
      : reading.kind === 'slash'
      ? guessLetter(rect, views)
      : reading.kind === 'strike' || reading.kind === 'strikeVerticals'
      ? guessPart(rect, views)
      : place.guess;
    const view = at ? views.find(item => item.uuid === at.uuid) : undefined;
    const strokes = reading.strokes.map(id => ({id, numInPage: numbers.get(id) ?? 0}));
    return {
      label: unclearSummary([reading]),
      reason: place.ok ? null : place.reason,
      at: at && view ? {uuid: at.uuid, numInPage: at.numInPage, lineIndex: at.lineIndex, start: at.start, end: at.end, ...(at.mode ? {mode: at.mode} : {})} : null,
      text: view?.text ?? '',
      draft: at && view ? draftAt(reading, at, view, strokes) : null,
    };
  });
}

/** How much text the result line shows on each side of a place. */
const RESULT_CONTEXT = 24;

/**
 * A place with ‹ › applied, as the side shows it: its edges with the characters on each side, and
 * the text as it will read with `insert` (the new text, or nothing for a deletion) there.
 */
export function decideView(text: string, at: PlaceAt, edges: EdgeShift | null, insert: string): EdgeView & {start: number; end: number} {
  const moved = applyUserLayer({ok: true, ...at}, {edges}, text.length);
  const start = moved.ok ? moved.start : at.start;
  const end = moved.ok ? moved.end : at.end;
  const point = (label: string, offset: number): EdgePoint => ({label, ...edgeContext(text, offset)});
  const before = text.slice(Math.max(0, start - RESULT_CONTEXT), start);
  const after = text.slice(end, end + RESULT_CONTEXT);
  return {
    start,
    end,
    edges: start === end ? [point('Place', start)] : [point('Start', start), point('End', end)],
    result: `${start > RESULT_CONTEXT ? '…' : ''}${before}${insert}${after}${end + RESULT_CONTEXT < text.length ? '…' : ''}`,
  };
}
