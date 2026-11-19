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
