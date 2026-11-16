import {
  lineRanges,
  pageIndexForChar,
  pageRanges,
  segmentsText,
  sliceSegments,
  type TextSegment,
} from '../../src/domain/textPages';
import {helpTextToSegments} from '../../src/domain/helpTexts';

const line = (text: string, height = 20) => ({text, height});

describe('lineRanges', () => {
  it('turns measured lines into character ranges', () => {
    expect(lineRanges([line('one '), line('two '), line('three')], 13)).toEqual([
      {start: 0, end: 4, height: 20},
      {start: 4, end: 8, height: 20},
      {start: 8, end: 13, height: 20},
    ]);
  });

  it('adds missing trailing characters to the last line', () => {
    expect(lineRanges([line('one '), line('two')], 9)).toEqual([
      {start: 0, end: 4, height: 20},
      {start: 4, end: 9, height: 20},
    ]);
  });

  it('cuts ranges that run past the text', () => {
    expect(lineRanges([line('one '), line('two\n')], 7)).toEqual([
      {start: 0, end: 4, height: 20},
      {start: 4, end: 7, height: 20},
    ]);
  });
});

describe('pageRanges', () => {
  const lines = lineRanges([line('aa '), line('bb '), line('cc '), line('dd '), line('ee')], 14);

  it('fits as many whole lines as the height allows', () => {
    expect(pageRanges(lines, 50)).toEqual([
      {start: 0, end: 6, firstLine: 0, lineCount: 2},
      {start: 6, end: 12, firstLine: 2, lineCount: 2},
      {start: 12, end: 14, firstLine: 4, lineCount: 1},
    ]);
  });

  it('puts at least one line on a page that is too small', () => {
    expect(pageRanges(lines, 5)).toHaveLength(5);
  });

  it('gives no pages for no lines', () => {
    expect(pageRanges([], 100)).toEqual([]);
  });

  it('finds the page that holds a character', () => {
    const pages = pageRanges(lines, 50);
    expect(pageIndexForChar(pages, 0)).toBe(0);
    expect(pageIndexForChar(pages, 6)).toBe(1);
    expect(pageIndexForChar(pages, 13)).toBe(2);
    expect(pageIndexForChar(pages, 99)).toBe(2);
    expect(pageIndexForChar([], 3)).toBe(0);
  });
});

describe('sliceSegments', () => {
  const segments: TextSegment[] = [
    {text: 'keep '},
    {text: 'gone', style: 'removed'},
    {text: 'new', style: 'inserted'},
    {text: ' end'},
  ];

  it('cuts styled segments to a range', () => {
    expect(sliceSegments(segments, 3, 11)).toEqual([
      {text: 'p '},
      {text: 'gone', style: 'removed'},
      {text: 'ne', style: 'inserted'},
    ]);
  });

  it('keeps the whole text over all pages', () => {
    const text = segmentsText(segments);
    const parts = [sliceSegments(segments, 0, 7), sliceSegments(segments, 7, text.length)];
    expect(parts.map(segmentsText).join('')).toBe(text);
  });
});

describe('helpTextToSegments', () => {
  it('marks "## " lines as headings and keeps line breaks', () => {
    expect(helpTextToSegments('## Title\nBody one\n\nBody two')).toEqual([
      {text: 'Title\n', style: 'heading'},
      {text: 'Body one\n\nBody two'},
    ]);
  });
});
