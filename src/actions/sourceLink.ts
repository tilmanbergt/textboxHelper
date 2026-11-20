import {parseBlockTag} from '../domain/blockTag';
import type {ScannedTextBox} from '../domain/exportClassification';
import {fingerprint} from '../domain/fingerprint';
import type {SourceBlock} from '../domain/sourceBlocks';
import {fileDiff, regenerateSource, type SourceItem, type SourceRegeneration} from '../domain/sourceExport';
import {copyPath, sourceFileName, sourceFolder, type SourceRecord} from '../domain/sourceRecord';
import {getSettings} from '../storage/settingsFile';
import {
  checkWriteAccess,
  readTextFileIfExists,
  writeTextFile,
  writeTextToExport,
  type WriteAccess,
  type WriteMethod,
} from '../storage/sourceFile';
import {
  deleteSourceRecord,
  keepOriginalCopy,
  keepPreviousCopy,
  readSourceRecord,
  writeSourceRecord,
} from '../storage/sourceStore';
import {cachedOutline, rememberOutline} from './manuscriptCache';
import {scanTextBoxes} from './textboxScan';
import {timed} from '../utils/perf';

/**
 * The text file a note is linked to (technical-design-source-link.md §4, §5): found by the block
 * tags on the note's textboxes, read with the Outline's scan (and kept in the same cache, so the
 * Outline tab doesn't read the note again); its dry run (would the file change?) and its write.
 *
 * A write always reads the note fresh, regenerates the file, asks before a protected block leaves
 * the file, and never overwrites a file that changed outside since the plugin last read or wrote
 * it.
 */

export type LinkedSource = {
  record: SourceRecord;
  /** The note's textboxes in reading order, as the file is regenerated from them. */
  items: SourceItem[];
  /** How many linked files have tags on this note (more than one: the one with most tags). */
  sourceCount: number;
  /** The file as the note would write it now (a dry run). */
  regeneration: SourceRegeneration;
  /** Whether that differs from what was last written (or the original), and roughly how much. */
  diff: {differs: boolean; changedBlocks: number};
};

export function sourceItems(scanned: ScannedTextBox[]): SourceItem[] {
  return scanned.map(item => ({page: item.page, text: item.text, tag: parseBlockTag(item.userData)}));
}

/** The note's textboxes in reading order: from the cache, or scanned (`fresh` always scans). */
export async function readNoteTextboxes(
  notePath: string,
  pageCount: number,
  fresh = false,
): Promise<ScannedTextBox[]> {
  const cached = fresh ? null : cachedOutline(notePath, pageCount);
  if (cached) {
    return cached;
  }
  const scan = await timed(
    'source.scan',
    () =>
      scanTextBoxes({
        notePath,
        currentPage: null,
        scope: 'wholeNote',
        config: getSettings().export.rules,
      }),
    {pages: pageCount},
  );
  rememberOutline(notePath, pageCount, scan.items);
  return scan.items;
}

/** The linked file of the note with most tags on it, or null when the note isn't linked. */
export async function findLinkedSource(
  notePath: string,
  pageCount: number,
  fresh = false,
): Promise<LinkedSource | null> {
  const items = sourceItems(await readNoteTextboxes(notePath, pageCount, fresh));
  const tagsPerSource = new Map<string, number>();
  for (const item of items) {
    if (item.tag?.s) {
      tagsPerSource.set(item.tag.s, (tagsPerSource.get(item.tag.s) ?? 0) + 1);
    }
  }
  const ranked = [...tagsPerSource].sort((a, b) => b[1] - a[1]);
  for (const [sourceId] of ranked) {
    const record = await readSourceRecord(sourceId);
    if (record) {
      const regeneration = regenerateSource(record, items);
      return {record, items, sourceCount: ranked.length, regeneration, diff: fileDiff(regeneration, record)};
    }
  }
  return null;
}

/** Check write access: writes, reads back and deletes a probe file next to the linked file. */
export async function checkSourceWriteAccess(record: SourceRecord): Promise<WriteAccess> {
  const result = await checkWriteAccess(sourceFolder(record.filePath));
  console.log('[SourceLink] write access', JSON.stringify(result));
  return result;
}

/** Forgets the link: the record goes; the tags left on the textboxes are harmless. */
export async function unlinkSource(record: SourceRecord): Promise<void> {
  await deleteSourceRecord(record.sourceId);
  console.log('[SourceLink] unlinked', record.sourceId);
}

/** "Can write here (host copy), probe deleted." — for Details. */
export function writeAccessText(access: WriteAccess): string {
  if (!access.written) {
    return `Can't write in ${access.folder.split('/').slice(-1)[0] || access.folder}: ${access.error ?? 'unknown reason'}`;
  }
  return `Can write here (${access.written}).${access.deleted ? '' : ' The probe file could not be deleted: .textbox-tools-probe.txt'}`;
}

