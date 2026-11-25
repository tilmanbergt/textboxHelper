import {readMarks} from '../../src/domain/marks/pass1';
import {strikeShapeRefusal} from '../../src/domain/marks/shapes/strike';
import {marks, rectOf, slash, strike} from './build';
import {TABLES, Y} from './pass1.cases';

/**
 * Pass 1 in the review (technical-design-mark-dialogue.md §3): which strokes are read as which
 * mark, from the strokes alone - the tables of `pass1.cases.ts`, one per mark family.
 */

describe.each(Object.entries(TABLES))('pass 1 reads: %s', (_family, cases) => {
  it.each(cases.map(item => [item.name, item] as const))('%s', (_name, item) => {
    const groups = readMarks(marks(...item.strokes));
    if (item.expect === 'none') {
      expect(groups).toEqual([]);
      return;
    }
    expect(groups).toHaveLength(item.expect.length);
    item.expect.forEach((expected, index) => {
      const group = groups[index];
      expect(group.readings.map(reading => reading.kind)).toEqual(expected.kinds);
      const first = group.readings[0];
      expect(first ? first.strokes : group.strokes).toEqual(expected.strokes);
      if (item.reason) {
        expect(group.reason).toBe(item.reason);
      }
      if (expected.anchors) {
        expect(first.anchors).toHaveLength(expected.anchors.length);
        expect(first.anchors.map(anchor => [anchor.x, anchor.y])).toEqual(
          expected.anchors.map(([x, y]) => [expect.closeTo(x, 0), expect.closeTo(y, 0)]),
        );
      }
      if (expected.direction) {
        expect(first.direction).toBe(expected.direction);
      }
      if (expected.char !== undefined) {
        expect(first.punct?.char).toBe(expected.char);
      }
    });
  });
});

describe('pass 1: why a stroke is no strike', () => {
  it.each([
    ['too short', strike(187, 207, Y)[0], 'too short'],
    ['too tall for its width', slash(200, Y, 40, 60)[0], 'too tall'],
    ['a strike', strike(187, 241, Y)[0], null],
  ] as const)('%s', (_name, points, reason) => {
    const refusal = strikeShapeRefusal(rectOf(points));
    expect(reason ? refusal : null).toEqual(reason ? expect.stringContaining(reason) : null);
  });
});
