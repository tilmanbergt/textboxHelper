import {closeUpSnippet, gapBetween, placeArc, punctuationAtGap} from '../../src/domain/closeUpMark';
import {bracketSnippet, characterAt, exactSpan, offsetAtVertical} from '../../src/domain/exactBounds';
import {locateHere, type HereTextbox} from '../../src/domain/insertHere';
import {applyTextMutationRanges, withSpacesKept} from '../../src/domain/markerText';
import type {CaretTextbox} from '../../src/domain/penEditCaret';
import {breakCommaTie, placePunctuation} from '../../src/domain/punctText';
import * as model from '../../src/domain/penEditModel';
import {joinParagraphTexts, trailingDash} from '../../src/domain/paragraphJoin';
import {placeSlash} from '../../src/domain/slashMark';
import {analyzeSlash, isSlashCandidateRect} from '../../src/domain/marks/shapes/slash';
import {analyzeArc} from '../../src/domain/marks/shapes/closeUp';
import {analyzeCaret} from '../../src/domain/marks/shapes/caret';
import type {Point} from '../../src/domain/marks/markStroke';
import {analyzeCircle, findCaretCircle, readCircle, type PlainStroke} from '../../src/domain/marks/shapes/punct';

/** Points every few pixels along straight segments between the corners. */
function path(...corners: Array<[number, number]>): Point[] {
  const points: Point[] = [];
  for (let index = 0; index < corners.length - 1; index += 1) {
    const [x1, y1] = corners[index];
    const [x2, y2] = corners[index + 1];
    const steps = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / 3));
    for (let step = 0; step < steps; step += 1) {
      points.push({x: x1 + ((x2 - x1) * step) / steps, y: y1 + ((y2 - y1) * step) / steps});
    }
  }
  const [x, y] = corners[corners.length - 1];
  points.push({x, y});
  return points;
}

/** A round arc from (x0, y) to (x1, y), sagging by `sag` (positive: down). */
function arc(x0: number, x1: number, y: number, sag: number, steps = 24): Point[] {
  const points: Point[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    points.push({x: x0 + (x1 - x0) * t, y: y + sag * 4 * t * (1 - t)});
  }
  return points;
}

function circle(cx: number, cy: number, r: number, steps = 32): Point[] {
  const points: Point[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const angle = (2 * Math.PI * step) / steps;
    points.push({x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle)});
  }
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

function stroke(uuid: string, points: Point[]): PlainStroke {
  return {uuid, points, rect: rectOf(points)};
}

/** A textbox with its words 8 px per letter, 16 px apart, lines 40 px high from y 80. */
function box(text: string, lines: string[][]): CaretTextbox {
  const words: CaretTextbox['words'] = [];
  const lineInfo: CaretTextbox['lines'] = [];
  let offset = 0;
  lines.forEach((lineWords, lineIndex) => {
    const lineStart = offset;
    let x = 100;
    lineWords.forEach(word => {
      const start = text.indexOf(word, offset);
      const edges = Array.from({length: word.length + 1}, (_, index) => x + index * 8);
      words.push({start, end: start + word.length, lineIndex, left: x, right: x + word.length * 8, edges});
      x += word.length * 8 + 16;
      offset = start + word.length;
    });
    const lineEnd = lineIndex === lines.length - 1 ? text.length : text.indexOf(lines[lineIndex + 1][0], offset);
    lineInfo.push({index: lineIndex, start: lineStart, end: lineEnd, top: 80 + lineIndex * 40, bottom: 120 + lineIndex * 40});
    offset = lineEnd;
  });
  return {uuid: 'b1', numInPage: 1, rect: {left: 90, top: 80, right: 600, bottom: 80 + lines.length * 40}, text, lines: lineInfo, words};
}

// "the big red car": the 100–124, big 140–164, red 180–204, car 220–244 (line y 80–120).
const LINE = box('the big red car', [['the', 'big', 'red', 'car']]);
const TWO_LINES = box('note book', [['note'], ['book']]);

