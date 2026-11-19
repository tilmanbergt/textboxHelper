import {charPositionInWord, xAtOffset} from '../../src/domain/textOffsets';

// "mill": a wide m, then three narrow letters.
const MILL = {start: 10, end: 14, left: 100, right: 140, edges: [100, 118, 124, 132, 140]};

describe('character positions inside a word', () => {
  it('uses the measured edges: the wide letter is one character, not two', () => {
    // 117 is near the end of the "m"; the average width (10 px) would say 1.7.
    expect(charPositionInWord(MILL, 117)).toBeCloseTo(17 / 18, 3);
    expect(charPositionInWord(MILL, 120)).toBeCloseTo(1 + 2 / 6, 3);
    expect(charPositionInWord(MILL, 124)).toBe(2);
  });

  it('clamps to the word', () => {
    expect(charPositionInWord(MILL, 90)).toBe(0);
    expect(charPositionInWord(MILL, 150)).toBe(4);
  });

  it('falls back to the average width without edges or with edges that do not fit', () => {
    const plain = {start: 0, end: 4, left: 100, right: 140};
    expect(charPositionInWord(plain, 115)).toBeCloseTo(1.5, 5);
    expect(charPositionInWord({...plain, edges: [100, 140]}, 115)).toBeCloseTo(1.5, 5);
    expect(charPositionInWord({...plain, edges: [100, 130, 120, 135, 140]}, 115)).toBeCloseTo(1.5, 5);
  });

  it('gives the x of an offset', () => {
    expect(xAtOffset(MILL, 11)).toBe(118);
    expect(xAtOffset(MILL, 14)).toBe(140);
    expect(xAtOffset({start: 0, end: 4, left: 100, right: 140}, 2)).toBe(120);
  });
});
