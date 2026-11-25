import {buildDiffSegments} from '../../src/domain/markerDiff';
import {fileNameOf, userMessage} from '../../src/domain/userMessage';
import {plural} from '../../src/domain/plural';

const del = (start: number, end: number) => ({kind: 'delete' as const, start, end});
const rep = (start: number, end: number, replacementText: string) => ({
  kind: 'replace' as const,
  start,
  end,
  replacementText,
});

describe('buildDiffSegments', () => {
  const text = 'lasso a few words to make a todo';

  it('strikes through a delete in the middle', () => {
    expect(buildDiffSegments(text, [del(8, 25)])).toEqual([
      {text: 'lasso a '},
      {text: 'few words to make', style: 'removed'},
      {text: ' a todo'},
    ]);
  });

  it('handles deletes at the start and the end', () => {
    expect(buildDiffSegments(text, [del(0, 5), del(28, 32)])).toEqual([
      {text: 'lasso', style: 'removed'},
      {text: ' a few words to make a '},
      {text: 'todo', style: 'removed'},
    ]);
  });

  it('shows two deletes in one line in order, whatever order they come in', () => {
    expect(buildDiffSegments(text, [del(12, 17), del(6, 7)])).toEqual([
      {text: 'lasso '},
      {text: 'a', style: 'removed'},
      {text: ' few '},
      {text: 'words', style: 'removed'},
      {text: ' to make a todo'},
    ]);
  });

  it('adds the replacement in bold after the removed words', () => {
    expect(buildDiffSegments(text, [rep(8, 17, 'some')])).toEqual([
      {text: 'lasso a '},
      {text: 'few words', style: 'removed'},
      {text: ' some', style: 'inserted'},
      {text: ' to make a todo'},
    ]);
  });

  it('shows duplicate and overlapping ranges once', () => {
    expect(buildDiffSegments(text, [del(8, 17), del(8, 17), del(12, 20)])).toEqual([
      {text: 'lasso a '},
      {text: 'few words to', style: 'removed'},
      {text: ' make a todo'},
    ]);
  });

  it('keeps the text unchanged without ranges and drops an empty replacement', () => {
    expect(buildDiffSegments(text, [])).toEqual([{text}]);
    expect(buildDiffSegments(text, [rep(0, 6, '')])).toEqual([
      {text: 'lasso ', style: 'removed'},
      {text: 'a few words to make a todo'},
    ]);
  });
});

describe('plural, userMessage, fileNameOf', () => {
  it('counts nouns', () => {
    expect(plural(1, 'change')).toBe('1 change');
    expect(plural(4, 'change')).toBe('4 changes');
    expect(plural(2, 'textbox', 'textboxes')).toBe('2 textboxes');
  });

  it('keeps our own sentences and replaces everything else', () => {
    expect(userMessage(new Error('The file is empty.'), 'fallback')).toBe('The file is empty.');
    expect(userMessage(new Error('Error: Nope.'), 'fallback')).toBe('Nope.');
    expect(userMessage(new Error(''), 'fallback')).toBe('fallback');
    expect(userMessage(new Error('a\n at x'), 'fallback')).toBe('fallback');
    expect(userMessage('string', 'fallback')).toBe('fallback');
  });

  it('takes the file name of a path', () => {
    expect(fileNameOf('/data/plugins/x/backups/page-3.json')).toBe('page-3.json');
  });
});

describe('buildParagraphResult (technical-design-mark-dialogue.md §5.5)', () => {
  const {buildParagraphResult, focusResult} = require('../../src/domain/markerDiff') as typeof import('../../src/domain/markerDiff');
  const buildResultSegments = (original: string, ranges: Parameters<typeof buildParagraphResult>[1]) =>
    buildParagraphResult(original, ranges).segments.map(({op: _op, ...segment}) => segment);
  const {applyTextMutationRanges} = require('../../src/domain/markerText') as typeof import('../../src/domain/markerText');
  const plain = (segments: Array<{text: string}>) => segments.map(segment => segment.text).join('');
  const text = 'lasso a few words to make a todo';

  it('leaves removed text out and shows new text bold', () => {
    expect(buildResultSegments(text, [del(8, 26), rep(28, 32, 'list')])).toEqual([
      {text: 'lasso a a '},
      {text: 'list', style: 'inserted'},
    ]);
  });

  it('shows a pen edit not recognized yet muted', () => {
    expect(buildResultSegments('the big car', [{...rep(4, 7, '‹replacement 2›'), pending: true}])).toEqual([
      {text: 'the '},
      {text: '‹replacement 2›', style: 'muted'},
      {text: ' car'},
    ]);
  });

  it.each([
    ['a delete in the middle', text, [del(8, 25)]],
    ['deletes at both ends', text, [del(0, 5), del(28, 32)]],
    ['a replace and a delete', 'The quick brown fox jumps.', [del(4, 10), rep(16, 19, 'cat')]],
    ['exact ranges keep one space', 'the big red car', [{kind: 'replace' as const, start: 4, end: 8, replacementText: 'small'}]],
    ['a delete before a full stop', 'the car today.', [del(8, 13)]],
    ['a close-up joins', 'note book', [{kind: 'replace' as const, start: 4, end: 5, replacementText: '', joins: true}]],
    ['an insertion at a gap', 'the big car', [rep(8, 8, 'red ')]],
    ['letters inside a word', 'bigger', [rep(4, 6, 'st')]],
  ])('%s: its text is the apply step\'s text', (_name, original, ranges) => {
    expect(plain(buildResultSegments(original, ranges))).toBe(applyTextMutationRanges(original, ranges));
  });

  it('knows where each change is in the text after it', () => {
    const result = buildParagraphResult(text, [{...del(6, 8), opId: 'a'}, {...rep(28, 32, 'list'), opId: 'b'}]);
    expect(plain(result.segments)).toBe('lasso few words to make a list');
    expect(result.at).toEqual({a: 6, b: 26});
  });

  it('brings the selected change forward: its new text underlined', () => {
    const result = buildParagraphResult('the big car', [{...rep(4, 7, 'red'), opId: 'a'}]);
    expect(focusResult(result, 'a')).toEqual({segments: [{text: 'the '}, {text: 'red', style: 'focus'}, {text: ' car'}], at: 4});
  });

  it('underlines the word where removed letters were, or the space where a word was', () => {
    const letters = buildParagraphResult('a kindness of', [{...del(6, 10), opId: 'a'}]);
    expect(focusResult(letters, 'a').segments).toEqual([{text: 'a '}, {text: 'kind', style: 'focusPlain'}, {text: ' of'}]);
    const word = buildParagraphResult('the big red car', [{...del(4, 8), opId: 'a'}]);
    expect(focusResult(word, 'a')).toEqual({segments: [{text: 'the'}, {text: ' ', style: 'focusPlain'}, {text: 'red car'}], at: 4});
  });
});
