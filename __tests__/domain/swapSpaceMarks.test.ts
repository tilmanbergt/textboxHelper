import {analyzeStepMark, isSecondUpright} from '../../src/domain/paragraphMarks';
import {analyzeCaret, type CaretTextbox, type Point} from '../../src/domain/penEditCaret';
import {
  findCrossAtCaret,
  spaceRefusal,
  spaceSnippet,
  type ShortStroke,
} from '../../src/domain/spaceMark';
import {
  analyzeSwapPiece,
  offsetAtX,
  pairSwapPieces,
  pieceOnLine,
  swapZones,
  type PlacedPiece,
} from '../../src/domain/swapMark';
import {
  capsAvailable,
  composeSwap,
  startsSentence,
  swapParts,
  swapSummary,
} from '../../src/domain/swapText';
import {SPLIT_SIGN} from '../../src/domain/paragraphMarks';

/** Points every few pixels along straight segments between the corners. */
function path(...corners: Array<[number, number]>): Point[] {
  const points: Point[] = [];
  for (let index = 0; index < corners.length - 1; index += 1) {
    const [x1, y1] = corners[index];
    const [x2, y2] = corners[index + 1];
    const steps = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / 4));
    for (let step = 0; step < steps; step += 1) {
      points.push({x: x1 + ((x2 - x1) * step) / steps, y: y1 + ((y2 - y1) * step) / steps});
    }
  }
  const [x, y] = corners[corners.length - 1];
  points.push({x, y});
  return points;
}

function rectOf(points: Point[]) {
  return {
    left: Math.min(...points.map(p => p.x)),
    top: Math.min(...points.map(p => p.y)),
    right: Math.max(...points.map(p => p.x)),
    bottom: Math.max(...points.map(p => p.y)),
  };
}

// A line from y 80 to 120 (middle 100, height 40).
const CY = 100;
const H = 40;

/**
 * One textbox: "the big red car and more words here" on line 0 (y 80–120) and line 1
 * (y 120–160); words 40 px apart, each 8 px per letter.
 */
function box(text: string, lines: string[][]): CaretTextbox {
  const words: CaretTextbox['words'] = [];
  const lineInfo: CaretTextbox['lines'] = [];
  let offset = 0;
  lines.forEach((lineWords, lineIndex) => {
    const lineStart = offset;
    let x = 100;
    lineWords.forEach(word => {
      const start = text.indexOf(word, offset);
      words.push({start, end: start + word.length, lineIndex, left: x, right: x + word.length * 8});
      x += word.length * 8 + 16;
      offset = start + word.length;
    });
    const lineEnd = lineIndex === lines.length - 1 ? text.length : text.indexOf(lines[lineIndex + 1][0], offset);
    lineInfo.push({index: lineIndex, start: lineStart, end: lineEnd, top: 80 + lineIndex * 40, bottom: 120 + lineIndex * 40});
    offset = lineEnd;
  });
  return {uuid: 'b1', numInPage: 1, rect: {left: 90, top: 80, right: 600, bottom: 80 + lines.length * 40}, text, lines: lineInfo, words};
}

const ONE_LINE = box('the big red car', [['the', 'big', 'red', 'car']]);
// the: 100–124, big: 140–164, red: 180–204, car: 220–244

describe('paragraph step: falling too, and its second upright', () => {
  it('reads a falling step (‾|_) as a step', () => {
    const falling = analyzeStepMark(path([100, 80], [150, 80], [150, 120], [200, 120]));
    expect(falling?.direction).toBe('step');
    expect(falling?.tip.x).toBeCloseTo(150, 0);
    expect(analyzeStepMark(path([100, 120], [150, 120], [150, 80], [200, 80]))?.direction).toBe('step');
  });

  it('finds a second upright beside the step on either side', () => {
    const step = analyzeCaret(path([100, 120], [150, 120], [150, 80], [200, 80]));
    expect(step?.direction).toBe('step');
    if (!step) {
      return;
    }
    expect(isSecondUpright(step, {left: 158, top: 84, right: 161, bottom: 118})).toBe(true);
    expect(isSecondUpright(step, {left: 138, top: 84, right: 141, bottom: 118})).toBe(true);
    // Too far, too short, lying down.
    expect(isSecondUpright(step, {left: 200, top: 84, right: 203, bottom: 118})).toBe(false);
    expect(isSecondUpright(step, {left: 158, top: 95, right: 161, bottom: 105})).toBe(false);
    expect(isSecondUpright(step, {left: 150, top: 98, right: 190, bottom: 102})).toBe(false);
  });
});