describe('spaces after deletions and replacements (§2.1)', () => {
  it('puts one space back so exact ranges never glue words', () => {
    // Verticals around "big " (with its space), replaced by "small".
    expect(applyTextMutationRanges('the big red car', [{kind: 'replace', start: 4, end: 8, replacementText: 'small'}])).toBe(
      'the small red car',
    );
    // The same, deleted: the space before "big" remains.
    expect(applyTextMutationRanges('the big red car', [{kind: 'delete', start: 4, end: 8}])).toBe('the red car');
    // ", and" between "red" and " blue".
    expect(applyTextMutationRanges('red, and blue', [{kind: 'delete', start: 3, end: 8}])).toBe('red blue');
    // " big" at a word's end side, with letters meeting.
    expect(withSpacesKept('red big car', 3, 7, '', false)).toBe('');
    expect(withSpacesKept('redbig car', 3, 7, '', false)).toBe(' ');
  });

  it('leaves word-level and joining ranges alone', () => {
    expect(applyTextMutationRanges('the big red car', [{kind: 'delete', start: 4, end: 7}])).toBe('the red car');
    expect(applyTextMutationRanges('note book', [{kind: 'replace', start: 4, end: 5, replacementText: '', joins: true}])).toBe(
      'notebook',
    );
    expect(applyTextMutationRanges('bigger', [{kind: 'replace', start: 4, end: 6, replacementText: 'st'}])).toBe('biggst');
  });

  it('tidies punctuation as before', () => {
    expect(applyTextMutationRanges('the car today.', [{kind: 'delete', start: 8, end: 13}])).toBe('the car.');
    // A stray comma left by a word-level strike stays: the user nudges the edge.
    expect(applyTextMutationRanges('big, red car', [{kind: 'delete', start: 0, end: 3}])).toBe(', red car');
  });
});

describe('exact bounds (§3)', () => {
  it('turns a vertical into a character offset, snapping to word edges', () => {
    // "bigger" from x 100: letters every 8 px.
    const words = [{start: 0, end: 6, left: 100, right: 148, edges: [100, 108, 116, 124, 132, 140, 148]}];
    expect(offsetAtVertical(words, 131, 'start')).toBe(4);
    expect(offsetAtVertical(words, 102, 'start')).toBe(0);
    expect(offsetAtVertical(words, 146, 'end')).toBe(6);
    expect(exactSpan(words, 131, 150)).toEqual({start: 4, end: 6});
  });

  it('takes the inner word edge for a vertical in a gap', () => {
    expect(offsetAtVertical(LINE.words, 132, 'start')).toBe(4);
    expect(offsetAtVertical(LINE.words, 172, 'end')).toBe(7);
    expect(exactSpan(LINE.words, 132, 172)).toEqual({start: 4, end: 7});
    expect(exactSpan(LINE.words, 150, 151)).toBeNull();
  });

  it('finds the character under a point, and shows the marked part', () => {
    expect(characterAt(LINE.words, 243)).toBe(14);
    expect(characterAt(LINE.words, 170)).toBeNull();
    expect(bracketSnippet('bigger', 4, 6)).toBe('bigg[er]');
    expect(bracketSnippet('the cars are', 7, 8)).toBe('car[s]');
  });
});

