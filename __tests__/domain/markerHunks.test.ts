import {firstWords, lastWords} from '../../src/domain/markerHunks';
import {nudgeShift, shiftSwapZones} from '../../src/domain/edgeShift';
import {parsePenEditEntry} from '../../src/domain/penEditModel';

describe('context words', () => {
  it('keeps the last and first words of a context, marking a cut', () => {
    expect(lastWords('one two three four', 2)).toBe('…three four');
    expect(lastWords('one two ', 5)).toBe('one two ');
    expect(firstWords(' five six seven', 2)).toBe(' five six …');
    expect(firstWords(' five', 3)).toBe(' five');
    expect(lastWords('', 3)).toBe('');
  });
});

describe('edge shifts', () => {
  it('nudges one edge and fills the ones before it', () => {
    expect(nudgeShift(null, 0, -1)).toEqual([-1]);
    expect(nudgeShift([2], 2, 1)).toEqual([2, 0, 1]);
    expect(nudgeShift([0, 3], 1, -1)).toEqual([0, 2]);
  });

  it('moves a swap\'s parts and keeps each at least one character, inside the text', () => {
    const zones = {a0: 5, a1: 8, b0: 9, b1: 13};
    expect(shiftSwapZones(zones, [0, 2, 0], 20)).toEqual({a0: 5, a1: 10, b0: 11, b1: 13});
    expect(shiftSwapZones(zones, [-9, 0, 30], 20)).toEqual({a0: 0, a1: 8, b0: 9, b1: 20});
    // The meeting point can't eat a part.
    expect(shiftSwapZones(zones, [0, 9, 0], 20)).toEqual({a0: 5, a1: 11, b0: 12, b1: 13});
    expect(shiftSwapZones(zones, [0, -9, 0], 20)).toEqual({a0: 5, a1: 6, b0: 7, b1: 13});
  });
});

describe('stored edges', () => {
  const entry = (edges: unknown) =>
    parsePenEditEntry({
      id: 'p',
      kind: 'insertion',
      notePath: '/n.note',
      page: 0,
      number: 1,
      rect: {left: 0, top: 0, right: 10, bottom: 10},
      edges,
    });

  it('reads a list, and the start/end shape stored before', () => {
    expect(entry([-2])?.edges).toEqual([-2]);
    expect(entry({start: 1, end: -1})?.edges).toEqual([1, -1]);
    expect(entry([0, 0])?.edges).toBeNull();
    expect(entry(['x'])?.edges).toBeNull();
  });
});