describe('insert-space mark: ∧ or V with a cross', () => {
  const caret = analyzeCaret(path([140, 140], [150, 115], [160, 140]));
  const leg = (uuid: string, a: [number, number], b: [number, number]): ShortStroke => {
    const points = path(a, b);
    return {uuid, numInPage: 0, rect: rectOf(points), points};
  };

  it('is a caret', () => {
    expect(caret?.direction).toBe('up');
  });

  it('finds a + or × near the tip', () => {
    if (!caret) {
      return;
    }
    const plus = [leg('h', [140, 100], [160, 100]), leg('v', [150, 90], [150, 110])];
    expect(findCrossAtCaret(caret, plus)?.map(s => s.uuid).sort()).toEqual(['h', 'v']);
    const times = [leg('a', [140, 90], [160, 110]), leg('b', [160, 90], [140, 110])];
    expect(findCrossAtCaret(caret, times)).toHaveLength(2);
  });

  it('takes all four legs of a #', () => {
    if (!caret) {
      return;
    }
    const hash = [
      leg('h1', [138, 96], [162, 96]),
      leg('h2', [138, 104], [162, 104]),
      leg('v1', [146, 88], [146, 112]),
      leg('v2', [154, 88], [154, 112]),
    ];
    expect(findCrossAtCaret(caret, hash)).toHaveLength(4);
  });

  it('ignores legs that do not cross, crosses far away and sideways carets', () => {
    if (!caret) {
      return;
    }
    expect(findCrossAtCaret(caret, [leg('a', [140, 100], [160, 100]), leg('b', [140, 106], [160, 106])])).toBeNull();
    expect(findCrossAtCaret(caret, [leg('h', [400, 100], [420, 100]), leg('v', [410, 90], [410, 110])])).toBeNull();
    const sideways = analyzeCaret(path([180, 80], [150, 100], [180, 120]));
    expect(sideways?.direction).toBe('left');
    if (sideways) {
      expect(findCrossAtCaret(sideways, [leg('h', [140, 100], [160, 100]), leg('v', [150, 90], [150, 110])])).toBeNull();
    }
  });

  it('puts a space only between two characters that are not spaces', () => {
    expect(spaceRefusal('thisword', 4)).toBeNull();
    expect(spaceRefusal('end.Next', 4)).toBeNull();
    expect(spaceRefusal('this word', 4)).toBe('There is already a space here.');
    expect(spaceRefusal('word', 0)).not.toBeNull();
    expect(spaceSnippet('a thisword b', 6)).toBe('a this|word b');
  });
});

describe('swap shapes on one line', () => {
  it('reads the square mark with outer verticals as a whole swap (A above)', () => {
    // | up at 136, over "big", down at 172, under "red", up at 208.
    const shape = pieceOnLine(path([136, 112], [136, 72], [172, 72], [172, 128], [208, 128], [208, 90]), CY, H);
    expect(shape?.kind).toBe('whole');
    if (shape?.kind === 'whole') {
      expect(shape.aAbove).toBe(true);
      expect(shape.split).toBeCloseTo(172, 0);
    }
  });

  it('reads the mirrored mark, a rounded S and one drawn right to left', () => {
    expect(pieceOnLine(path([136, 88], [136, 128], [172, 128], [172, 72], [208, 72], [208, 110]), CY, H)).toMatchObject({
      kind: 'whole',
      aAbove: false,
    });
    const rounded = path([138, 110], [140, 76], [150, 70], [166, 74], [172, 100], [178, 126], [194, 130], [204, 124], [206, 92]);
    expect(pieceOnLine(rounded, CY, H)?.kind).toBe('whole');
    const reversed = path([208, 90], [208, 128], [172, 128], [172, 72], [136, 72], [136, 112]);
    expect(pieceOnLine(reversed, CY, H)).toMatchObject({kind: 'whole', aAbove: true});
  });

  it('a mark with only one outer vertical is still whole; without any it is a middle piece', () => {
    expect(pieceOnLine(path([136, 112], [136, 72], [172, 72], [172, 128], [208, 128]), CY, H)?.kind).toBe('whole');
    expect(pieceOnLine(path([100, 72], [172, 72], [172, 128], [250, 128]), CY, H)?.kind).toBe('split');
  });

  it('is not a strike, a wave or handwriting', () => {
    expect(pieceOnLine(path([100, 100], [250, 102]), CY, H)).toBeNull();
    expect(
      pieceOnLine(path([100, 72], [130, 72], [130, 128], [160, 128], [160, 72], [190, 72], [190, 128], [220, 128]), CY, H),
    ).toBeNull();
  });

  it('reads corners: start (vertical then a line) and end (a line then a vertical)', () => {
    expect(pieceOnLine(path([136, 112], [136, 72], [240, 72]), CY, H)).toMatchObject({kind: 'start', aAbove: true});
    expect(pieceOnLine(path([100, 128], [208, 128], [208, 90]), CY, H)).toMatchObject({kind: 'end', aAbove: true});
    expect(pieceOnLine(path([136, 88], [136, 128], [240, 128]), CY, H)).toMatchObject({kind: 'start', aAbove: false});
    expect(pieceOnLine(path([100, 72], [240, 72]), CY, H)).toEqual({kind: 'line'});
  });
});

