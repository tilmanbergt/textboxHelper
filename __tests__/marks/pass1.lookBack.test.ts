import {lookBackNumbers, ownedRects, withoutOwned} from '../../src/domain/penEditPairing';
import type {MarkStroke} from '../../src/domain/marks/markStroke';
import {
  lookBackPointsWanted,
  pickNewestMark,
  readDeclared,
  readLookBack,
  readLookBackReplace,
} from '../../src/domain/marks/pass1';
import type {Reading} from '../../src/domain/marks/reading';
import {NO_MARK_REASON, VERTICALS_NO_TEXT_REASON} from '../../src/domain/marks/reasons';
import {storedMarkOf} from '../../src/domain/marks/storedMark';
import type {Rect} from '../../src/domain/textboxModel';
import {rectOf} from './build';

/**
 * Pass 1 for the tag's look-back and for Select mark (technical-design-mark-dialogue.md §2.3,
 * technical-design-pen-edits.md §3.5, technical-design-pen-edits-2.md §3, §4). The cases moved here
 * with the code from the pen-edit and fine-mark tests. Changed on purpose (§13.1 Q2, Q4): two
 * verticals across a strike make no replace mark; a loop counts wherever it was written; a slash
 * is read from its points, from 30°.
 */

type XY = [number, number];

/** A stroke through the corners, points every few pixels; `rectOnly`: as the look-back reads it. */
function stroke(id: string, numInPage: number, corners: XY[], options: {line?: boolean; rectOnly?: boolean} = {}): MarkStroke {
  const points: Array<{x: number; y: number}> = [];
  for (let i = 0; i < corners.length - 1; i += 1) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[i + 1];
    for (let step = i === 0 ? 0 : 1; step <= 8; step += 1) {
      points.push({x: ax + ((bx - ax) * step) / 8, y: ay + ((by - ay) * step) / 8});
    }
  }
  if (points.length === 1) {
    points.push({...points[0]});
  }
  return {id, numInPage, rect: rectOf(points), points: options.rectOnly ? null : points, straightLine: !!options.line};
}

const fromRect = (id: string, numInPage: number, rect: Rect): MarkStroke => ({id, numInPage, rect, points: null, straightLine: false});
const NONE = {strikes: [], carets: []};

const strike = (id: string, num: number, line = false) => stroke(id, num, [[300, 500], [420, 502], [520, 501]], {line, rectOnly: true});
const vertical = (id: string, num: number, x: number) => stroke(id, num, [[x, 480], [x + 2, 522]], {rectOnly: true});
const ring = (id: string, num: number, cx: number, cy: number) =>
  stroke(id, num, [
    [cx - 14, cy],
    [cx, cy - 14],
    [cx + 14, cy],
    [cx, cy + 14],
    [cx - 14, cy],
  ]);
const loop = (id: string, num: number) => fromRect(id, num, {left: 530, top: 480, right: 560, bottom: 510});

describe('look-back: the window', () => {
  it('reads the numbers just before the snippet', () => {
    expect(lookBackNumbers(20)).toEqual([19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6]);
    expect(lookBackNumbers(3)).toEqual([2, 1]);
    expect(lookBackNumbers(1)).toEqual([]);
  });

  it('wants points only of caret-sized strokes and the two newest that may be a slash', () => {
    const window = [strike('k', 5), fromRect('v', 6, {left: 100, top: 100, right: 140, bottom: 140}), fromRect('s', 7, {left: 200, top: 80, right: 208, bottom: 116})];
    expect([...lookBackPointsWanted(window, NONE)].sort()).toEqual(['s', 'v']);
  });
});

