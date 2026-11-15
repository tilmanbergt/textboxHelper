import {
  buildStyleSignature,
  classifyTextRole,
  compareByReadingOrder,
  getIncludedRoleCounts,
  getIncludedScanItems,
  summarizeExcludedStyles,
  type ScanSummary,
  type ScannedTextBox,
} from '../../src/domain/exportClassification';
import {DEFAULT_EXPORT_CLASSIFICATION_CONFIG as CONFIG} from '../../src/domain/exportConfig';

const style = {bold: false, italic: false, border: false};

describe('export classification', () => {
  it('classifies by font size and italics with the default rules', () => {
    const role = (fontSize: number, italic = false, isInsideTitleRect = false) =>
      classifyTextRole({...style, fontSize, italic, isInsideTitleRect, config: CONFIG});
    expect(role(48)).toBe('heading');
    expect(role(36)).toBe('paragraph');
    expect(role(36, true)).toBe('comment');
    expect(role(20)).toBe('meta');
    expect(role(10)).toBe('unknown');
    expect(role(36, false, true)).toBe('heading');
    expect(classifyTextRole({...style, fontSize: 36, isInsideTitleRect: true, config: {...CONFIG, treatTitleTextBoxesAsHeadings: false}})).toBe(
      'paragraph',
    );
  });

  it('describes a style in one line', () => {
    expect(buildStyleSignature({fontSize: 36, bold: true, italic: false, border: true})).toBe('36 / bold / upright / border');
  });

  const item = (page: number, top: number, role: ScannedTextBox['role'], styleSignature = 'x'): ScannedTextBox =>
    ({page, role, styleSignature, rect: {left: 0, top, right: 10, bottom: top + 10}}) as ScannedTextBox;

  it('orders by page, then top, then left', () => {
    const sorted = [item(2, 0, 'paragraph'), item(1, 50, 'paragraph'), item(1, 10, 'heading')].sort(compareByReadingOrder);
    expect(sorted.map(entry => [entry.page, entry.rect?.top])).toEqual([
      [1, 10],
      [1, 50],
      [2, 0],
    ]);
  });

  it('exports headings and paragraphs, comments only when asked, and summarizes the rest by style', () => {
    const scan = {
      items: [item(1, 0, 'heading'), item(1, 10, 'comment'), item(1, 20, 'meta', 'small'), item(1, 30, 'meta', 'small')],
      counts: {heading: 1, paragraph: 0, comment: 1, meta: 2, unknown: 0},
    } as unknown as ScanSummary;
    expect(getIncludedScanItems(scan, false).map(entry => entry.role)).toEqual(['heading']);
    expect(getIncludedScanItems(scan, true).map(entry => entry.role)).toEqual(['heading', 'comment']);
    expect(getIncludedRoleCounts(scan, false)).toEqual({heading: 1, paragraph: 0, comment: 0});
    expect(summarizeExcludedStyles(scan, true)).toEqual([{styleSignature: 'small', count: 2}]);
  });
});
