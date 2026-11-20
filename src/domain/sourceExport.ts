/**
 * Regenerating a linked text file from the note (technical-design-source-link.md §2.4–§2.6). The
 * note is the truth: the file is rebuilt from the textboxes of the linked range in reading order
 * and the original text, every time it is written. Pure.
 *
 * - A textbox tagged with a block of this source whose text is still the block's text writes the
 *   original span byte for byte; an edited one writes its new text (a heading with its `#`s).
 * - Pieces of a paragraph the import cut (same block, one after the other) are one block again.
 * - An untagged textbox (a split tail, a joined textbox, typed or converted text) is new text,
 *   written as it is.
 * - A protected block's placeholder writes the original block, whatever the placeholder says.
 *   A protected block whose placeholder is gone is kept near its old place until the user confirms
 *   its removal (`removedProtected`); the write asks first (`pendingRemoval`).
 * - Between two blocks that were neighbours in the file and are both untouched, the original text
 *   between them is kept; elsewhere one blank line.
 */
import type {BlockTag} from './blockTag';
import {blockName, type SourceBlock} from './sourceBlocks';
import type {SourceRecord} from './sourceRecord';

/** A textbox of the note, in reading order. */
export type SourceItem = {
  page: number;
  text: string;
  tag: BlockTag | null;
};

export type SourceCounts = {
  unchanged: number;
  edited: number;
  added: number;
  missing: number;
  protectedKept: number;
  protectedRemoved: number;
};

export type SourceRegeneration = {
  text: string;
  counts: SourceCounts;
  /** Editable blocks no textbox shows any more, by their first words. */
  missing: string[];
  /** Protected blocks whose placeholder is gone and whose removal isn't confirmed yet. */
  pendingRemoval: SourceBlock[];
  warnings: string[];
  /** The linked range (first and last page with a tag of this source); null when none is left. */
  range: {first: number; last: number} | null;
  identical: boolean;
};

type RecordPart = Pick<SourceRecord, 'sourceId' | 'original' | 'eol' | 'frontmatterEnd' | 'blocks' | 'removedProtected'>;

type Entry = {
  /** The source block, or null for new text. */
  index: number | null;
  /** Untouched original span (unchanged or protected): separators can come from the file. */
  original: boolean;
  text: string;
};

/** Line ends trimmed, line breaks as `\n`, both ends trimmed: how textbox text is compared. */
export function normalizeForCompare(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim();
}

function ownTag(item: SourceItem, sourceId: string): BlockTag | null {
  const tag = item.tag;
  return tag && tag.s === sourceId && Number.isInteger(tag.i) ? tag : null;
}

/** The pages from the first to the last one holding a tag of this source. */
export function linkedRange(items: SourceItem[], sourceId: string): {first: number; last: number} | null {
  const pages = items.filter(item => ownTag(item, sourceId)).map(item => item.page);
  return pages.length > 0 ? {first: Math.min(...pages), last: Math.max(...pages)} : null;
}

function serialize(block: SourceBlock, text: string): string {
  return block.role === 'heading' ? `${'#'.repeat(Math.max(1, block.level))} ${text}` : text;
}

function linkCounts(text: string): number[] {
  return ['[[', ']]', '](', '`'].map(piece => text.split(piece).length - 1);
}

/** A warning when an edit seems to have broken a link or code span. */
function linkWarning(block: SourceBlock, text: string): string | null {
  const before = linkCounts(block.text);
  const after = linkCounts(text);
  const unbalanced = after[0] !== after[1] || after[3] % 2 === 1;
  const changed = before.some((n, index) => n !== after[index]);
  return unbalanced || changed ? `A link may be broken in "${blockName({...block, text})}".` : null;
}

/** A warning when an edited list's indentation changed. */
function listWarning(block: SourceBlock, text: string): string | null {
  const before = block.text.split('\n');
  const after = text.split('\n');
  const indent = (line: string) => line.match(/^[ \t]*/)?.[0] ?? '';
  if (before.length === after.length) {
    const changed = before.some((line, index) => indent(line) !== indent(after[index]));
    return changed ? `List "${blockName(block)}": check its indentation.` : null;
  }
  const nested = before.some(line => indent(line).length > 0);
  return nested ? `List "${blockName(block)}" changed: check its indentation.` : null;
}