describe('look-back: replace marks', () => {
  it('finds a strike with a loop, also a straight-line strike', () => {
    expect(readLookBackReplace([strike('k', 7), loop('l', 8)], [])).toMatchObject({kind: 'replaceLoop', strokes: ['k', 'l']});
    expect(readLookBackReplace([strike('k', 7, true), loop('l', 8)], [])).toMatchObject({kind: 'replaceLoop', strokes: ['k', 'l']});
  });

  it('takes no strike with verticals at its ends: they mark an exact delete, which takes no text', () => {
    const window = [strike('k', 7), vertical('v1', 8, 302), vertical('v2', 9, 516)];
    expect(readLookBackReplace(window, [])).toBeNull();
    expect(readLookBack(window, NONE)).toBeNull();
    // An earlier device test page (recognize rects alone): verticals inside the strike mark
    // nothing, and without a loop the strike is no replace mark.
    const device = [
      fromRect('strike', 29, {left: 600, top: 808, right: 972, bottom: 820}),
      fromRect('v1', 30, {left: 790, top: 789, right: 807, bottom: 833}),
      fromRect('v2', 31, {left: 800, top: 786, right: 817, bottom: 827}),
      fromRect('n', 25, {left: 594, top: 1279, right: 605, bottom: 1286}),
    ];
    expect(readLookBackReplace(device, [])).toBeNull();
  });

  it('takes a strike with verticals at its ends and a circle: exactly between them (§13.4)', () => {
    const reading = readLookBack([strike('k', 7), vertical('v1', 8, 302), vertical('v2', 9, 516), ring('c', 10, 517, 455)], NONE);
    expect(reading).toMatchObject({kind: 'replaceVerticals', strokes: ['k', 'v1', 'v2', 'c']});
    expect(storedMarkOf(reading as Reading)).toMatchObject({kind: 'replace', bounds: 'exact', modifierRects: [expect.anything(), expect.anything()], numberRect: expect.anything()});
  });

  it('takes the newest mark and skips strikes already paired', () => {
    const older = [fromRect('old', 2, {left: 300, top: 300, right: 520, bottom: 302}), fromRect('ol', 3, {left: 530, top: 280, right: 560, bottom: 310})];
    const newer = [strike('new', 5), loop('nl', 6)];
    expect(readLookBackReplace([...older, ...newer], [])?.strokes[0]).toBe('new');
    // The newer strike lies where an earlier tag already paired one.
    expect(readLookBackReplace(newer, [newer[0].rect])).toBeNull();
  });

  it('ignores a plain delete stroke and handwriting', () => {
    const word = stroke('w', 6, [[300, 480], [310, 520], [320, 480], [330, 520]], {rectOnly: true});
    expect(readLookBackReplace([strike('k', 7), word], [])).toBeNull();
  });

  it('pairs a strike with its loop, wherever it was written', () => {
    const s = fromRect('strike', 10, {left: 600, top: 808, right: 972, bottom: 820});
    const after = fromRect('loop', 11, {left: 975, top: 790, right: 1015, bottom: 832});
    expect(readLookBackReplace([s, after], [])).toMatchObject({kind: 'replaceLoop', strokes: ['strike', 'loop']});
    // A loop drawn before the strike counts too (§13.1 Q2: one loop rule for every caller).
    const before = fromRect('loop', 9, {left: 975, top: 790, right: 1015, bottom: 832});
    expect(readLookBackReplace([s, before], [])).toMatchObject({kind: 'replaceLoop'});
  });
});

