/**
 * The blocks of a linked text file (technical-design-source-link.md §2.1): frontmatter, headings,
 * paragraphs, lists and protected blocks, each with its span in the original text. Pure.
 *
 * What goes onto the page as one textbox is a block's `text`: a heading with its `#`s, a
 * paragraph or a list exactly as in the file (line breaks kept, so untouched text compares exactly
 * when it is written back), and for a protected block a short label. Protected blocks (code,
 * math, tables, quotes and callouts, HTML, comments, embeds, rules) are not edited on the page;
 * their original text is written back where their placeholder sits.
 *
 * The parser works on the original text and its own line endings (`\n` or `\r\n`), so every span
 * indexes the file as read. Everything outside the frontmatter and the spans is whitespace.
 */
import {headingTitleOf} from './headingText';
import {LIST_ITEM} from './textWhitespace';

export type SourceBlockRole = 'heading' | 'paragraph' | 'list' | 'protected';

export type ProtectedKind = 'code' | 'math' | 'table' | 'quote' | 'html' | 'comment' | 'embed' | 'rule';

export type SourceBlock = {
  /** 0…n-1 in file order. */
  index: number;
  role: SourceBlockRole;
  /** Heading level 1–6; 0 for everything else. */
  level: number;
  protectedKind?: ProtectedKind;
  /** Span in the original text, without the blank lines around it. */
  start: number;
  end: number;
  /** What goes into the textbox. */
  text: string;
};

export type SourceSummary = {
  blocks: number;
  headings: number;
  paragraphs: number;
  lists: number;
  protectedCount: number;
  protectedKinds: Partial<Record<ProtectedKind, number>>;
  frontmatter: boolean;
};

export type ParsedSource = {
  eol: '\n' | '\r\n';
  /** End of the frontmatter (after its closing `---`), 0 when there is none. */
  frontmatterEnd: number;
  blocks: SourceBlock[];
  summary: SourceSummary;
};

type Line = {start: number; end: number; text: string};

