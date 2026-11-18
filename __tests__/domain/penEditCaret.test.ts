import {
  analyzeCaret,
  caretInsertionText,
  caretNumberCenter,
  gapParagraphPlacement,
  locateCaret,
  placeGapParagraphs,
  planReflow,
  type CaretTextbox,
  type Point,
} from '../../src/domain/penEditCaret';

function leg(from: Point, to: Point, steps = 8): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    points.push({x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps});
  }
  return points;
}

function stroke(...corners: Point[]): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < corners.length - 1; i += 1) {
    points.push(...leg(corners[i], corners[i + 1]).slice(i === 0 ? 0 : 1));
  }
  return points;
}

describe('analyzeCaret', () => {
  it('finds a V with its tip at the bottom', () => {
    const shape = analyzeCaret(stroke({x: 100, y: 100}, {x: 120, y: 140}, {x: 140, y: 100}));
    expect(shape?.direction).toBe('down');
    expect(shape?.tip).toEqual({x: 120, y: 140});
  });

  it('finds a ∧ with its tip at the top', () => {
    const shape = analyzeCaret(stroke({x: 100, y: 140}, {x: 118, y: 100}, {x: 140, y: 140}));
    expect(shape?.direction).toBe('up');
    expect(shape?.tip.y).toBe(100);
  });

  it('puts the number between the ends of the legs', () => {
    const shape = analyzeCaret(stroke({x: 100, y: 100}, {x: 120, y: 160}, {x: 144, y: 104}));
    expect(shape).not.toBeNull();
    expect(caretNumberCenter(shape!)).toEqual({x: 122, y: 102});
  });

  it('rejects lines, loops, letters and big shapes', () => {
    expect(analyzeCaret(stroke({x: 100, y: 100}, {x: 160, y: 104}))).toBeNull();
    expect(analyzeCaret(stroke({x: 100, y: 100}, {x: 100, y: 150}))).toBeNull();
    const loop: Point[] = [];
    for (let i = 0; i <= 24; i += 1) {
      loop.push({x: 120 + 20 * Math.cos((i / 24) * 2 * Math.PI), y: 120 + 20 * Math.sin((i / 24) * 2 * Math.PI)});
    }
    expect(analyzeCaret(loop)).toBeNull();
    expect(analyzeCaret(stroke({x: 100, y: 100}, {x: 110, y: 140}, {x: 130, y: 100}, {x: 140, y: 140}))).toBeNull();
    expect(analyzeCaret(stroke({x: 100, y: 100}, {x: 200, y: 300}, {x: 300, y: 100}))).toBeNull();
  });
});

// "Hello brave world" on one line, then a blank line, then "Next part" (one textbox).
const text = 'Hello brave world\n\nNext part';
const box: CaretTextbox = {
  uuid: 'a',
  numInPage: 4,
  rect: {left: 100, top: 100, right: 700, bottom: 250},
  text,
  lines: [
    {index: 0, start: 0, end: 18, top: 100, bottom: 148},
    {index: 1, start: 18, end: 19, top: 148, bottom: 196},
    {index: 2, start: 19, end: 28, top: 196, bottom: 244},
  ],
  words: [
    {start: 0, end: 5, lineIndex: 0, left: 100, right: 200},
    {start: 6, end: 11, lineIndex: 0, left: 220, right: 320},
    {start: 12, end: 17, lineIndex: 0, left: 340, right: 440},
    {start: 19, end: 23, lineIndex: 2, left: 100, right: 180},
    {start: 24, end: 28, lineIndex: 2, left: 200, right: 280},
  ],
};
const nextBox: CaretTextbox = {...box, uuid: 'b', numInPage: 5, rect: {left: 100, top: 320, right: 700, bottom: 368}, text: 'Last', lines: [{index: 0, start: 0, end: 4, top: 320, bottom: 368}], words: [{start: 0, end: 4, lineIndex: 0, left: 100, right: 180}]};

