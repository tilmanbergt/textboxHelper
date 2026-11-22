import {DEFAULT_PAGE_LAYOUT, marginsSummary, startsPage, textArea} from '../../src/domain/pageLayout';

describe('page layout', () => {
  const page = {width: 1404, height: 1872};

  it('leaves a fifth on the right and a third at the bottom by default', () => {
    expect(textArea(page, DEFAULT_PAGE_LAYOUT)).toEqual({left: 100, top: 100, right: 1124, bottom: 1247});
    expect(marginsSummary(DEFAULT_PAGE_LAYOUT)).toBe('Margins 100 · 100 · 280 · 625');
  });

  it('refuses margins that leave no room', () => {
    const layout = {...DEFAULT_PAGE_LAYOUT, margins: {left: 800, top: 100, right: 700, bottom: 100}};
    expect(() => textArea(page, layout)).toThrow('no room');
  });

  it('starts a page for every file and for the chosen heading levels', () => {
    const layout = {...DEFAULT_PAGE_LAYOUT, breakBefore: [1 as const]};
    expect(startsPage({kind: 'file', level: null}, DEFAULT_PAGE_LAYOUT)).toBe(true);
    expect(startsPage({kind: 'heading', level: 1}, DEFAULT_PAGE_LAYOUT)).toBe(false);
    expect(startsPage({kind: 'heading', level: 1}, layout)).toBe(true);
    expect(startsPage({kind: 'heading', level: 2}, layout)).toBe(false);
    expect(startsPage({kind: 'paragraph', level: null}, layout)).toBe(false);
  });
});
