import {parseBlockTag} from '../domain/blockTag';
import type {ScannedTextBox} from '../domain/exportClassification';
import type {SourceItem} from '../domain/sourceExport';
import {sourceFolder, type SourceRecord} from '../domain/sourceRecord';
import {getSettings} from '../storage/settingsFile';
import {checkWriteAccess, type WriteAccess} from '../storage/sourceFile';
import {deleteSourceRecord, readSourceRecord} from '../storage/sourceStore';
import {cachedOutline, rememberOutline} from './manuscriptCache';
import {scanTextBoxes} from './textboxScan';
import {timed} from '../utils/perf';

/**
 * The text file a note is linked to (technical-design-source-link.md §4): found by the block tags
 * on the note's textboxes, read with the Outline's scan (and kept in the same cache, so the
 * Outline tab doesn't read the note again).
 */

export type LinkedSource = {
  record: SourceRecord;
  /** The note's textboxes in reading order, as the file is regenerated from them. */
  items: SourceItem[];
  /** How many linked files have tags on this note (more than one: the one with most tags). */
  sourceCount: number;
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
      return {record, items, sourceCount: ranked.length};
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