describe('places of a swap', () => {
  it('snaps to word edges and cuts inside a word only well inside it', () => {
    expect(offsetAtX(ONE_LINE, 0, 136)).toEqual({offset: 3, inside: false});
    expect(offsetAtX(ONE_LINE, 0, 172)).toEqual({offset: 7, inside: false});
    expect(offsetAtX(ONE_LINE, 0, 142)).toEqual({offset: 4, inside: false});
    expect(offsetAtX(ONE_LINE, 0, 152)).toEqual({offset: 6, inside: true});
  });

  it('zones: the parts without the spaces between them', () => {
    expect(swapZones('the big red car', 4, 7, 11)).toEqual({zones: {a0: 4, a1: 7, b0: 8, b1: 11}});
    expect(swapZones('the big red car', 4, 4, 11)).toEqual({reason: 'One side of the swap has no words.'});
    expect('reason' in swapZones('one\ntwo', 0, 3, 7)).toBe(true);
  });

  it('pairs a one-line mark', () => {
    const points = path([136, 112], [136, 72], [172, 72], [172, 128], [208, 128], [208, 90]);
    const piece = analyzeSwapPiece(points, ONE_LINE, rectOf(points));
    expect(piece?.kind).toBe('whole');
    const placed: PlacedPiece[] = piece ? [{uuid: 's', boxUuid: 'b1', piece, rect: rectOf(points)}] : [];
    const {swaps, refused} = pairSwapPieces(placed, [ONE_LINE]);
    expect(refused).toEqual([]);
    expect(swaps[0].zones).toEqual({a0: 4, a1: 7, b0: 8, b1: 11});
  });
});

describe('swap across lines', () => {
  // Line 0: "we swap this part" (y 80–120); line 1: "and here then the rest" (y 120–160).
  const TEXT = 'we swap this part and here then the rest';
  const TWO = box(TEXT, [['we', 'swap', 'this', 'part'], ['and', 'here', 'then', 'the', 'rest']]);
  // Line 0: we 100–116, swap 132–164, this 180–212, part 228–260.
  // Line 1: and 100–124, here 140–172, then 188–220, the 236–260, rest 276–308.
  const place = (uuid: string, points: Point[]): PlacedPiece[] => {
    const piece = analyzeSwapPiece(points, TWO, rectOf(points));
    return piece ? [{uuid, boxUuid: 'b1', piece, rect: rectOf(points)}] : [];
  };
  const start = place('start', path([126, 112], [126, 72], [270, 72]));
  // Middle piece between "here" and "then" on line 1: over "and here", under "then the".
  const middle = place('split', path([96, 112], [180, 112], [180, 168], [262, 168]));
  const end = place('end', path([200, 168], [266, 168], [266, 130]));

  it('reads the three pieces on their lines', () => {
    expect(start[0]?.piece).toMatchObject({kind: 'start', lineIndex: 0, aAbove: true});
    expect(middle[0]?.piece).toMatchObject({kind: 'split', lineIndex: 1, aAbove: true});
    expect(end[0]?.piece).toMatchObject({kind: 'end', lineIndex: 1, aAbove: true});
  });

  it('pairs start, middle and end into one swap', () => {
    const {swaps, refused} = pairSwapPieces([...start, ...middle, ...end], [TWO]);
    expect(refused).toEqual([]);
    expect(swaps).toHaveLength(1);
    const {a0, a1, b0, b1} = swaps[0].zones;
    expect(TEXT.slice(a0, a1)).toBe('swap this part and here');
    expect(TEXT.slice(b0, b1)).toBe('then the');
  });

  it('takes a plain line between the pieces along, but not one next to a one-line mark', () => {
    const overline = place('over', path([96, 72], [270, 72]));
    expect(overline[0]?.piece.kind).toBe('line');
    const multi = pairSwapPieces([...start, ...middle, ...end, ...overline], [TWO]);
    expect(multi.swaps[0].strokeUuids).toContain('over');
    const points = path([136, 112], [136, 72], [172, 72], [172, 128], [208, 128], [208, 90]);
    const whole = analyzeSwapPiece(points, ONE_LINE, rectOf(points));
    const line = path([100, 72], [130, 72]);
    const lonePiece = analyzeSwapPiece(line, ONE_LINE, rectOf(line));
    const single = pairSwapPieces(
      [
        ...(whole ? [{uuid: 's', boxUuid: 'b1', piece: whole, rect: rectOf(points)}] : []),
        ...(lonePiece ? [{uuid: 'l', boxUuid: 'b1', piece: lonePiece, rect: rectOf(line)}] : []),
      ],
      [ONE_LINE],
    );
    expect(single.swaps[0].strokeUuids).toEqual(['s']);
    expect(single.unusedLines).toEqual(['l']);
  });

  it('refuses a middle piece without corners, with the paragraph hint', () => {
    const {swaps, refused} = pairSwapPieces([...middle], [TWO]);
    expect(swaps).toEqual([]);
    expect(refused[0].reason).toContain('second short line');
  });

  it('refuses a short middle piece (a step) even with corners', () => {
    const short = place('short', path([150, 112], [180, 112], [180, 168], [210, 168]));
    const {swaps, refused} = pairSwapPieces([...start, ...short, ...end], [TWO]);
    expect(swaps).toEqual([]);
    expect(refused.some(entry => entry.reason.includes('too short'))).toBe(true);
  });
});

