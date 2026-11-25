import {caretInsertionText} from '../../src/domain/penEditCaret';
import {SPLIT_SIGN, showSplits, splitChangeText, splitParagraphParts} from '../../src/domain/paragraphMarks';
import {analyzeCaret, caretNumberCenter, analyzeStepMark} from '../../src/domain/marks/shapes/caret';
import type {Point} from '../../src/domain/marks/markStroke';
import {locateCaret} from '../../src/domain/marks/place/point';
import type {CaretTextbox} from '../../src/domain/marks/textboxView';

function path(...corners: Point[]): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < corners.length - 1; i += 1) {
    for (let step = i === 0 ? 0 : 1; step <= 8; step += 1) {
      points.push({
        x: corners[i].x + ((corners[i + 1].x - corners[i].x) * step) / 8,
        y: corners[i].y + ((corners[i + 1].y - corners[i].y) * step) / 8,
      });
    }
  }
  return points;
}

// Page 26, textbox 5: four lines of 48 px from y 466; words measured from x 135.
const textbox5Text =
  'This simplicity is not dullness. It is vivid. It lets things be just what they are before ' +
  'This is a replacement The face of another person, the steam above tea, the ache in the chest, ' +
  'the sound of rain on a window: Something needing permission.';
const line2Start = textbox5Text.indexOf('they are');
const line3Start = textbox5Text.indexOf('the steam');
const line4Start = textbox5Text.indexOf('window:');
const textbox5: CaretTextbox = {
  uuid: 't5',
  numInPage: 5,
  rect: {left: 120, top: 466, right: 1224, bottom: 658},
  text: textbox5Text,
  lines: [
    {index: 0, start: 0, end: line2Start, top: 466, bottom: 514},
    {index: 1, start: line2Start, end: line3Start, top: 514, bottom: 562},
    {index: 2, start: line3Start, end: line4Start, top: 562, bottom: 610},
    {
      index: 3,
      start: line4Start,
      end: textbox5Text.length,
      top: 610,
      bottom: 658,
    },
  ],
  words: [
    {start: 0, end: 4, lineIndex: 0, left: 135, right: 205},
    {start: 5, end: 15, lineIndex: 0, left: 214, right: 385},
    {start: 33, end: 35, lineIndex: 0, left: 620, right: 650},
    {start: 36, end: 38, lineIndex: 0, left: 659, right: 684},
    {
      start: line2Start,
      end: line2Start + 4,
      lineIndex: 1,
      left: 135,
      right: 200,
    },
    {
      start: line4Start,
      end: line4Start + 7,
      lineIndex: 3,
      left: 135,
      right: 270,
    },
  ],
};
const textbox3: CaretTextbox = {
  uuid: 't3',
  numInPage: 3,
  rect: {left: 112, top: 1337, right: 1216, bottom: 1529},
  text: 'To live from such simplicity is already a kind of compassion. One does not have',
  lines: [
    {index: 0, start: 0, end: 66, top: 1337, bottom: 1385},
    {index: 1, start: 66, end: 79, top: 1385, bottom: 1433},
  ],
  words: [{start: 0, end: 2, lineIndex: 0, left: 127, right: 160}],
};