export function regenerateSource(record: RecordPart, items: SourceItem[]): SourceRegeneration {
  const {blocks, original, sourceId} = record;
  const range = linkedRange(items, sourceId);
  const counts: SourceCounts = {unchanged: 0, edited: 0, added: 0, missing: 0, protectedKept: 0, protectedRemoved: 0};
  const warnings: string[] = [];
  const entries: Entry[] = [];
  const seen = new Set<number>();
  const inRange = range
    ? items.filter(item => item.page >= range.first && item.page <= range.last)
    : [];

  for (let at = 0; at < inRange.length; at++) {
    const item = inRange[at];
    // A textbox of another linked file in the same pages belongs to that file.
    if (item.tag?.s && item.tag.s !== sourceId) {
      continue;
    }
    const tag = ownTag(item, sourceId);
    const block = tag ? blocks[tag.i as number] : undefined;
    if (!tag || !block) {
      const text = item.text.replace(/\r\n?/g, '\n').trim();
      if (text) {
        entries.push({index: null, original: false, text});
        counts.added++;
      }
      continue;
    }
    if (block.role === 'protected' || tag.k === 'x') {
      if (seen.has(block.index)) {
        warnings.push(`A copy of "${blockName(block)}" was left out: it is written once.`);
        continue;
      }
      seen.add(block.index);
      entries.push({index: block.index, original: true, text: original.slice(block.start, block.end)});
      counts.protectedKept++;
      continue;
    }
    // Pieces of one block the import cut, one after the other, are one block again.
    const pieces = [item.text];
    while (at + 1 < inRange.length) {
      const next = ownTag(inRange[at + 1], sourceId);
      if (!next || next.i !== tag.i || next.k === 'x') {
        break;
      }
      pieces.push(inRange[at + 1].text);
      at++;
    }
    const text = normalizeForCompare(pieces.join(' '));
    const first = !seen.has(block.index);
    seen.add(block.index);
    if (first && text === normalizeForCompare(block.text)) {
      entries.push({index: block.index, original: true, text: original.slice(block.start, block.end)});
      counts.unchanged++;
      continue;
    }
    if (!text) {
      continue;
    }
    entries.push({index: block.index, original: false, text: serialize(block, text)});
    counts.edited++;
    const warning = block.role === 'list' ? listWarning(block, text) : null;
    const link = linkWarning(block, text);
    for (const message of [warning, link]) {
      if (message) {
        warnings.push(message);
      }
    }
  }

  const missing: string[] = [];
  const pendingRemoval: SourceBlock[] = [];
  for (const block of blocks) {
    if (seen.has(block.index)) {
      continue;
    }
    if (block.role !== 'protected') {
      missing.push(blockName(block));
      counts.missing++;
    } else if (record.removedProtected.includes(block.index)) {
      counts.protectedRemoved++;
    } else {
      // Kept near its old place until its removal is confirmed.
      pendingRemoval.push(block);
      insertNearOldPlace(entries, {index: block.index, original: true, text: original.slice(block.start, block.end)});
      counts.protectedKept++;
      warnings.push(`"${blockName(block)}" was deleted on the page: it stays in the file until you confirm.`);
    }
  }

  const text = assemble(record, entries);
  return {text, counts, missing, pendingRemoval, warnings, range, identical: text === original};
}

/** Puts a block right after the nearest earlier block of the file that is in the output. */
function insertNearOldPlace(entries: Entry[], entry: Entry): void {
  const index = entry.index as number;
  let best = -1;
  let bestIndex = -1;
  entries.forEach((other, position) => {
    if (other.index !== null && other.index < index && other.index > bestIndex) {
      bestIndex = other.index;
      best = position;
    }
  });
  entries.splice(best + 1, 0, entry);
}

function assemble(record: RecordPart, entries: Entry[]): string {
  const {blocks, original, eol, frontmatterEnd} = record;
  const firstStart = blocks.length > 0 ? blocks[0].start : original.length;
  const lastEnd = blocks.length > 0 ? blocks[blocks.length - 1].end : original.length;
  const head = original.slice(0, Math.max(frontmatterEnd, firstStart));
  const tail = original.slice(Math.max(lastEnd, frontmatterEnd, firstStart));
  const withEol = (text: string) => (eol === '\r\n' ? text.replace(/\r?\n/g, '\r\n') : text);
  if (entries.length === 0) {
    return `${original.slice(0, frontmatterEnd)}${frontmatterEnd > 0 ? eol : ''}`;
  }
  let text = head;
  entries.forEach((entry, position) => {
    if (position > 0) {
      const before = entries[position - 1];
      const neighbours =
        before.original && entry.original && before.index !== null && entry.index === before.index + 1;
      text += neighbours
        ? original.slice(blocks[before.index as number].end, blocks[entry.index as number].start)
        : `${eol}${eol}`;
    }
    text += entry.original ? entry.text : withEol(entry.text);
  });
  return text + tail;
}

/** Whether the note differs from what was last written (or the original), and roughly how much. */
export function fileDiff(
  result: Pick<SourceRegeneration, 'text'>,
  record: Pick<SourceRecord, 'lastWrittenText' | 'original'>,
): {differs: boolean; changedBlocks: number} {
  const before = record.lastWrittenText ?? record.original;
  if (result.text === before) {
    return {differs: false, changedBlocks: 0};
  }
  const split = (text: string) =>
    text
      .replace(/\r\n?/g, '\n')
      .split(/\n[ \t]*\n/)
      .map(part => part.trim())
      .filter(Boolean);
  const remaining = new Map<string, number>();
  split(before).forEach(part => remaining.set(part, (remaining.get(part) ?? 0) + 1));
  let added = 0;
  for (const part of split(result.text)) {
    const left = remaining.get(part) ?? 0;
    if (left > 0) {
      remaining.set(part, left - 1);
    } else {
      added++;
    }
  }
  const removed = [...remaining.values()].reduce((sum, n) => sum + n, 0);
  return {differs: true, changedBlocks: Math.max(added, removed, 1)};
}
