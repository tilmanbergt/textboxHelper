import {
  buildInsertPages,
  buildPreviewText,
  countCreatedPages,
  getRecommendedInsertMode,
  normalizeImportedText,
  pageHasContentInImportArea,
  resolveEffectiveInsertMode,
  wrapContinuousChunks,
} from '../../src/domain/importPlan';
import type {PageElementData, Rect} from '../../src/domain/textboxModel';

const rect = (left: number, top: number, right: number, bottom: number): Rect => ({left, top, right, bottom});
const picture = (pictureRect: Rect, layerNum = 0): PageElementData => ({
  uuid: 'p',
  type: 200,
  layerNum,
  numInPage: 1,
  textBox: null,
  title: null,
  link: null,
  picture: {rect: pictureRect},
  geometry: null,
});

describe('import text', () => {
  it('drops the BOM, unifies line ends, trims line ends and keeps at most two blank lines', () => {
    expect(normalizeImportedText('﻿  Title  \r\n\r\n\r\n\r\n\r\nBody \t\nEnd  ')).toBe('Title\n\n\nBody\nEnd');
  });

  it('previews the first or last five lines', () => {
    const text = ['1', '2', '3', '4', '5', '6', '7'].join('\n');
    expect(buildPreviewText(text, true)).toBe('1\n2\n3\n4\n5\n…');
    expect(buildPreviewText(text, false)).toBe('…\n3\n4\n5\n6\n7');
    expect(buildPreviewText('short', true)).toBe('short');
  });
});

describe('import plan', () => {
  it('recommends a new page when the import area already has content on the main layer', () => {
    const area = rect(100, 100, 1300, 1700);
    expect(pageHasContentInImportArea([picture(rect(200, 200, 300, 300))], area)).toBe(true);
    expect(pageHasContentInImportArea([picture(rect(200, 200, 300, 300), 1)], area)).toBe(false);
    expect(pageHasContentInImportArea([picture(rect(0, 0, 50, 50))], area)).toBe(false);
    expect(getRecommendedInsertMode(true)).toBe('afterCurrentPage');
    expect(getRecommendedInsertMode(false)).toBe('currentPage');
  });

  it('uses the recommendation only for "auto"', () => {
    expect(resolveEffectiveInsertMode({selectedInsertMode: 'auto', recommendedInsertMode: 'afterCurrentPage'})).toBe('afterCurrentPage');
    expect(resolveEffectiveInsertMode({selectedInsertMode: 'currentPage', recommendedInsertMode: 'afterCurrentPage'})).toBe('currentPage');
  });

  it('counts the pages that will be created', () => {
    expect(countCreatedPages({plannedPageCount: 3, effectiveInsertMode: 'currentPage'})).toBe(2);
    expect(countCreatedPages({plannedPageCount: 3, effectiveInsertMode: 'afterCurrentPage'})).toBe(3);
  });

  it('numbers the pages and marks where a new page starts', () => {
    const pages = wrapContinuousChunks({
      chunks: [
        {text: 'one', rect: rect(0, 0, 10, 10)},
        {text: 'two', rect: rect(0, 0, 10, 10)},
      ],
      fontSize: 36,
    });
    const onCurrent = buildInsertPages({pages, currentPage: 4, effectiveInsertMode: 'currentPage'});
    expect(onCurrent.map(item => [item.pageNumber, item.text, item.createPage])).toEqual([
      [4, 'one', false],
      [5, 'two', true],
    ]);
    const after = buildInsertPages({pages, currentPage: 4, effectiveInsertMode: 'afterCurrentPage'});
    expect(after.map(item => [item.pageNumber, item.createPage])).toEqual([
      [5, true],
      [6, true],
    ]);
  });
});
