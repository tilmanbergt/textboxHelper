import {headingLevelOf, headingTitleOf, withHeadingLevel} from '../../src/domain/headingText';

describe('heading text', () => {
  it('reads the level from the leading #s, as Obsidian does', () => {
    expect(headingLevelOf('# Title')).toBe(1);
    expect(headingLevelOf('## Methods')).toBe(2);
    expect(headingLevelOf('###\tTabbed')).toBe(3);
    expect(headingLevelOf('###### Deep')).toBe(3);
    expect(headingLevelOf('#tag is a tag')).toBe(0);
    expect(headingLevelOf('####### seven')).toBe(0);
    expect(headingLevelOf('#')).toBe(0);
    expect(headingLevelOf('## ')).toBe(0);
    expect(headingLevelOf('Plain text')).toBe(0);
  });

  it('gives the title without its #s, and the text itself without', () => {
    expect(headingTitleOf('## Methods and  tools')).toBe('Methods and  tools');
    expect(headingTitleOf('Plain')).toBe('Plain');
  });

  it('rewrites the #s and keeps the title byte for byte', () => {
    expect(withHeadingLevel('Methods', 2)).toBe('## Methods');
    expect(withHeadingLevel('### Methods', 1)).toBe('# Methods');
    expect(withHeadingLevel('# Methods, again', 0)).toBe('Methods, again');
    expect(withHeadingLevel('###### Deep', 2)).toBe('## Deep');
  });
});