export type SourceWriteMode = 'file' | 'copy' | 'export';

export type SourceWriteResult =
  | {kind: 'written'; path: string; method: WriteMethod; mode: SourceWriteMode; regeneration: SourceRegeneration; unchanged: boolean}
  /** Protected blocks whose placeholders are gone: the user decides before anything is written. */
  | {kind: 'confirm'; pending: SourceBlock[]}
  | {kind: 'changedOutside'; fileName: string};

/**
 * Writes the note's text into the linked file (or a copy next to it, or EXPORT). `protectedAnswer`
 * is the user's answer about protected blocks deleted on the page; without it, such blocks make
 * the write stop and ask (`confirm`).
 */
export async function writeLinkedSource(params: {
  notePath: string;
  pageCount: number;
  sourceId: string;
  mode: SourceWriteMode;
  protectedAnswer?: 'remove' | 'keep';
}): Promise<SourceWriteResult> {
  const stored = await readSourceRecord(params.sourceId);
  if (!stored) {
    throw new Error('The link to the text file is gone (its record could not be read).');
  }
  const items = sourceItems(await readNoteTextboxes(params.notePath, params.pageCount, true));
  let record = stored;
  let regeneration = regenerateSource(record, items);
  if (!regeneration.range) {
    throw new Error(`No textbox of ${sourceFileName(record)} is left on the pages: nothing was written.`);
  }
  if (regeneration.pendingRemoval.length > 0) {
    if (!params.protectedAnswer) {
      return {kind: 'confirm', pending: regeneration.pendingRemoval};
    }
    if (params.protectedAnswer === 'remove') {
      const removed = new Set([...record.removedProtected, ...regeneration.pendingRemoval.map(block => block.index)]);
      record = {...record, removedProtected: [...removed].sort((a, b) => a - b)};
      regeneration = regenerateSource(record, items);
    }
  }
  const text = regeneration.text;

  if (params.mode === 'copy') {
    const path = copyPath(record.filePath, new Date());
    const method = await writeTextFile(path, text);
    logWrite(record, params.mode, method, regeneration);
    return {kind: 'written', path, method, mode: params.mode, regeneration, unchanged: false};
  }
  if (params.mode === 'export') {
    const path = await writeTextToExport(sourceFileName(record), text);
    logWrite(record, params.mode, 'host copy', regeneration);
    return {kind: 'written', path, method: 'host copy', mode: params.mode, regeneration, unchanged: false};
  }

  const current = await readTextFileIfExists(record.filePath);
  if (current !== null && fingerprint(current) !== record.fileFingerprint) {
    console.log('[SourceLink] changed outside', JSON.stringify({sourceId: record.sourceId}));
    return {kind: 'changedOutside', fileName: sourceFileName(record)};
  }
  let method: WriteMethod = 'direct';
  const unchanged = current === text;
  if (!unchanged) {
    // Nothing of the file is lost: its original once, and what it held before this write.
    await keepOriginalCopy(record);
    if (current !== null) {
      await keepPreviousCopy(record, current);
    }
    method = await writeTextFile(record.filePath, text);
  }
  await writeSourceRecord({
    ...record,
    lastWrittenAt: new Date().toISOString(),
    lastWrittenText: text,
    fileFingerprint: fingerprint(text),
  });
  logWrite(record, params.mode, method, regeneration);
  return {kind: 'written', path: record.filePath, method, mode: params.mode, regeneration, unchanged};
}

function logWrite(record: SourceRecord, mode: SourceWriteMode, method: WriteMethod, result: SourceRegeneration): void {
  console.log(
    '[SourceLink] written',
    JSON.stringify({sourceId: record.sourceId, mode, method, counts: result.counts, warnings: result.warnings.length}),
  );
}

/** "Essay.txt updated · 2 warnings, see Details" and the like, for the status line. */
export function writeResultText(result: SourceWriteResult): string {
  if (result.kind === 'changedOutside') {
    return `${result.fileName} was changed outside since the last write, so it wasn't overwritten. Details → Save as copy.`;
  }
  if (result.kind === 'confirm') {
    return 'Protected blocks were deleted on the page: answer the question on the card first.';
  }
  const name = result.path.split('/').slice(-1)[0];
  const warnings = result.regeneration.warnings.length;
  const warningText = warnings > 0 ? ` · ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}, see Details` : '';
  if (result.mode === 'copy') {
    return `Saved as ${name}${warningText}.`;
  }
  if (result.mode === 'export') {
    return `Saved ${name} to EXPORT${warningText}.`;
  }
  return `${result.unchanged ? `${name} is up to date` : `${name} updated`}${warningText}.`;
}
