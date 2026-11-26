import {
  indentAfterBreak,
  joinPieces,
  restoreWhitespace,
  sameWords,
  sentenceUnits,
  wordUnits,
} from '../../src/domain/textWhitespace';

const LIST = '- one. Two?\n  - nested item\n- three';

describe('cut units', () => {
  it('cuts at line breaks and sentence ends, and joins back to the text', () => {
    const units = sentenceUnits(LIST);
    expect(units.map(unit => unit.text)).toEqual(['- one.', 'Two?', '- nested item', '- three']);
    expect(units.map(unit => unit.before)).toEqual(['', ' ', '\n  ', '\n']);
    expect(units.map(unit => `${unit.before}${unit.text}`).join('')).toBe(LIST);
  });

  it('cuts a unit between its words and reads CRLF as a line break', () => {
    expect(wordUnits('a  b\tc')).toEqual([
      {before: '', text: 'a'},
      {before: '  ', text: 'b'},
      {before: '\t', text: 'c'},
    ]);
    expect(sentenceUnits('a\r\nb').map(unit => unit.before)).toEqual(['', '\n']);
    expect(sentenceUnits('   ')).toEqual([]);
  });

  it('keeps the indentation of the line after a break', () => {
    expect(indentAfterBreak('\n  ')).toBe('  ');
    expect(indentAfterBreak(' ')).toBe('');
  });
});

describe('joining pieces', () => {
  it('starts a list item on a new line and joins anything else with a space', () => {
    expect(joinPieces(['- a', '- b', 'tail', '  1. c'])).toBe('- a\n- b tail\n  1. c');
    expect(joinPieces([])).toBe('');
  });
});

describe('restoring whitespace', () => {
  it('gives flattened text its line breaks and indentation back', () => {
    expect(restoreWhitespace(LIST, LIST.replace(/\s+/g, ' '))).toBe(LIST);
  });

  it('keeps the line breaks next to an edit', () => {
    expect(restoreWhitespace(LIST, '- one. Three? - nested item - three')).toBe('- one. Three?\n  - nested item\n- three');
    expect(restoreWhitespace(LIST, '- one. Two? - nested - three')).toBe('- one. Two?\n  - nested\n- three');
  });

  it('keeps whitespace the user typed and new words as they are', () => {
    expect(restoreWhitespace('alpha beta', 'alpha\nbeta')).toBe('alpha\nbeta');
    expect(restoreWhitespace('a\nb', 'x y')).toBe('x y');
    expect(restoreWhitespace('a\nb', '')).toBe('');
  });

  it('restores only the common start and end of texts too long to compare word by word', () => {
    const many = Array.from({length: 1200}, (_, index) => `w${index}`);
    const original = many.join('\n');
    const edited = [...many.slice(0, 10), ...many.slice(10, 1190).map(word => `${word}x`), ...many.slice(1190)].join(' ');
    const restored = restoreWhitespace(original, edited);
    expect(restored.startsWith(many.slice(0, 10).join('\n'))).toBe(true);
    expect(restored.endsWith(many.slice(1190).join('\n'))).toBe(true);
  });

  it('compares words whatever the whitespace', () => {
    expect(sameWords('a\n b', 'a b')).toBe(true);
    expect(sameWords('a b', 'a c')).toBe(false);
  });
});
