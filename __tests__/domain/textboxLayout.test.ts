import {
  countExplicitEmptyLines,
  DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION,
  estimateTextboxHeightFallback,
  getExtraLineStep,
  getRequestedWidth,
} from '../../src/domain/textboxLayout';

describe('textbox layout without the device', () => {
  it('narrows the measured width by the calibrated adjustment, but not below 24 px', () => {
    expect(getRequestedWidth(500, DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION)).toBe(470);
    expect(getRequestedWidth(40, DEFAULT_TEXTBOX_MEASUREMENT_CALIBRATION)).toBe(24);
  });

  it('estimates one line, more lines for longer text, and never less than 48 px', () => {
    expect(estimateTextboxHeightFallback('Hello', 600, 36)).toBe(101);
    expect(estimateTextboxHeightFallback('word '.repeat(60), 600, 36)).toBe(636);
    expect(estimateTextboxHeightFallback('a', 600, 8)).toBe(48);
  });

  it('counts each blank line of the text, including whitespace-only lines', () => {
    expect(countExplicitEmptyLines('one\n\ntwo\n  \nthree')).toBe(2);
    expect(countExplicitEmptyLines('one\r\ntwo')).toBe(0);
  });

  it('adds at least the font size plus 3 px per blank line', () => {
    expect(getExtraLineStep(36)).toBe(40);
    expect(getExtraLineStep(60)).toBe(66);
  });
});