describe('slash (§4)', () => {
  it('reads a short steep stroke and places it on the letter it crosses', () => {
    const slash = analyzeSlash(path([246, 88], [238, 114]));
    expect(slash).not.toBeNull();
    // Crosses the line's middle (y 100) at x ≈ 241: the "r" of "car" (236–244).
    expect(placeSlash(slash!, LINE)).toEqual({kind: 'letter', uuid: 'b1', lineIndex: 0, offset: 14});
  });

  it('refuses a slash through a space and ignores flat or long strokes', () => {
    const inGap = analyzeSlash(path([172, 88], [168, 114]));
    expect(placeSlash(inGap!, LINE)).toMatchObject({kind: 'refused'});
    expect(analyzeSlash(path([100, 100], [140, 104]))).toBeNull();
    const tooTall = analyzeSlash(path([241, 40], [239, 140]));
    expect(placeSlash(tooTall!, LINE)).toBeNull();
    const notOnMiddle = analyzeSlash(path([241, 81], [239, 95]));
    expect(placeSlash(notOnMiddle!, LINE)).toBeNull();
  });

  it('tells which rects may hold a slash, for the look-back to read their points', () => {
    expect(isSlashCandidateRect({left: 0, top: 0, right: 8, bottom: 30})).toBe(true);
    // Strike-like: flatter than ~29°.
    expect(isSlashCandidateRect({left: 0, top: 0, right: 60, bottom: 30})).toBe(false);
    // From 10 px tall (§13.1 Q4); below that, no slash.
    expect(isSlashCandidateRect({left: 0, top: 0, right: 8, bottom: 10})).toBe(true);
    expect(isSlashCandidateRect({left: 0, top: 0, right: 8, bottom: 8})).toBe(false);
    // 35°: a slash's rect now.
    expect(isSlashCandidateRect({left: 0, top: 0, right: 38, bottom: 26})).toBe(true);
  });

  it('reads a slanted slash from 30° and marks it uncertain when wider than two letters', () => {
    // 35°, crossing the middle of "big" (140–164) at x ≈ 153: the "i" (148–156).
    const slanted = analyzeSlash(path([136, 112], [168, 89]));
    expect(slanted?.angleDeg).toBeGreaterThan(30);
    expect(placeSlash(slanted!, LINE)).toMatchObject({kind: 'letter', offset: 5, uncertain: expect.stringContaining('slanted')});
    expect(analyzeSlash(path([136, 108], [176, 92]))).toBeNull();
  });
});

describe('close-up arc (§6, §7)', () => {
  it('reads round arcs both ways and refuses flat strokes and carets', () => {
    expect(analyzeArc(arc(160, 190, 118, 10))).toMatchObject({opening: 'up'});
    expect(analyzeArc(arc(190, 160, 82, -10))).toMatchObject({opening: 'down'});
    expect(analyzeArc(path([160, 118], [190, 119]))).toBeNull();
    expect(analyzeArc(path([160, 100], [175, 130], [190, 100]))).toBeNull();
    // Deepest point at one end: a hook, not an arc.
    expect(analyzeArc(path([160, 110], [185, 111], [190, 125]))).toBeNull();
  });

  it('closes the one gap under the arc', () => {
    const under = analyzeArc(arc(158, 186, 112, 8))!;
    expect(placeArc(under, LINE)).toEqual({kind: 'gap', uuid: 'b1', lineIndex: 0, start: 7, end: 8});
    const over = analyzeArc(arc(158, 186, 86, -8))!;
    expect(placeArc(over, LINE)).toMatchObject({kind: 'gap', start: 7, end: 8});
  });

  it('refuses an arc over two gaps or reaching far into the words', () => {
    const twoGaps = analyzeArc(arc(150, 215, 112, 14))!;
    expect(placeArc(twoGaps, LINE)).toMatchObject({kind: 'refused'});
    const wide = analyzeArc(arc(100, 200, 112, 16))!;
    expect(placeArc(wide, LINE)).toMatchObject({kind: 'refused'});
  });

  it('finds end and start pieces at a line wrap', () => {
    // "note" 100–132 on line 0, "book" 100–132 on line 1.
    const end = analyzeArc(arc(120, 160, 112, 8))!;
    expect(placeArc(end, TWO_LINES)).toEqual({kind: 'end', uuid: 'b1', lineIndex: 0, offset: 4});
    const start = analyzeArc(arc(70, 112, 152, 8))!;
    expect(placeArc(start, TWO_LINES)).toEqual({kind: 'start', uuid: 'b1', lineIndex: 1, offset: 5});
    expect(gapBetween('note book', 4, 5)).toEqual({start: 4, end: 5});
    expect(gapBetween('notebook', 4, 4)).toBeNull();
  });

  it('offers the punctuation at the gap for the toggle', () => {
    expect(punctuationAtGap('note- book', 5, 6)).toEqual({from: 4, to: 6, text: '-'});
    expect(punctuationAtGap('word ,next', 4, 5)).toEqual({from: 4, to: 6, text: ','});
    expect(punctuationAtGap('note book', 4, 5).text).toBe('');
    expect(closeUpSnippet('note book', 4, 5)).toBe('note|book');
  });
});