describe('swap text', () => {
  it('keeps punctuation in its slot', () => {
    expect(swapParts('big,', ' ', 'red', false, false)).toBe('red, big');
    expect(swapParts('red', ' ', 'blue.', false, false)).toBe('blue red.');
    expect(swapParts('(big', ' ', 'red)', false, false)).toBe('(red big)');
  });

  it('moves the capital at a sentence start, unless the word keeps it', () => {
    expect(startsSentence('Then quickly', 0)).toBe(true);
    expect(startsSentence('Done. Then', 6)).toBe(true);
    expect(startsSentence('and then', 4)).toBe(false);
    expect(capsAvailable('Then', 'quickly', true)).toBe(true);
    expect(swapParts('Then', ' ', 'quickly', true, true)).toBe('Quickly then');
    expect(swapParts('Then', ' ', 'quickly', false, true)).toBe('quickly Then');
    expect(swapParts('I', ' ', 'often', true, true)).toBe('Often I');
    expect(swapParts('NASA', ' ', 'says', true, true)).toBe('Says NASA');
    expect(capsAvailable('the', 'big', true)).toBe(false);
  });

  it('summarizes the two parts', () => {
    expect(swapSummary('big', 'red')).toBe('"big" ⇄ "red"');
  });
});

describe('a swap with other changes', () => {
  // "the big old red car": A = "big old" (4–11), B = "red" (12–15).
  const TEXT = 'the big old red car';
  const ZONES = {a0: 4, a1: 11, b0: 12, b1: 15};
  const change = (id: string, start: number, end: number, text = '', ready = true) => ({id, start, end, text, ready});

  it('makes edits inside a part first, then swaps', () => {
    const result = composeSwap(TEXT, ZONES, [change('del-old', 7, 11)], true);
    expect(result).toMatchObject({kind: 'ok', innerIds: ['del-old']});
    if (result.kind === 'ok') {
      expect(result.text).toBe('red big');
    }
    const replaced = composeSwap(TEXT, ZONES, [change('rep', 12, 15, 'blue')], true);
    expect(replaced.kind === 'ok' && replaced.text).toBe('blue big old');
  });

  it('leaves changes before and after the swap alone, and keeps edge insertions in place', () => {
    const result = composeSwap(TEXT, ZONES, [change('before', 0, 3), change('after', 16, 19), change('at-a0', 4, 4, 'very ')], true);
    expect(result).toMatchObject({kind: 'ok', innerIds: []});
    const inGap = composeSwap(TEXT, ZONES, [change('gap', 11, 11, ' and')], true);
    expect(inGap.kind === 'ok' && inGap.text).toBe('red and big old');
  });

  it('moves an insertion inside a word with its part', () => {
    const result = composeSwap(TEXT, ZONES, [change('in', 6, 6, 'g')], true);
    expect(result.kind === 'ok' && result.text).toBe('red bigg old');
  });

  it('conflicts: crossing an edge, a part deleted, a paragraph break inside', () => {
    expect(composeSwap(TEXT, ZONES, [change('x', 8, 14)], true).kind).toBe('conflict');
    expect(composeSwap(TEXT, ZONES, [change('x', 2, 6)], true).kind).toBe('conflict');
    expect(composeSwap(TEXT, ZONES, [change('x', 12, 15)], true)).toMatchObject({
      kind: 'conflict',
      reason: expect.stringContaining('deleted completely'),
    });
    expect(composeSwap(TEXT, ZONES, [change('x', 8, 8, SPLIT_SIGN)], true).kind).toBe('conflict');
  });

  it('waits for a change inside that is not ready', () => {
    expect(composeSwap(TEXT, ZONES, [change('pen', 12, 15, '', false)], true)).toEqual({
      kind: 'waiting',
      waitingIds: ['pen'],
    });
  });

  it('decides the capital on the edited parts', () => {
    const result = composeSwap('Big red car', {a0: 0, a1: 3, b0: 4, b1: 7}, [], true);
    expect(result).toMatchObject({kind: 'ok', text: 'Red big', capsAvailable: true});
  });
});