describe('sideways carets mark a boundary between lines', () => {
  it('splits a paragraph between two lines (device case: > before line 2 of textbox 5)', () => {
    expect(
      locateCaret({x: 183, y: 512}, 'right', [textbox5, textbox3]),
    ).toEqual({
      kind: 'split',
      uuid: 't5',
      numInPage: 5,
      offset: line2Start,
    });
  });

  it('is the gap after a paragraph at its last boundary', () => {
    expect(
      locateCaret({x: 1093, y: 652}, 'left', [textbox5, textbox3]),
    ).toEqual({kind: 'gap', above: 't5', below: 't3'});
  });

  it('is the gap before a paragraph at its first boundary', () => {
    expect(
      locateCaret({x: 150, y: 1340}, 'right', [textbox5, textbox3]),
    ).toEqual({kind: 'gap', above: 't5', below: 't3'});
  });

  it('is the gap after a paragraph for a tip just below its last line (device case: small < after "permission.")', () => {
    expect(
      locateCaret({x: 1147, y: 672}, 'left', [textbox5, textbox3]),
    ).toEqual({kind: 'gap', above: 't5', below: 't3'});
  });

  it('is after the paragraph beside its last line, past the last word (device case: big < after "permission.")', () => {
    expect(
      locateCaret({x: 1093, y: 636}, 'left', [textbox5, textbox3]),
    ).toEqual({kind: 'gap', above: 't5', below: 't3'});
  });

  it('is unclear in the middle of a line that runs on', () => {
    expect(
      locateCaret({x: 1150, y: 538}, 'left', [textbox5, textbox3]),
    ).toMatchObject({kind: 'unclear'});
    // Touching the last word is not "past" it.
    expect(
      locateCaret({x: 280, y: 634}, 'left', [textbox5, textbox3]),
    ).toMatchObject({kind: 'unclear'});
  });

  it('breaks at an empty line and after a line ending in a line break', () => {
    const text = 'First part ends here.\n\nSecond part.\nThird line.';
    const paragraphs: CaretTextbox = {
      uuid: 'pp',
      numInPage: 9,
      rect: {left: 100, top: 100, right: 900, bottom: 292},
      text,
      lines: [
        {index: 0, start: 0, end: 22, top: 100, bottom: 148},
        {index: 1, start: 22, end: 23, top: 148, bottom: 196},
        {index: 2, start: 23, end: 36, top: 196, bottom: 244},
        {index: 3, start: 36, end: text.length, top: 244, bottom: 292},
      ],
      words: [
        {start: 0, end: 5, lineIndex: 0, left: 115, right: 200},
        {start: 17, end: 21, lineIndex: 0, left: 420, right: 480},
        {start: 23, end: 29, lineIndex: 2, left: 115, right: 220},
        {start: 30, end: 35, lineIndex: 2, left: 229, right: 320},
        {start: 36, end: 41, lineIndex: 3, left: 115, right: 200},
      ],
    };
    expect(locateCaret({x: 700, y: 172}, 'left', [paragraphs])).toEqual({
      kind: 'split',
      uuid: 'pp',
      numInPage: 9,
      offset: 22,
    });
    expect(locateCaret({x: 700, y: 220}, 'left', [paragraphs])).toEqual({
      kind: 'split',
      uuid: 'pp',
      numInPage: 9,
      offset: 36,
    });
  });

  it('accepts sideways carets up to 250 px, V and ∧ only up to 130 px', () => {
    expect(
      analyzeCaret(
        path({x: 1245, y: 580}, {x: 1093, y: 636}, {x: 1245, y: 685}),
      )?.direction,
    ).toBe('left');
    expect(
      analyzeCaret(path({x: 100, y: 100}, {x: 175, y: 260}, {x: 250, y: 100})),
    ).toBeNull();
  });
});

describe('the step mark', () => {
  // Under line 1 of textbox 5 from x 560 to 612, up to y 452, then right to 700.
  const step = path(
    {x: 560, y: 528},
    {x: 612, y: 528},
    {x: 614, y: 452},
    {x: 700, y: 452},
  );

  it('is a run right, straight up, a run right', () => {
    const shape = analyzeStepMark(step);
    expect(shape?.direction).toBe('step');
    expect(shape?.tip.x).toBeCloseTo(613, 0);
    expect(analyzeCaret(step)?.direction).toBe('step');
  });

  it('rejects other shapes', () => {
    expect(
      analyzeStepMark(path({x: 560, y: 528}, {x: 700, y: 452})),
    ).toBeNull();
    expect(
      analyzeStepMark(
        path(
          {x: 700, y: 452},
          {x: 614, y: 452},
          {x: 612, y: 528},
          {x: 560, y: 528},
        ),
      ),
    ).toBeNull();
    expect(
      analyzeStepMark(
        path(
          {x: 560, y: 528},
          {x: 612, y: 528},
          {x: 660, y: 452},
          {x: 700, y: 452},
        ),
      ),
    ).toBeNull();
  });

  it('splits at the word gap nearest its upright, on the line it crosses', () => {
    const shape = analyzeStepMark(step)!;
    expect(locateCaret(shape.tip, 'step', [textbox5])).toEqual({
      kind: 'split',
      uuid: 't5',
      numInPage: 5,
      offset: 33,
    });
  });

  it("is no split at a paragraph's start", () => {
    expect(locateCaret({x: 130, y: 490}, 'step', [textbox5])).toMatchObject({
      kind: 'unclear',
    });
  });

  it('puts the number right of the upper run', () => {
    expect(caretNumberCenter(analyzeStepMark(step)!)).toEqual({x: 728, y: 452});
  });
});

describe('the split sign', () => {
  it('cuts a text into paragraphs, dropping empty parts', () => {
    expect(
      splitParagraphParts(`One. ${SPLIT_SIGN}New.${SPLIT_SIGN} Two.`),
    ).toEqual(['One.', 'New.', 'Two.']);
    expect(splitParagraphParts(`One.${SPLIT_SIGN}`)).toEqual(['One.']);
  });

  it('is the sign alone, or around inserted text', () => {
    expect(splitChangeText(null)).toBe(SPLIT_SIGN);
    expect(splitChangeText(' New. ')).toBe(`${SPLIT_SIGN}New.${SPLIT_SIGN}`);
    expect(caretInsertionText('a b', 2, 'New', 'paragraph')).toBe(
      `${SPLIT_SIGN}New${SPLIT_SIGN}`,
    );
  });

  it('shows as paragraph ends in the review', () => {
    expect(showSplits(`One. ${SPLIT_SIGN}Two.`)).toBe('One. ¶\nTwo.');
  });
});