describe('look-back: slash and the number circle', () => {
  const slash = stroke('s', 12, [[246, 88], [240, 116]]);

  it('reads a slash written last, with or without its circle', () => {
    expect(readLookBackReplace([slash], [])).toMatchObject({kind: 'slash', strokes: ['s']});
    const withCircle = readLookBackReplace([slash, ring('c', 13, 244, 66)], []);
    expect(withCircle).toMatchObject({kind: 'slash', strokes: ['s', 'c'], roles: ['mark', 'number']});
    expect(storedMarkOf(withCircle as Reading)).toMatchObject({slash: true, bounds: 'exact', numberRect: expect.any(Object)});
    // Not during the early stop of the reads.
    expect(readLookBackReplace([slash], [], {slash: false})).toBeNull();
  });

  it('reads a slash from 30°, and nothing flatter or curved', () => {
    // 43°: a slash (a wide rect, which the rect-only test refused).
    expect(readLookBackReplace([stroke('w', 12, [[240, 116], [270, 88]])], [])).toMatchObject({kind: 'slash'});
    // 18°: a strike's slope.
    expect(readLookBackReplace([stroke('w', 12, [[240, 110], [270, 100]])], [])).toBeNull();
    // A hook of handwriting.
    expect(readLookBackReplace([stroke('w', 12, [[240, 88], [270, 116], [240, 116]])], [])).toBeNull();
    // Without points (not read): no slash.
    expect(readLookBackReplace([stroke('w', 12, [[246, 88], [240, 116]], {rectOnly: true})], [])).toBeNull();
  });

  it('prefers a caret whose leg looks like a slash', () => {
    const leg1 = stroke('l1', 3, [[180, 70], [200, 110]]);
    const leg2 = stroke('l2', 4, [[200, 110], [210, 70]]);
    expect(readLookBackReplace([leg1, leg2], [])?.kind).toBe('slash');
    expect(readLookBack([leg1, leg2], NONE)).toMatchObject({kind: 'caret', direction: 'down', strokes: ['l1', 'l2']});
  });

  it("takes the user's circle in a caret's opening for the number", () => {
    const v = stroke('v', 3, [[100, 100], [120, 140], [140, 100]]);
    const reading = readLookBack([v, ring('c', 4, 120, 110)], NONE);
    expect(reading).toMatchObject({kind: 'caret', strokes: ['v', 'c'], roles: ['mark', 'number']});
    expect(storedMarkOf(reading as Reading)).toMatchObject({kind: 'caret', direction: 'down', caretRect: v.rect});
  });
});

describe('pickNewestMark', () => {
  const ws = (id: string, numInPage: number): MarkStroke => fromRect(id, numInPage, {left: 0, top: 0, right: 10, bottom: 10});
  const reading = (strokes: string[], kind: Reading['kind'] = 'replaceLoop') => ({kind, strokes}) as Reading;

  it('takes the only mark found, or none', () => {
    expect(pickNewestMark([], null, null)).toBeNull();
    expect(pickNewestMark([ws('loop', 4), ws('strike', 3)], reading(['strike', 'loop']), null)).toBe('replace');
    expect(pickNewestMark([ws('v', 5)], null, reading(['v'], 'caret'))).toBe('caret');
  });

  it('takes the mark written last before the snippet', () => {
    const window = [ws('strike', 3), ws('loop', 4), ws('v', 6)];
    expect(pickNewestMark(window, reading(['strike', 'loop']), reading(['v'], 'caret'))).toBe('caret');
    const later = [ws('v', 2), ws('strike', 5), ws('loop', 6)];
    expect(pickNewestMark(later, reading(['strike', 'loop']), reading(['v'], 'caret'))).toBe('replace');
  });

  it('keeps a replace mark whose loop was also read as a caret', () => {
    const window = [ws('strike', 3), ws('loop', 8)];
    expect(pickNewestMark(window, reading(['strike', 'loop']), reading(['loop'], 'caret'))).toBe('replace');
  });

  it('takes a mark only when it is the last thing written before the text', () => {
    const older = ws('old', 1);
    const s2 = ws('s2', 2);
    const scribble = ws('later', 3);
    expect(pickNewestMark([older, s2, scribble], reading(['s2'], 'strike'), null)).toBeNull();
    expect(pickNewestMark([older, s2], reading(['s2'], 'strike'), null)).toBe('replace');
    expect(pickNewestMark([older, s2, scribble], null, reading(['later'], 'caret'))).toBe('caret');
  });
});

