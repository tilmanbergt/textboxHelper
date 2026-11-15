import {
  cleanupTextboxWhitespace,
  countWords,
  normalizeJoinBoundary,
  removeLineBreaks,
  splitIntoParagraphCandidates,
  splitIntoSentenceCandidates,
} from '../../src/domain/textSplitting';

describe('sentence splitting', () => {
  it('keeps abbreviations, decimal numbers and "e.g." inside a sentence', () => {
    expect(
      splitIntoSentenceCandidates(
        'Dr. Smith met Mr. Jones at 3.5 p.m. today. They talked e.g. about the weather! Did it rain? Yes.',
      ),
    ).toEqual([
      'Dr. Smith met Mr. Jones at 3.5 p.m. today.',
      'They talked e.g. about the weather!',
      // "Yes." has fewer than two real words, so it joins the sentence before it.
      'Did it rain? Yes.',
    ]);
  });

  it('carries fragments with fewer than two real words into the next sentence', () => {
    expect(splitIntoSentenceCandidates('Ok. This is a real sentence. Hi. Another full sentence here.')).toEqual([
      'Ok. This is a real sentence.',
      'Hi. Another full sentence here.',
    ]);
  });

  it('splits at line breaks, at "!"/"?" always, and at "." only before an upper-case letter or digit', () => {
    expect(
      splitIntoSentenceCandidates('First line without end\nSecond line. Third sentence here.\n\nNew paragraph starts.'),
    ).toEqual(['First line without end', 'Second line.', 'Third sentence here.', 'New paragraph starts.']);
    expect(splitIntoSentenceCandidates('this ends. lowercase follows here. And Upper.')).toEqual([
      'this ends. lowercase follows here.',
      'And Upper.',
    ]);
    expect(splitIntoSentenceCandidates('  \n ')).toEqual([]);
  });

  it('known issue: a closing quote or bracket after the sentence end starts the next sentence', () => {
    expect(splitIntoSentenceCandidates('He said "Stop." Then he left. (It was late.) We stayed... until dawn.')).toEqual([
      'He said "Stop.',
      '" Then he left. (It was late.',
      ') We stayed... until dawn.',
    ]);
  });
});

describe('paragraph splitting', () => {
  it('splits at blank lines, and at a single line break once the paragraph has two sentences', () => {
    expect(
      splitIntoParagraphCandidates(
        'One sentence only\ncontinues here.\nNext one. And more.\nTail line\n\nBlock two.\nStill two.',
      ),
    ).toEqual(['One sentence only continues here. Next one. And more.', 'Tail line', 'Block two. Still two.']);
  });
});

describe('whitespace', () => {
  it('cleans spaces before punctuation and inside brackets, keeps at most one blank line', () => {
    expect(cleanupTextboxWhitespace('  Hello ,  world ( yes ) !\t\tTabs here .\r\n\r\n\r\n\r\nEnd  ')).toBe(
      'Hello, world (yes)! Tabs here.\n\nEnd',
    );
  });

  it('removes line breaks and collapses the spaces around them', () => {
    expect(removeLineBreaks('line one\n  line two\r\nline three  ')).toBe('line one line two line three');
  });

  it('counts words separated by any whitespace', () => {
    expect(countWords(' a  b\nc ')).toBe(3);
    expect(countWords('')).toBe(0);
  });
});

describe('join boundaries', () => {
  it.each([
    ['Hello.', 'World', 'Hello. World'],
    ['Hello', 'world', 'Hello world'],
    ['foo-', 'bar', 'foo-bar'],
    ['Hello ', 'world', 'Hello world'],
    ['', 'x', 'x'],
    ['x  ', '  ', 'x'],
    ['(a', ')', '(a )'],
  ])('joins %j and %j as %j', (previous, next, expected) => {
    expect(normalizeJoinBoundary(previous, next)).toBe(expected);
  });
});
