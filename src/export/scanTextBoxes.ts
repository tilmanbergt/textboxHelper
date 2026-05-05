import {PluginFileAPI, type Rect} from 'sn-plugin-lib';
import type {ExportClassificationConfig, RoleRuleConfig, StyleRequirement} from './exportConfig';

export type ExportScope = 'currentPage' | 'wholeNote' | 'pageRange';
export type TextRole = 'heading' | 'paragraph' | 'comment' | 'meta' | 'unknown';

export type ScannedTextBox = {
  page: number;
  text: string;
  role: TextRole;
  styleSignature: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  border: boolean;
  rect: Rect | null;
};

export type ScanSummary = {
  notePath: string;
  scope: ExportScope;
  scannedPages: number[];
  items: ScannedTextBox[];
  counts: Record<TextRole, number>;
};

type RawElement = {
  type?: number;
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

function expectApiResult<T>(result: any, fallbackMessage: string): T {
  if (!result?.success) {
    throw new Error(result?.error?.message ?? fallbackMessage);
  }

  return result.result as T;
}

function tryApiResult<T>(result: any): T | null {
  if (!result?.success) {
    return null;
  }

  return (result.result as T) ?? null;
}

function requirementMatches(
  requirement: StyleRequirement,
  value: boolean,
): boolean {
  if (requirement === 'any') {
    return true;
  }

  if (requirement === 'yes') {
    return value;
  }

  return !value;
}

function ruleMatches(
  rule: RoleRuleConfig,
  params: {
    fontSize: number;
    bold: boolean;
    italic: boolean;
    border: boolean;
  },
): boolean {
  const {fontSize, bold, italic, border} = params;

  return (
    fontSize >= rule.minFontSize &&
    fontSize <= rule.maxFontSize &&
    requirementMatches(rule.bold, bold) &&
    requirementMatches(rule.italic, italic) &&
    requirementMatches(rule.border, border)
  );
}

function rectContainsPoint(
  rect: {left: number; top: number; right: number; bottom: number},
  point: {x: number; y: number},
): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  );
}

function classifyTextRole(params: {
  fontSize: number;
  bold: boolean;
  italic: boolean;
  border: boolean;
  isInsideTitleRect: boolean;
  config: ExportClassificationConfig;
}): TextRole {
  const {fontSize, bold, italic, border, isInsideTitleRect, config} = params;

  if (config.treatTitleTextBoxesAsHeadings && isInsideTitleRect) {
    return 'heading';
  }

  if (ruleMatches(config.heading, {fontSize, bold, italic, border})) {
    return 'heading';
  }

  if (ruleMatches(config.paragraph, {fontSize, bold, italic, border})) {
    return 'paragraph';
  }

  if (ruleMatches(config.comment, {fontSize, bold, italic, border})) {
    return 'comment';
  }

  if (ruleMatches(config.meta, {fontSize, bold, italic, border})) {
    return 'meta';
  }

  return 'unknown';
}

function buildStyleSignature(params: {
  fontSize: number;
  bold: boolean;
  italic: boolean;
  border: boolean;
}): string {
  const {fontSize, bold, italic, border} = params;
  const weight = bold ? 'bold' : 'regular';
  const posture = italic ? 'italic' : 'upright';
  const frame = border ? 'border' : 'no border';
  return `${fontSize} / ${weight} / ${posture} / ${frame}`;
}

function compareByReadingOrder(a: ScannedTextBox, b: ScannedTextBox): number {
  if (a.page !== b.page) {
    return a.page - b.page;
  }

  const aTop = a.rect?.top ?? 0;
  const bTop = b.rect?.top ?? 0;
  if (aTop !== bTop) {
    return aTop - bTop;
  }

  const aLeft = a.rect?.left ?? 0;
  const bLeft = b.rect?.left ?? 0;
  return aLeft - bLeft;
}

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
    totalPages = expectApiResult<number>(
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
        await PluginFileAPI.getTitles(params.notePath, [page]),
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
      expectApiResult<RawElement[]>(
      await PluginFileAPI.getElements(page, params.notePath),
      `Could not read elements from page ${page + 1}.`,
      ) ?? [];

    for (const element of elements) {
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

export function getIncludedScanItems(
  scan: ScanSummary,
  includeComments: boolean,
): ScannedTextBox[] {
  return scan.items.filter(item => {
    if (item.role === 'heading' || item.role === 'paragraph') {
      return true;
    }

    if (item.role === 'comment') {
      return includeComments;
    }

    return false;
  });
}

export function getIncludedRoleCounts(
  scan: ScanSummary,
  includeComments: boolean,
): Record<'heading' | 'paragraph' | 'comment', number> {
  const included = {
    heading: scan.counts.heading,
    paragraph: scan.counts.paragraph,
    comment: includeComments ? scan.counts.comment : 0,
  };

  return included;
}

export function summarizeExcludedStyles(
  scan: ScanSummary,
  includeComments: boolean,
): Array<{
  styleSignature: string;
  count: number;
}> {
  const grouped = new Map<string, number>();

  for (const item of scan.items) {
    const isIncluded =
      item.role === 'heading' ||
      item.role === 'paragraph' ||
      (includeComments && item.role === 'comment');

    if (isIncluded) {
      continue;
    }

    const current = grouped.get(item.styleSignature) ?? 0;
    grouped.set(item.styleSignature, current + 1);
  }

  return [...grouped.entries()]
    .map(([styleSignature, count]) => ({
      styleSignature,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.styleSignature.localeCompare(b.styleSignature));
}
