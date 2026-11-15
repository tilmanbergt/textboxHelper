import {paginateTextboxBlocksIntoPages} from '../../src/domain/blockPagination';
import {splitLargeTextBlock, type MeasureTextboxHeight} from '../../src/domain/paginationCore';
import {paginateTextIntoTextboxPages} from '../../src/domain/textPagination';

/** A fake measurement: one pixel per character, so a 100 px page holds 100 characters. */
const measureByLength: MeasureTextboxHeight = async text => text.length;
const PAGE = {left: 100, top: 200, right: 700, bottom: 300};

describe('pagination with a passed-in measurement', () => {
  it('splits a long block at sentence ends, else into chunks of at most 900 characters', () => {
    expect(splitLargeTextBlock('One.  Two!\nThree?')).toEqual(['One.', 'Two!', 'Three?']);
    const words = splitLargeTextBlock(`${'word '.repeat(300)}`.trim());
    expect(words.length).toBe(2);
    expect(words[0].length).toBeLessThanOrEqual(900);
  });

  it('collects paragraphs on a page while they fit, and starts a new page when not', async () => {
    const text = `${'a'.repeat(40)}\n\n${'b'.repeat(40)}\n\n${'c'.repeat(40)}`;
    const chunks = await paginateTextIntoTextboxPages({
      text,
      maxRect: PAGE,
      fontSize: 36,
      measureHeight: measureByLength,
    });
    expect(chunks.map(chunk => chunk.text)).toEqual([`${'a'.repeat(40)}\n\n${'b'.repeat(40)}`, 'c'.repeat(40)]);
    expect(chunks[0].rect).toEqual({left: 100, top: 200, right: 700, bottom: 282});
    expect(chunks[1].rect).toEqual({left: 100, top: 200, right: 700, bottom: 248});
  });

  it('passes width, font and the blank-line flag to the measurement', async () => {
    const calls: unknown[][] = [];
    const recordingMeasure: MeasureTextboxHeight = async (...args) => {
      calls.push(args);
      return 10;
    };
    await paginateTextIntoTextboxPages({
      text: 'short',
      maxRect: PAGE,
      fontSize: 40,
      fontPath: '/fonts/x.ttf',
      addExplicitEmptyLineHeight: false,
      measureHeight: recordingMeasure,
    });
    expect(calls[0]).toEqual(['short', 600, 40, '/fonts/x.ttf', false]);
  });

  it('stacks blocks with a gap and moves a block that no longer fits to the next page', async () => {
    const pages = await paginateTextboxBlocksIntoPages({
      blocks: [
        {role: 'heading1', text: 'h'.repeat(50), fontSize: 60, bold: true},
        {role: 'paragraph', text: 'p'.repeat(60), fontSize: 36, bold: false},
      ],
      maxRect: PAGE,
      measureHeight: measureByLength,
    });
    expect(pages.length).toBe(2);
    expect(pages[0].chunks[0]).toMatchObject({fontSize: 60, bold: true, rect: {top: 200, bottom: 250}});
    expect(pages[1].chunks[0]).toMatchObject({fontSize: 36, bold: false, rect: {top: 200, bottom: 260}});
  });
});