describe('punctuation circle (§9)', () => {
  // A V with its tip at (200, 110), legs up to (180, 70) and (220, 70).
  const caret = analyzeCaret(path([180, 70], [200, 110], [220, 70]))!;

  it('finds the circle between the legs and what is in it', () => {
    const ring = stroke('ring', circle(200, 82, 12));
    const dot = stroke('dot', path([200, 86], [201, 87]));
    const outside = stroke('far', circle(300, 82, 12));
    const found = findCaretCircle(caret, [outside, ring, dot]);
    expect(found?.circle.uuid).toBe('ring');
    expect(found?.contents.map(item => item.uuid)).toEqual(['dot']);
    expect(findCaretCircle(caret, [outside])).toBeNull();
  });

  it('refuses open strokes and long thin loops as circles', () => {
    expect(analyzeCircle(arc(0, 30, 0, 10), rectOf(arc(0, 30, 0, 10)))).toBeNull();
    const oval = path([0, 0], [60, 0], [60, 10], [0, 10], [0, 0]);
    expect(analyzeCircle(oval, rectOf(oval))).toBeNull();
  });

  it('reads the v1 marks against the circle', () => {
    const shape = {centre: {x: 200, y: 82}, radius: 14, rect: {left: 186, top: 68, right: 214, bottom: 96}};
    const read = (...parts: Point[][]) => readCircle(shape, parts.map((points, index) => stroke(`s${index}`, points)));
    expect(read(path([200, 82], [201, 83]))).toEqual({char: '.', tie: false});
    expect(read(path([201, 84], [199, 93]))).toEqual({char: ',', tie: false});
    expect(read(path([201, 72], [199, 80]))).toEqual({char: "'", tie: false});
    expect(read(path([201, 78], [199, 86]))).toEqual({char: ',', tie: true});
    expect(read(path([193, 82], [207, 83]))).toEqual({char: '-', tie: false});
    expect(read(path([200, 76], [201, 77]), path([200, 88], [201, 89]))).toEqual({char: ':', tie: false});
    expect(read(path([200, 74], [201, 75]), path([201, 84], [199, 93]))).toEqual({char: ';', tie: false});
    expect(read(path([190, 75], [210, 90]), path([210, 75], [190, 90]))).toEqual({char: null, tie: false});
  });

  it('places punctuation by its type (§2.5 examples)', () => {
    const apply = (text: string, offset: number, mode: 'inWord' | 'betweenWords', char: Parameters<typeof placePunctuation>[3]) => {
      const place = placePunctuation(text, offset, mode, char);
      return place.kind === 'place'
        ? applyTextMutationRanges(text, [{kind: 'replace', start: place.start, end: place.end, replacementText: place.text, joins: place.joins}])
        : null;
    };
    expect(apply('Yes I know', 3, 'betweenWords', ',')).toBe('Yes, I know');
    // The tip snapped to the start of "I": the comma still goes after "Yes".
    expect(apply('Yes I know', 4, 'betweenWords', ',')).toBe('Yes, I know');
    expect(apply('the end', 7, 'betweenWords', '.')).toBe('the end.');
    expect(apply('one two', 3, 'betweenWords', ';')).toBe('one; two');
    expect(apply('dont', 3, 'inWord', "'")).toBe("don't");
    expect(apply('Tilmans book', 7, 'betweenWords', "'")).toBe("Tilmans' book");
    expect(apply('e mail', 1, 'betweenWords', '-')).toBe('e-mail');
    expect(apply('email', 1, 'inWord', '-')).toBe('e-mail');
    expect(apply('15', 1, 'inWord', ',')).toBe('1,5');
    expect(apply('walking', 4, 'inWord', ',')).toBeNull();
    expect(apply('one two', 4, 'betweenWords', "'")).toBeNull();
  });

  it('replaces a comma with a semicolon: deletion and insertion at its edge apply together', () => {
    // Slash on "," (offset 5) and the circle's ";" at the same place.
    expect(
      applyTextMutationRanges('Hello, world', [
        {kind: 'delete', start: 5, end: 6},
        {kind: 'replace', start: 5, end: 5, replacementText: ';'},
      ]),
    ).toBe('Hello; world');
  });

  it('breaks a comma-apostrophe tie by the place', () => {
    expect(breakCommaTie('inWord')).toBe("'");
    expect(breakCommaTie('betweenWords')).toBe(',');
  });
});