describe('the second text right after a text whose mark was selected (device case)', () => {
  // Text 1 (strokes 1-3) was tagged without a mark; then its replace mark was drawn and selected:
  // a strike (4) and two short lines across it (5, 6). Text 2 is written right after.
  const text1 = [fromRect('t1a', 1, {left: 100, top: 600, right: 140, bottom: 640}), fromRect('t1b', 2, {left: 150, top: 600, right: 190, bottom: 640}), fromRect('t1c', 3, {left: 200, top: 600, right: 240, bottom: 640})];
  const s = fromRect('s', 4, {left: 300, top: 500, right: 520, bottom: 506});
  const lines = [fromRect('v1', 5, {left: 400, top: 480, right: 402, bottom: 524}), fromRect('v2', 6, {left: 418, top: 480, right: 420, bottom: 524})];
  const window = [...text1, s, ...lines];
  const entry1 = {
    strokeRects: text1.map(item => item.rect),
    mark: {kind: 'replace' as const, strikeRect: s.rect, modifierRects: lines.map(line => line.rect)},
  };

  it('leaves out every stroke that already belongs to tagged text', () => {
    expect(withoutOwned(window, ownedRects([entry1]))).toEqual([]);
  });

  it('pairs no caret made of the earlier mark: the text gets "no mark found"', () => {
    expect(readLookBack(withoutOwned(window, ownedRects([entry1])), NONE)).toBeNull();
  });
});

describe('Select mark', () => {
  it('takes a step with its second upright as one caret (_||‾)', () => {
    const step = stroke('step', 1, [[300, 540], [350, 540], [350, 500], [400, 500]]);
    const upright = stroke('up', 2, [[360, 504], [361, 536]]);
    expect(readDeclared([step, upright]).readings[0]).toMatchObject({kind: 'step', direction: 'step', strokes: ['step', 'up']});
  });

  it('reads a strike with its loop', () => {
    const loopStroke = stroke('l', 2, [[530, 480], [560, 480], [560, 510], [530, 510], [530, 482]]);
    expect(readDeclared([stroke('s', 1, [[300, 500], [420, 502], [520, 501]]), loopStroke]).readings[0]).toMatchObject({
      kind: 'replaceLoop',
      strokes: ['s', 'l'],
    });
  });

  it('refuses a strike with a line across each end: an exact delete takes no text', () => {
    const group = readDeclared([
      stroke('s', 1, [[300, 500], [420, 502], [520, 501]]),
      stroke('a', 2, [[302, 480], [304, 522]]),
      stroke('b', 3, [[516, 480], [518, 522]]),
    ]);
    expect(group).toMatchObject({readings: [], reason: VERTICALS_NO_TEXT_REASON});
  });

  it('takes a strike with a line across each end and a circle as an exact replace mark', () => {
    const group = readDeclared([
      stroke('s', 1, [[300, 500], [420, 502], [520, 501]]),
      stroke('a', 2, [[302, 480], [304, 522]]),
      stroke('b', 3, [[516, 480], [518, 522]]),
      ring('c', 4, 545, 500),
    ]);
    expect(group.readings[0]).toMatchObject({kind: 'replaceVerticals', strokes: ['s', 'a', 'b', 'c']});
  });

  it('accepts a strike alone: the user said it is a mark', () => {
    const reading = readDeclared([stroke('s', 1, [[300, 500], [420, 502], [520, 501]])]).readings[0];
    expect(reading).toMatchObject({kind: 'strike', strokes: ['s']});
    expect(storedMarkOf(reading)).toEqual({kind: 'replace', strikeRect: reading.rects[0], modifierRects: []});
  });

  it('reads a V and a two-stroke < as carets', () => {
    expect(readDeclared([stroke('v', 1, [[100, 100], [120, 140], [140, 100]])]).readings[0]).toMatchObject({
      kind: 'caret',
      direction: 'down',
    });
    const twoStroke = readDeclared([stroke('a', 4, [[260, 100], [100, 150]]), stroke('b', 5, [[100, 150], [260, 200]])]);
    expect(twoStroke.readings[0]).toMatchObject({kind: 'sideways', direction: 'left', strokes: ['a', 'b']});
  });

  it('leaves out strokes that belong to no mark, and finds none in a scribble', () => {
    const group = readDeclared([stroke('s', 1, [[300, 500], [420, 502], [520, 501]]), stroke('x', 2, [[100, 900], [104, 902]])]);
    expect(group.readings[0].strokes).toEqual(['s']);
    expect(readDeclared([stroke('dot', 1, [[100, 100], [103, 101]])])).toMatchObject({readings: [], reason: NO_MARK_REASON});
    expect(readDeclared([])).toMatchObject({readings: [], reason: NO_MARK_REASON});
  });
});
