import type {ExportClassificationConfig, RoleRuleConfig, StyleRequirement} from './exportConfig';
import {parseBlockTag} from './blockTag';
import {splitAtAside} from './noteRegions';
import type {Rect} from './textboxModel';

/**
 * Classifying scanned textboxes for the DOCX export: their role (title, heading, body, …) by the
 * rules in `exportConfig.ts`, style signatures, reading order, and what the export includes. The
 * aside area (technical-design-aside-area.md §4) is never exported.
 */

export type ExportScope = 'currentPage' | 'wholeNote' | 'pageRange';

export type TextRole = 'heading' | 'paragraph' | 'comment' | 'meta' | 'unknown';

export type ScannedTextBox = {
  page: number;
  /** Valid until the page changes (host facts §3); the Outline uses it to find the textbox again. */
  numInPage: number;
  /** The textbox's `userData` (a block tag, technical-design-manuscript.md §5.2), or null. */
  userData: string | null;
  text: string;
  role: TextRole;
  styleSignature: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  border: boolean;
  rect: Rect | null;
  /** Whether a NOTE title covers the textbox (its middle): such a textbox is a heading. */
  underTitle?: boolean;
  /** A heading's level from its `#`s; 0 when its text has none (a heading by style or title). */
  headingLevel?: number;
};

export type ScanSummary = {
  notePath: string;
  scope: ExportScope;
  scannedPages: number[];
  items: ScannedTextBox[];
  counts: Record<TextRole, number>;
};

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

export function rectContainsPoint(
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

export function classifyTextRole(params: {
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

export function buildStyleSignature(params: {
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

export function compareByReadingOrder(a: ScannedTextBox, b: ScannedTextBox): number {
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

/** The scanned textboxes before the aside area: what the export may include. */
export function textPartOf(items: ScannedTextBox[]): ScannedTextBox[] {
  return splitAtAside(items, item => parseBlockTag(item.userData)).text;
}

/** How many textboxes of the scan are in the aside area (not exported). */
export function asideCount(scan: ScanSummary): number {
  return scan.items.length - textPartOf(scan.items).length;
}

export function getIncludedScanItems(
  scan: ScanSummary,
  includeComments: boolean,
): ScannedTextBox[] {
  return textPartOf(scan.items).filter(item => {
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
  const items = textPartOf(scan.items);
  const count = (role: TextRole) => items.filter(item => item.role === role).length;
  return {
    heading: count('heading'),
    paragraph: count('paragraph'),
    comment: includeComments ? count('comment') : 0,
  };
}

export function summarizeExcludedStyles(
  scan: ScanSummary,
  includeComments: boolean,
): Array<{
  styleSignature: string;
  count: number;
}> {
  const grouped = new Map<string, number>();

  for (const item of textPartOf(scan.items)) {
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
