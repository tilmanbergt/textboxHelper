/**
 * Text logic of the textbox actions: whitespace cleanup, removing line breaks, join boundaries,
 * word counts, and splitting into sentences and paragraphs.
 */

const COMMON_ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'sr',
  'jr',
  'st',
  'vs',
  'etc',
  'e.g',
  'i.e',
  'u.s',
  'u.k',
  'jan',
  'feb',
  'mar',
  'apr',
  'jun',
  'jul',
  'aug',
  'sep',
  'sept',
  'oct',
  'nov',
  'dec',
]);

function normalizeInlineWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function cleanupTextboxWhitespace(text: string): string {
  const normalizedLineEndings = text.replace(/\r\n?/g, '\n');
  const cleanedLines = normalizedLineEndings.split('\n').map(line =>
    line
      .replace(/[\t\f\v\u00A0 ]+/g, ' ')
      .replace(/\s+([,.;:!?%)\]}])/g, '$1')
      .replace(/([([{])\s+/g, '$1')
      .trim(),
  );

  return cleanedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function removeLineBreaks(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/[ \t\f\v\u00A0]+/g, ' ')
    .trim();
}

export function normalizeJoinBoundary(previous: string, next: string): string {
  const left = previous.replace(/\s+$/g, '');
  const right = next.replace(/^\s+/g, '');

  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  if (/\s$/.test(previous) || /^\s/.test(next)) {
    return `${left} ${right}`.trim();
  }

  if (/[.?!:;]$/.test(left) || /[\p{L}\p{N}]$/u.test(left)) {
    return `${left} ${right}`;
  }

  return `${left}${right}`;
}

function countRealWords(text: string): number {
  const matches = text.match(/[^\W\d_]{2,}/gu);
  return matches ? matches.length : 0;
}

export function countWords(text: string): number {
  const matches = text.match(/\S+/g);
  return matches ? matches.length : 0;
}

function pushSentenceCandidate(
  candidates: string[],
  text: string,
): void {
  const normalized = normalizeInlineWhitespace(text);
  if (!normalized) {
    return;
  }

  candidates.push(normalized);
}

function isSentenceBoundary(text: string, index: number): boolean {
  const char = text[index];

  if (!'.!?'.includes(char)) {
    return false;
  }

  if (char === '.' && /\d/.test(text[index - 1] || '') && /\d/.test(text[index + 1] || '')) {
    return false;
  }

  if (char === '.' && text[index + 1] === '.') {
    return false;
  }

  const prefix = text.slice(0, index);
  const tokenMatch = prefix.match(/([A-Za-z][A-Za-z.]{0,15})$/);
  if (char === '.' && tokenMatch) {
    const token = tokenMatch[1].replace(/\.+$/g, '').toLowerCase();
    if (COMMON_ABBREVIATIONS.has(token)) {
      return false;
    }
  }

  let lookaheadIndex = index + 1;
  while (
    lookaheadIndex < text.length &&
    /[\s"'`)\]}Â»]/.test(text[lookaheadIndex] || '')
  ) {
    if (text[lookaheadIndex] === '\n') {
      return true;
    }
    lookaheadIndex += 1;
  }

  if (lookaheadIndex >= text.length) {
    return true;
  }

  const nextChar = text[lookaheadIndex];
  if (/[\p{Lu}\d]/u.test(nextChar)) {
    return true;
  }

  if (char === '!' || char === '?') {
    return true;
  }

  return false;
}

function mergeTinyFragmentsForward(fragments: string[]): string[] {
  const merged: string[] = [];
  let carry = '';

  for (const fragment of fragments) {
    const normalized = normalizeInlineWhitespace(fragment);
    if (!normalized) {
      continue;
    }

    if (countRealWords(normalized) < 2) {
      carry = carry ? `${carry} ${normalized}` : normalized;
      continue;
    }

    if (carry) {
      merged.push(normalizeInlineWhitespace(`${carry} ${normalized}`));
      carry = '';
      continue;
    }

    merged.push(normalized);
  }

  if (carry) {
    if (merged.length > 0) {
      merged[merged.length - 1] = normalizeInlineWhitespace(
        `${merged[merged.length - 1]} ${carry}`,
      );
    } else {
      merged.push(carry);
    }
  }

  return merged;
}

export function splitIntoSentenceCandidates(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const candidates: string[] = [];

  for (const paragraph of normalized.split(/\n+/)) {
    const trimmedParagraph = paragraph.trim();
    if (!trimmedParagraph) {
      continue;
    }

    let cursor = 0;
    for (let index = 0; index < trimmedParagraph.length; index += 1) {
      if (!isSentenceBoundary(trimmedParagraph, index)) {
        continue;
      }

      pushSentenceCandidate(candidates, trimmedParagraph.slice(cursor, index + 1));
      cursor = index + 1;
    }

    if (cursor < trimmedParagraph.length) {
      pushSentenceCandidate(candidates, trimmedParagraph.slice(cursor));
    }
  }

  return mergeTinyFragmentsForward(candidates);
}

function countSentences(text: string): number {
  return splitIntoSentenceCandidates(text).length;
}

export function splitIntoParagraphCandidates(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim();

  if (!normalized) {
    return [];
  }

  const paragraphs: string[] = [];

  // First: hard split on blank lines
  const blocks = normalized.split(/\n{2,}/);

  for (const block of blocks) {
    const trimmedBlock = block.trim();

    if (!trimmedBlock) {
      continue;
    }

    // Then inspect single line breaks inside the block
    const lines = trimmedBlock.split('\n');

    let currentParagraph = lines[0]?.trim() || '';

    for (let i = 1; i < lines.length; i += 1) {
      const nextLine = lines[i].trim();


      if (countSentences(currentParagraph) > 1) {

        paragraphs.push(currentParagraph);
        currentParagraph = nextLine;
      } else {
        currentParagraph = normalizeInlineWhitespace(
          `${currentParagraph} ${nextLine}`,
        );
      }
    }

    if (currentParagraph) {
      paragraphs.push(currentParagraph);
    }
  }

  return paragraphs;
}
