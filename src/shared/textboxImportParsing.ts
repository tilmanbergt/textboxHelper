import type {
  TextboxImportParagraphSeparator,
  TextboxImportStructureSettings,
} from '../textboxImportActions';

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
          text: heading.text,
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
