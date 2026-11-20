import {PluginFileAPI} from 'sn-plugin-lib';
import {
  buildStyleSignature,
  classifyTextRole,
  compareByReadingOrder,
  rectContainsPoint,
  type ExportScope,
  type ScanSummary,
  type ScannedTextBox,
  type TextRole,
} from '../domain/exportClassification';
import type {ExportClassificationConfig} from '../domain/exportConfig';
import {isPenEditNumberElement} from '../domain/textboxEditPlan';
import type {PageElementData, Rect} from '../domain/textboxModel';
import {assertApiSuccess, tryApiResult} from '../supernote/sdkResult';
import {timed} from '../utils/perf';

/**
 * The textbox scan behind "Export DOCX" and the Manuscript Outline: which pages to read, and every
 * textbox on them with its role and style. Reads the note only; the classification is in
 * `src/domain/exportClassification.ts`.
 */

type RawElement = {
  type?: number;
  numInPage?: number;
  userData?: string | null;
  textBox?: {
    textContentFull?: string | null;
    textRect?: Rect | null;
    fontSize?: number | null;
    textBold?: number | null;
    textItalics?: number | null;
    textFrameStyle?: number | null;
  } | null;
};

type RawTitle = {
  X?: number;
  Y?: number;
  width?: number;
  height?: number;
};

type ScanParams = {
  notePath: string;
  currentPage: number | null;
  totalPages?: number | null;
  scope: ExportScope;
  config: ExportClassificationConfig;
  pageRangeStart?: number | null;
  pageRangeEnd?: number | null;
};

async function resolvePagesToScan(params: ScanParams): Promise<number[]> {
  const {
    notePath,
    currentPage,
    scope,
    pageRangeStart,
    pageRangeEnd,
  } = params;

  let totalPages = params.totalPages ?? null;

  if (totalPages === null) {
    totalPages = assertApiSuccess<number>(
      await PluginFileAPI.getNoteTotalPageNum(notePath),
      'Could not determine the note page count.',
    );
  }

  if (totalPages <= 0) {
    throw new Error('The note does not contain any pages.');
  }

  if (scope === 'currentPage') {
    if (currentPage === null || currentPage < 0) {
      throw new Error('Could not determine the current page.');
    }

    return [currentPage];
  }

  if (scope === 'wholeNote') {
    return Array.from({length: totalPages}, (_, index) => index);
  }

  if (
    pageRangeStart === null ||
    pageRangeStart === undefined ||
    pageRangeEnd === null ||
    pageRangeEnd === undefined
  ) {
    throw new Error('Please enter both page range values.');
  }

  if (pageRangeStart < 1 || pageRangeEnd < 1) {
    throw new Error('Page ranges are 1-based and must be at least 1.');
  }

  if (pageRangeStart > pageRangeEnd) {
    throw new Error('The page range start cannot be greater than the end.');
  }

  if (pageRangeEnd > totalPages) {
    throw new Error(`The note only has ${totalPages} pages.`);
  }

  return Array.from(
    {length: pageRangeEnd - pageRangeStart + 1},
    (_, index) => pageRangeStart - 1 + index,
  );
}

export async function scanTextBoxes(params: ScanParams): Promise<ScanSummary> {
  const pages = await resolvePagesToScan(params);
  const items: ScannedTextBox[] = [];
  const useTitleRectHeadings = params.config.treatTitleTextBoxesAsHeadings;

  for (const page of pages) {
    let titles: RawTitle[] = [];
    if (useTitleRectHeadings) {
      const titleResult = tryApiResult<RawTitle[]>(
        await timed('scan.titles', () => PluginFileAPI.getTitles(params.notePath, [page]), {page}),
      );

      if (titleResult === null) {
        console.log(
          '[DocxExport] titleAreas:unavailable',
          JSON.stringify({page: page + 1}),
        );
      } else {
        titles = titleResult;
      }
    }

    const elements =
      assertApiSuccess<RawElement[]>(
      await timed('scan.getElements', () => PluginFileAPI.getElements(page, params.notePath), {page}),
      `Could not read elements from page ${page + 1}.`,
      ) ?? [];

    for (const element of elements) {
      // Pen-edit numbers are marks on the page, not text (technical-design-pen-edits.md §3.2).
      if (isPenEditNumberElement(element as PageElementData)) {
        continue;
      }
      const rawTextBox = element.textBox;
      const text = rawTextBox?.textContentFull?.trim() ?? '';
      if (!text) {
        continue;
      }

      const fontSize = Number(rawTextBox?.fontSize ?? 0);
      const bold = (rawTextBox?.textBold ?? 0) === 1;
      const italic = (rawTextBox?.textItalics ?? 0) === 1;
      const border = Number(rawTextBox?.textFrameStyle ?? 0) !== 0;
      const rect = rawTextBox?.textRect ?? null;
      const center = rect
        ? {
            x: (rect.left + rect.right) / 2,
            y: (rect.top + rect.bottom) / 2,
          }
        : null;
      const isInsideTitleRect =
        center !== null &&
        titles.some(title => {
          const width = Number(title.width ?? 0);
          const height = Number(title.height ?? 0);
          if (width <= 0 || height <= 0) {
            return false;
          }

          return rectContainsPoint(
            {
              left: Number(title.X ?? 0),
              top: Number(title.Y ?? 0),
              right: Number(title.X ?? 0) + width,
              bottom: Number(title.Y ?? 0) + height,
            },
            center,
          );
        });

      items.push({
        page,
        numInPage: Number(element.numInPage ?? -1),
        userData: typeof element.userData === 'string' ? element.userData : null,
        text,
        role: classifyTextRole({
          fontSize,
          bold,
          italic,
          border,
          isInsideTitleRect,
          config: params.config,
        }),
        styleSignature: buildStyleSignature({fontSize, bold, italic, border}),
        fontSize,
        bold,
        italic,
        border,
        rect,
      });
    }
  }

  items.sort(compareByReadingOrder);

  const counts: Record<TextRole, number> = {
    heading: 0,
    paragraph: 0,
    comment: 0,
    meta: 0,
    unknown: 0,
  };

  for (const item of items) {
    counts[item.role] += 1;
  }

  return {
    notePath: params.notePath,
    scope: params.scope,
    scannedPages: pages,
    items,
    counts,
  };
}
