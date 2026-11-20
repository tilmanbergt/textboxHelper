import {MARK_HELP, MARK_HELP_KEYS, REVIEW_HELP} from '../../src/domain/markHelp';
import {
  MARK_HELP_LAYOUT as L,
  entryTextHeight,
  estimateLines,
  markHelpPages,
  overviewKeysHeight,
  pageOfMark,
  type MarkHelpPage,
} from '../../src/domain/markHelpPages';

const KEYS = [MARK_HELP_KEYS.text, MARK_HELP_KEYS.numbers];
// Pictures as on an A5 X: 480 dp wide, heights in the pictures' proportions.
const PICTURES = Object.fromEntries(
  MARK_HELP.map((entry, index) => [entry.id, {width: 480, height: [168, 212, 212, 183, 168, 220, 352, 371][index]}]),
);

function pageHeight(page: MarkHelpPage, width: number): number {
  if (page.kind === 'overview') {
    return L.headingHeight + page.ids.length * L.rowHeight + overviewKeysHeight(KEYS, width);
  }
  if (page.kind === 'marks') {
    return (
      L.headingHeight +
      page.entries.reduce((sum, placed, index) => {
        const entry = MARK_HELP.find(e => e.id === placed.id)!;
        return sum + (index > 0 ? L.sectionGap : 0) + L.titleHeight + 2 * L.gap + placed.picture.height + entryTextHeight(entry, width);
      }, 0)
    );
  }
  return (
    L.headingHeight +
    page.blocks.reduce(
      (sum, block, index) => sum + (index > 0 ? L.sectionGap : 0) + L.titleHeight + estimateLines(block.text, width) * L.lineHeight,
      0,
    )
  );
}

describe('estimateLines', () => {
  it('counts one line for short text and wraps long text', () => {
    expect(estimateLines('short', 400)).toBe(1);
    expect(estimateLines('word '.repeat(100), 400)).toBeGreaterThan(5);
  });

  it('breaks a word longer than a line', () => {
    expect(estimateLines('x'.repeat(200), 165)).toBeGreaterThanOrEqual(10);
  });
});

describe('markHelpPages', () => {
  it('A5 X portrait: one overview, the marks on few pages, then the review', () => {
    const pages = markHelpPages(MARK_HELP, REVIEW_HELP, KEYS, PICTURES, 654, 760);
    expect(pages[0]).toEqual({kind: 'overview', ids: MARK_HELP.map(e => e.id), first: true});
    const markPages = pages.filter(p => p.kind === 'marks');
    expect(markPages.length).toBeLessThanOrEqual(6);
    expect(markPages.some(p => p.kind === 'marks' && p.entries.length === 2)).toBe(true);
    expect(pages[pages.length - 1].kind).toBe('text');
  });

  it('every mark appears exactly once, in order', () => {
    const pages = markHelpPages(MARK_HELP, REVIEW_HELP, KEYS, PICTURES, 654, 760);
    const ids = pages.flatMap(p => (p.kind === 'marks' ? p.entries.map(e => e.id) : []));
    expect(ids).toEqual(MARK_HELP.map(e => e.id));
    const blocks = pages.flatMap(p => (p.kind === 'text' ? p.blocks.map(b => b.title) : []));
    expect(blocks).toEqual(REVIEW_HELP.map(b => b.title));
  });

  it.each([
    [654, 760],
    [888, 450],
    [400, 600],
  ])('no page is taller than the box (%i x %i)', (width, height) => {
    const pages = markHelpPages(MARK_HELP, REVIEW_HELP, KEYS, PICTURES, width, height);
    for (const page of pages) {
      if (page.kind === 'marks' && page.entries.length === 1) {
        // A lone mark may only overflow when its picture is already at the smallest size.
        const fits = pageHeight(page, width) <= height || page.entries[0].picture.height <= L.minPictureHeight;
        expect(fits).toBe(true);
      } else if (page.kind !== 'text' || page.blocks.length > 1) {
        expect(pageHeight(page, width)).toBeLessThanOrEqual(height);
      }
    }
  });

  it('a low box (landscape) splits the overview and shrinks a tall picture', () => {
    const pages = markHelpPages(MARK_HELP, REVIEW_HELP, KEYS, PICTURES, 888, 450);
    const overviews = pages.filter(p => p.kind === 'overview');
    expect(overviews.length).toBeGreaterThan(1);
    expect(overviews[1]).toMatchObject({first: false});
    const insertParagraph = pages.flatMap(p => (p.kind === 'marks' ? p.entries : [])).find(e => e.id === 'insert-paragraph')!;
    expect(insertParagraph.picture.height).toBeLessThan(371);
    expect(insertParagraph.picture.width / insertParagraph.picture.height).toBeCloseTo(480 / 371, 1);
  });

  it('pageOfMark finds the page with the picture, -1 for none', () => {
    const pages = markHelpPages(MARK_HELP, REVIEW_HELP, KEYS, PICTURES, 654, 760);
    const page = pageOfMark(pages, 'swap');
    expect(page).toBeGreaterThan(0);
    expect(pages[page]).toMatchObject({kind: 'marks'});
    expect(pageOfMark(pages, 'nothing')).toBe(-1);
  });
});