const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const RULE = /^[ \t]{0,3}([-*_])([ \t]*\1){2,}[ \t]*$/;
const EMBED = /^[ \t]*!\[\[[^\]]*\]\][ \t]*$/;
const CALLOUT = /^[ \t]*>[ \t]*\[!/;

/** Lines with their offsets; `end` excludes the line break and a `\r` before it. */
function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  while (start <= text.length) {
    const newline = text.indexOf('\n', start);
    const lineEnd = newline < 0 ? text.length : newline;
    const end = lineEnd > start && text[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd;
    lines.push({start, end, text: text.slice(start, end)});
    if (newline < 0) {
      break;
    }
    start = newline + 1;
  }
  return lines;
}

const isBlank = (line: Line) => line.text.trim() === '';

function frontmatterEnd(lines: Line[]): {end: number; next: number} {
  const first = lines[0]?.text.replace(/^﻿/, '');
  if (first !== '---') {
    return {end: 0, next: 0};
  }
  for (let index = 1; index < lines.length; index++) {
    if (lines[index].text === '---' || lines[index].text === '...') {
      return {end: lines[index].end, next: index + 1};
    }
  }
  return {end: 0, next: 0};
}

/** The line that closes a block opened at `from` (the line itself included), or the last line. */
function closingLine(lines: Line[], from: number, closes: (line: Line) => boolean): number {
  for (let index = from + 1; index < lines.length; index++) {
    if (closes(lines[index])) {
      return index;
    }
  }
  // Unclosed: everything to the last non-blank line belongs to the block.
  let last = lines.length - 1;
  while (last > from && isBlank(lines[last])) {
    last--;
  }
  return last;
}

function count(text: string, piece: string): number {
  return text.split(piece).length - 1;
}

/** Where a block starting at line `from` ends (inclusive), and what kind of protected block it is. */
function blockExtent(lines: Line[], from: number): {last: number; protectedKind?: ProtectedKind} {
  const first = lines[from].text;
  const fence = first.match(FENCE);
  if (fence) {
    const marker = fence[1];
    const closer = new RegExp(`^[ \\t]{0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*$`);
    return {last: closingLine(lines, from, line => closer.test(line.text)), protectedKind: 'code'};
  }
  const trimmed = first.trim();
  if (trimmed.startsWith('$$') && (trimmed === '$$' || !trimmed.slice(2).trimEnd().endsWith('$$'))) {
    return {last: closingLine(lines, from, line => line.text.trimEnd().endsWith('$$')), protectedKind: 'math'};
  }
  if (trimmed.startsWith('%%') && count(trimmed, '%%') % 2 === 1) {
    return {last: closingLine(lines, from, line => line.text.includes('%%')), protectedKind: 'comment'};
  }
  if (HEADING.test(first)) {
    return {last: from};
  }
  // A block runs to the next blank line; a heading or a code fence starts a block of its own.
  let last = from;
  while (
    last + 1 < lines.length &&
    !isBlank(lines[last + 1]) &&
    !HEADING.test(lines[last + 1].text) &&
    !FENCE.test(lines[last + 1].text)
  ) {
    last++;
  }
  return {last};
}

function protectedKindOf(blockLines: Line[]): ProtectedKind | undefined {
  const first = blockLines[0].text;
  const trimmed = first.trimStart();
  if (trimmed.startsWith('|')) {
    return 'table';
  }
  if (trimmed.startsWith('>')) {
    return 'quote';
  }
  if (trimmed.startsWith('<')) {
    return 'html';
  }
  if (trimmed.startsWith('%%') || trimmed.startsWith('$$')) {
    return trimmed.startsWith('%%') ? 'comment' : 'math';
  }
  if (blockLines.every(line => EMBED.test(line.text))) {
    return 'embed';
  }
  if (blockLines.length === 1 && RULE.test(first)) {
    return 'rule';
  }
  return undefined;
}

function plainLines(blockLines: Line[]): string {
  return blockLines.map(line => line.text).join('\n');
}

/** The placeholder text of a protected block, e.g. "⟦Table · 5 rows · kept as is⟧". */
export function protectedLabel(kind: ProtectedKind, blockLines: string[]): string {
  const lines = blockLines.length;
  const lineCount = `${lines} ${lines === 1 ? 'line' : 'lines'}`;
  let name: string;
  switch (kind) {
    case 'code':
      name = `Code · ${lineCount}`;
      break;
    case 'math':
      name = `Formula · ${lineCount}`;
      break;
    case 'table': {
      // The separator row (|---|---|) is not a row.
      const rows = blockLines.filter(line => !/^[\s|:-]+$/.test(line)).length;
      name = `Table · ${rows} ${rows === 1 ? 'row' : 'rows'}`;
      break;
    }
    case 'quote':
      name = `${CALLOUT.test(blockLines[0] ?? '') ? 'Callout' : 'Quote'} · ${lineCount}`;
      break;
    case 'html':
      name = `HTML · ${lineCount}`;
      break;
    case 'comment':
      name = `Comment · ${lineCount}`;
      break;
    case 'embed':
      name = lines === 1 ? 'Embed' : `Embeds · ${lines}`;
      break;
    case 'rule':
      name = 'Horizontal line';
      break;
  }
  return `⟦${name} · kept as is⟧`;
}

export function parseSourceBlocks(original: string): ParsedSource {
  const eol: '\n' | '\r\n' = /\r\n/.test(original) ? '\r\n' : '\n';
  const lines = splitLines(original);
  const front = frontmatterEnd(lines);
  const blocks: SourceBlock[] = [];
  let index = front.next;
  while (index < lines.length) {
    if (isBlank(lines[index])) {
      index++;
      continue;
    }
    const extent = blockExtent(lines, index);
    const blockLines = lines.slice(index, extent.last + 1);
    const start = blockLines[0].start;
    const end = blockLines[blockLines.length - 1].end;
    const heading = blockLines.length === 1 && !extent.protectedKind ? blockLines[0].text.match(HEADING) : null;
    const protectedKind = extent.protectedKind ?? (heading ? undefined : protectedKindOf(blockLines));
    const base = {index: blocks.length, start, end};
    if (heading && heading[2].trim()) {
      // The #s stay in the text: on the page the text decides a heading's level
      // (technical-design-outline-sections.md §5).
      blocks.push({...base, role: 'heading', level: heading[1].length, text: `${heading[1]} ${heading[2].trim()}`});
    } else if (protectedKind) {
      blocks.push({
        ...base,
        role: 'protected',
        level: 0,
        protectedKind,
        text: protectedLabel(
          protectedKind,
          blockLines.map(line => line.text),
        ),
      });
    } else {
      const role = LIST_ITEM.test(blockLines[0].text) ? 'list' : 'paragraph';
      blocks.push({...base, role, level: 0, text: plainLines(blockLines)});
    }
    index = extent.last + 1;
  }
  return {eol, frontmatterEnd: front.end, blocks, summary: summarize(blocks, front.end > 0)};
}

function summarize(blocks: SourceBlock[], frontmatter: boolean): SourceSummary {
  const protectedKinds: Partial<Record<ProtectedKind, number>> = {};
  let headings = 0;
  let paragraphs = 0;
  let lists = 0;
  let protectedCount = 0;
  for (const block of blocks) {
    if (block.role === 'heading') {
      headings++;
    } else if (block.role === 'paragraph') {
      paragraphs++;
    } else if (block.role === 'list') {
      lists++;
    } else if (block.protectedKind) {
      protectedCount++;
      protectedKinds[block.protectedKind] = (protectedKinds[block.protectedKind] ?? 0) + 1;
    }
  }
  return {blocks: blocks.length, headings, paragraphs, lists, protectedCount, protectedKinds, frontmatter};
}

const KIND_NAMES: Record<ProtectedKind, [string, string]> = {
  code: ['code block', 'code blocks'],
  math: ['formula', 'formulas'],
  table: ['table', 'tables'],
  quote: ['quote or callout', 'quotes or callouts'],
  html: ['HTML block', 'HTML blocks'],
  comment: ['comment', 'comments'],
  embed: ['embed', 'embeds'],
  rule: ['horizontal line', 'horizontal lines'],
};

/** "Kept as is: 1 table, 2 code blocks" — empty when nothing is protected. */
export function protectedSummaryText(summary: SourceSummary): string {
  const parts = (Object.keys(KIND_NAMES) as ProtectedKind[])
    .filter(kind => (summary.protectedKinds[kind] ?? 0) > 0)
    .map(kind => {
      const n = summary.protectedKinds[kind] ?? 0;
      return `${n} ${KIND_NAMES[kind][n === 1 ? 0 : 1]}`;
    });
  return parts.length > 0 ? `Kept as is: ${parts.join(', ')}` : '';
}

/** The first few words of a block, to name it in a message. */
export function blockName(block: SourceBlock, words = 5): string {
  if (block.role === 'protected') {
    return block.text.replace(/^⟦/, '').replace(/ · kept as is⟧$/, '');
  }
  const text = block.role === 'heading' ? headingTitleOf(block.text) : block.text;
  const all = text.replace(/\s+/g, ' ').trim().split(' ');
  return all.length > words ? `${all.slice(0, words).join(' ')}…` : all.join(' ');
}

/** The summaries of several files added up (the import overview of several files). */
export function addSummaries(summaries: SourceSummary[]): SourceSummary {
  const total: SourceSummary = {
    blocks: 0,
    headings: 0,
    paragraphs: 0,
    lists: 0,
    protectedCount: 0,
    protectedKinds: {},
    frontmatter: false,
  };
  for (const summary of summaries) {
    total.blocks += summary.blocks;
    total.headings += summary.headings;
    total.paragraphs += summary.paragraphs;
    total.lists += summary.lists;
    total.protectedCount += summary.protectedCount;
    total.frontmatter = total.frontmatter || summary.frontmatter;
    for (const [kind, n] of Object.entries(summary.protectedKinds) as [ProtectedKind, number][]) {
      total.protectedKinds[kind] = (total.protectedKinds[kind] ?? 0) + n;
    }
  }
  return total;
}