describe('locateCaret', () => {
  it('places a V between two words on the line it points to', () => {
    expect(locateCaret({x: 210, y: 112}, 'down', [box, nextBox])).toEqual({kind: 'text', uuid: 'a', numInPage: 4, offset: 5, mode: 'betweenWords'});
  });

  it('places a ∧ under the line inside a word', () => {
    // "brave": 5 chars over 100 px; x = 260 is 2 chars in.
    expect(locateCaret({x: 260, y: 150}, 'up', [box, nextBox])).toEqual({kind: 'text', uuid: 'a', numInPage: 4, offset: 8, mode: 'inWord'});
  });

  it('snaps a tip close to a word edge to that edge', () => {
    expect(locateCaret({x: 225, y: 112}, 'down', [box])).toMatchObject({offset: 6, mode: 'betweenWords'});
    expect(locateCaret({x: 316, y: 112}, 'down', [box])).toMatchObject({offset: 11, mode: 'betweenWords'});
  });

  it('puts the text after the last word when the tip is past the line end', () => {
    expect(locateCaret({x: 520, y: 112}, 'down', [box])).toMatchObject({offset: 17, mode: 'betweenWords'});
  });

  it('finds a blank line between paragraphs of one textbox', () => {
    expect(locateCaret({x: 300, y: 160}, 'down', [box])).toMatchObject({offset: 18, mode: 'blankLine'});
  });

  it('finds the space between two textboxes', () => {
    expect(locateCaret({x: 300, y: 290}, 'down', [box, nextBox])).toEqual({kind: 'gap', above: 'a', below: 'b'});
  });

  it('finds nothing away from the text', () => {
    expect(locateCaret({x: 1000, y: 112}, 'down', [box, nextBox])).toBeNull();
  });
});

describe('caretInsertionText', () => {
  const original = 'Hello brave world';
  it('adds a space before the word at a word end', () => {
    expect(caretInsertionText(original, 5, 'very', 'betweenWords')).toBe(' very');
  });
  it('adds a space after the word at a word start', () => {
    expect(caretInsertionText(original, 6, 'very', 'betweenWords')).toBe('very ');
  });
  it('keeps punctuation tight', () => {
    expect(caretInsertionText(original, 17, '.', 'betweenWords')).toBe('.');
    expect(caretInsertionText(original, 5, ',', 'betweenWords')).toBe(',');
  });
  it('inserts letters inside a word as written', () => {
    expect(caretInsertionText(original, 8, ' ss ', 'inWord')).toBe('ss');
  });
  it('makes a paragraph on a blank line', () => {
    expect(caretInsertionText('A\n\nB', 2, 'Middle', 'blankLine')).toBe('\nMiddle\n');
  });
});

describe('planReflow and gapParagraphPlacement', () => {
  it('moves only the paragraphs below a growth, in the same column', () => {
    const items = [
      {key: 'a', rect: {left: 100, top: 100, right: 700, bottom: 200}},
      {key: 'b', rect: {left: 100, top: 240, right: 700, bottom: 300}},
      {key: 'c', rect: {left: 800, top: 240, right: 1300, bottom: 300}},
    ];
    const shifts = planReflow(items, [{y: 200, left: 100, right: 700, delta: 48, sourceKeys: ['a']}]);
    expect(shifts.get('a')).toBeUndefined();
    expect(shifts.get('b')).toBe(48);
    expect(shifts.get('c')).toBeUndefined();
  });

  it('keeps the space between paragraphs around a new one', () => {
    const placement = gapParagraphPlacement({left: 0, top: 100, right: 600, bottom: 200}, {left: 0, top: 230, right: 600, bottom: 300}, 48);
    expect(placement).toEqual({top: 230, spacing: 30, pushBelow: 78});
  });

  it('does not push when there is room', () => {
    const placement = gapParagraphPlacement({left: 0, top: 100, right: 600, bottom: 200}, {left: 0, top: 500, right: 600, bottom: 560}, 48);
    expect(placement.top).toBe(260);
    expect(placement.pushBelow).toBe(0);
  });

  it('stacks two new paragraphs in one gap and pushes the next one once', () => {
    const above = {left: 0, top: 100, right: 600, bottom: 200};
    const below = {left: 0, top: 230, right: 600, bottom: 300};
    const {rects, events} = placeGapParagraphs([
      {key: 'n1', group: 'g', left: 0, width: 600, height: 48, above, below},
      {key: 'n2', group: 'g', left: 0, width: 600, height: 48, above, below},
    ]);
    expect(rects.get('n1')).toEqual({left: 0, top: 230, right: 600, bottom: 278});
    expect(rects.get('n2')).toEqual({left: 0, top: 308, right: 600, bottom: 356});
    expect(events).toEqual([{y: 230, left: 0, right: 600, delta: 156, sourceKeys: ['n1', 'n2']}]);
    const shifts = planReflow([{key: 'b', rect: below}, {key: 'n1', rect: rects.get('n1')!}], events);
    expect(shifts.get('b')).toBe(156);
    expect(shifts.get('n1')).toBeUndefined();
  });
});
