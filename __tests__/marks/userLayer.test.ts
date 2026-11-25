import type {Place} from '../../src/domain/marks/place';
import type {Reading} from '../../src/domain/marks/reading';
import {applyUserLayer, chosenReading, type UserLayer} from '../../src/domain/marks/userLayer';

/**
 * The user layer (technical-design-mark-dialogue.md §2.7, §3): what ‹ ›, Here and a chosen reading
 * change. Place + layer -> place.
 */

const at = {uuid: 'tb1', numInPage: 1, lineIndex: 0, start: 4, end: 7};
const placed: Place = {ok: true, ...at};
const open: Place = {ok: false, reason: 'The marker crosses multiple rendered lines.', guess: at, onText: true};
const lost: Place = {ok: false, reason: 'Its mark is no longer on the page.', guess: null, onText: false};
const TEXT = 'the big red car'.length;

describe('the user layer', () => {
  it.each([
    ['nothing set: the place as pass 2 found it', placed, {}, placed],
    ['Here on an open place takes the guess', open, {here: true}, {ok: true, ...at}],
    ['Here without a guess changes nothing', lost, {here: true}, lost],
    ['an open place without Here stays open', open, {edges: [1, 1]}, open],
    ['‹ › move the edges by characters', placed, {edges: [-1, 1]}, {...placed, start: 3, end: 8}],
    ['Here and ‹ › together', open, {here: true, edges: [0, 4]}, {ok: true, ...at, end: 11}],
    ['edges stay inside the text', placed, {edges: [-10, 20]}, {...placed, start: 0, end: TEXT}],
    ['a point moves as one', {ok: true, ...at, end: 4} as Place, {edges: [2]}, {ok: true, ...at, start: 6, end: 6}],
  ])('%s', (_name, place, layer, expected) => {
    expect(applyUserLayer(place as Place, layer as UserLayer, TEXT)).toEqual(expected);
  });

  it('places the reading the user chose, else the first', () => {
    const readings = [{kind: 'slash'}, {kind: 'strike'}] as Reading[];
    expect(chosenReading(readings, {})?.kind).toBe('slash');
    expect(chosenReading(readings, {reading: 1})?.kind).toBe('strike');
    expect(chosenReading(readings, {reading: 5})?.kind).toBe('slash');
    expect(chosenReading([], {})).toBeNull();
  });
});
