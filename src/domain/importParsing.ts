import type {
  TextboxImportParagraphSeparator,
  TextboxImportStructureSettings,
} from './importSettings';
import type {SourceBlock} from './sourceBlocks';

export type TextboxImportBlockRole =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3';

export type TextboxImportBlock = {
  role: TextboxImportBlockRole;
  text: string;
  fontSize: number;
  bold: boolean;
  /** Linked import: the block of the file this textbox shows (technical-design-source-link.md §3). */
  sourceIndex?: number;
  /** Linked import: a protected block's placeholder, italic and framed. */
  placeholder?: boolean;
  /** Linked import of several files: which of them (0, 1, …) the block belongs to. */
  sourceFile?: number;
  /** Linked import: the divider with the file's name that starts the file on the note. */
  divider?: boolean;
};

export type TextboxImportBlockSummary = {
  blockCount: number;
  paragraphCount: number;
  headingCount: number;
  h1Count: number;
  h2Count: number;
  h3Count: number;
};

const MARKDOWN_HEADING_PATTERN = /^(#{1,3})\s+(.+?)\s*$/;

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

function splitImportParagraphs(
  text: string,
  separator: TextboxImportParagraphSeparator,
): string[] {
  const normalized = normalizeLineEndings(text);

  if (separator === 'line') {
    return normalized
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
  }

  return normalized
    .split(/\n\s*\n+/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean);
}

function parseHeading(text: string): null | {
  level: 1 | 2 | 3;
  text: string;
} {
  const match = text.match(MARKDOWN_HEADING_PATTERN);

  if (!match) {
    return null;
  }

  const level = match[1].length;

  if (level !== 1 && level !== 2 && level !== 3) {
    return null;
  }

  const headingText = match[2].trim();

  if (!headingText) {
    return null;
  }

  return {
    level,
    text: headingText,
  };
}

function getHeadingStyle(
  structure: TextboxImportStructureSettings,
  level: 1 | 2 | 3,
) {
  if (level === 1) {
    return structure.heading1;
  }

  if (level === 2) {
    return structure.heading2;
  }

  return structure.heading3;
}

export function parseTextboxImportBlocks(params: {
  text: string;
  structure: TextboxImportStructureSettings;
}): TextboxImportBlock[] {
  return splitImportParagraphs(
    params.text,
    params.structure.paragraphSeparator,
  ).map(blockText => {
    if (params.structure.detectMarkdownHeadings) {
      const heading = parseHeading(blockText);

      if (heading) {
        const style = getHeadingStyle(params.structure, heading.level);

        return {
          role: `heading${heading.level}` as TextboxImportBlockRole,
          // The #s stay: the text decides a heading's level (technical-design-outline-sections.md §5).
          text: `${'#'.repeat(heading.level)} ${heading.text}`,
          fontSize: style.fontSize,
          bold: style.bold,
        };
      }
    }

    return {
      role: 'paragraph',
      text: blockText,
      fontSize: params.structure.paragraph.fontSize,
      bold: params.structure.paragraph.bold,
    };
  });
}

export function summarizeTextboxImportBlocks(
  blocks: TextboxImportBlock[],
): TextboxImportBlockSummary {
  const summary: TextboxImportBlockSummary = {
    blockCount: blocks.length,
    paragraphCount: 0,
    headingCount: 0,
    h1Count: 0,
    h2Count: 0,
    h3Count: 0,
  };

  blocks.forEach(block => {
    if (block.role === 'paragraph') {
      summary.paragraphCount += 1;
      return;
    }

    summary.headingCount += 1;

    if (block.role === 'heading1') {
      summary.h1Count += 1;
    } else if (block.role === 'heading2') {
      summary.h2Count += 1;
    } else if (block.role === 'heading3') {
      summary.h3Count += 1;
    }
  });

  return summary;
}

/**
 * The blocks of a linked import (technical-design-source-link.md §3): one per block of the file,
 * headings always recognized (levels 4–6 take the `###` style), lists and paragraphs in the
 * paragraph style, protected blocks as their placeholder label in the paragraph size. With a
 * `divider` name, a divider block in the `#` style comes first (technical-design-linked-files.md
 * §1.2); `sourceFile` says which file of the import the blocks belong to.
 */
export function sourceImportBlocks(
  blocks: SourceBlock[],
  structure: TextboxImportStructureSettings,
  file?: {index: number; divider: string},
): TextboxImportBlock[] {
  const of = file ? {sourceFile: file.index} : {};
  const divider: TextboxImportBlock[] = file
    ? [
        {
          role: 'heading1',
          text: file.divider,
          fontSize: structure.heading1.fontSize,
          bold: structure.heading1.bold,
          divider: true,
          ...of,
        },
      ]
    : [];
  return [
    ...divider,
    ...blocks.map((block): TextboxImportBlock => {
      if (block.role === 'heading') {
        const level = Math.min(3, Math.max(1, block.level)) as 1 | 2 | 3;
        const style = getHeadingStyle(structure, level);
        return {
          role: `heading${level}` as TextboxImportBlockRole,
          text: block.text,
          fontSize: style.fontSize,
          bold: style.bold,
          sourceIndex: block.index,
          ...of,
        };
      }
      return {
        role: 'paragraph',
        text: block.text,
        fontSize: structure.paragraph.fontSize,
        bold: block.role === 'protected' ? false : structure.paragraph.bold,
        sourceIndex: block.index,
        placeholder: block.role === 'protected' || undefined,
        ...of,
      };
    }),
  ];
}