describe('insert right here (§8)', () => {
  const above: HereTextbox = {uuid: 'a', numInPage: 1, rect: {left: 100, top: 100, right: 900, bottom: 300}, lineHeight: 50};
  const below: HereTextbox = {uuid: 'b', numInPage: 2, rect: {left: 100, top: 500, right: 900, bottom: 700}, lineHeight: 50};

  it('puts handwriting between two paragraphs there, also overlapping the one above a bit', () => {
    expect(locateHere({left: 120, top: 360, right: 600, bottom: 440}, [above, below], 1404, 7)).toEqual({
      kind: 'gap',
      above: 'a',
      below: 'b',
    });
    expect(locateHere({left: 120, top: 280, right: 600, bottom: 400}, [above, below], 1404, 7)).toMatchObject({
      kind: 'gap',
      above: 'a',
    });
  });

  it('goes before a paragraph when it starts just above its first line', () => {
    expect(locateHere({left: 120, top: 470, right: 600, bottom: 560}, [above, below], 1404, 7)).toEqual({
      kind: 'gap',
      above: 'a',
      below: 'b',
    });
  });

  it('refuses handwriting over text or beside a paragraph', () => {
    expect(locateHere({left: 120, top: 180, right: 600, bottom: 260}, [above, below], 1404, 7)).toMatchObject({
      kind: 'unclear',
      reason: expect.stringContaining('lies over the text of textbox 1'),
    });
    const narrow: HereTextbox = {uuid: 'n', numInPage: 3, rect: {left: 100, top: 100, right: 500, bottom: 400}, lineHeight: 50};
    expect(locateHere({left: 700, top: 200, right: 900, bottom: 260}, [narrow], 1404, 7)).toMatchObject({
      kind: 'unclear',
      reason: expect.stringContaining('beside textbox 3'),
    });
  });

  it('makes a new textbox where no paragraph is near', () => {
    expect(locateHere({left: 200, top: 900, right: 600, bottom: 980}, [], 1404, 7)).toEqual({
      kind: 'newBox',
      left: 200,
      top: 900,
      width: 1144,
      styleFrom: null,
    });
    const narrow: HereTextbox = {uuid: 'n', numInPage: 3, rect: {left: 100, top: 100, right: 500, bottom: 400}, lineHeight: 50};
    expect(locateHere({left: 900, top: 1200, right: 1100, bottom: 1260}, [narrow], 1404, 7)).toMatchObject({
      kind: 'newBox',
      styleFrom: 'n',
      width: 400,
    });
  });
});

describe('the fine marks in the index (§2.2, §4)', () => {
  it('keeps the exact bounds, slash and number place when the index is read again', () => {
    const mark = {
      kind: 'replace' as const,
      strikeRect: {left: 0, top: 0, right: 8, bottom: 30},
      modifierRects: [],
      bounds: 'exact' as const,
      slash: true,
      numberRect: {left: 0, top: -40, right: 28, bottom: -12},
    };
    const parsed = model.parsePenEditEntry({
      id: 'x',
      kind: 'insertion',
      notePath: '/n.note',
      page: 0,
      number: 3,
      rect: {left: 0, top: 0, right: 10, bottom: 10},
      mark,
      placement: 'here',
    });
    expect(parsed?.mark).toEqual(mark);
    expect(parsed?.placement).toBe('here');
    const index = {version: model.PEN_EDIT_INDEX_VERSION, entries: [{...parsed!, kind: 'unpaired' as const, awaitingMark: {since: 'x', from: 'tag' as const}}]};
    expect(model.setPlaceHere(index, 'x').entries[0]).toMatchObject({kind: 'insertion', placement: 'here', awaitingMark: null});
  });
});

describe('paragraph join text (§7)', () => {
  it('puts one space between, or nothing when the dash goes', () => {
    expect(joinParagraphTexts('…permission. ', ' The next', false)).toBe('…permission. The next');
    expect(joinParagraphTexts('note-', 'book', true)).toBe('notebook');
    expect(joinParagraphTexts('note-', 'book', false)).toBe('note- book');
    expect(trailingDash('a note- ')).toBe('-');
    expect(trailingDash('a note')).toBe('');
  });
});
