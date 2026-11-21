import {parseBlockTag} from '../domain/blockTag';
import type {ScannedTextBox} from '../domain/exportClassification';
import {segmentByFile} from '../domain/fileSegments';
import {fileState, isWritable, FILE_STATE_LABEL, type FileState} from '../domain/fileState';
import {fingerprint} from '../domain/fingerprint';
import {withoutSource, type NoteLinks} from '../domain/noteLinks';
import {plural} from '../domain/plural';
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
  readNoteLinks,
  readSourceRecord,
  writeNoteLinks,
  writeSourceRecord,
} from '../storage/sourceStore';
import {saveCurrentNoteForConsistency} from '../supernote/noteElements';
import {syncFileTitles} from './fileTitles';
import {cachedOutline, rememberOutline} from './manuscriptCache';
import {scanTextBoxes} from './textboxScan';
import {timed} from '../utils/perf';

/**
 * The text files a note is linked to (technical-design-linked-files.md §3): found by the dividers
 * and block tags on the note's textboxes, read with the Outline's scan (and kept in the same cache,
 * so the Outline tab doesn't read the note again); per file its segment, the dry run (would the file
 * change?) and its state; the write of every file that changed here.
 *
 * A write always reads the note fresh, regenerates each file from its segment, asks once before
 * protected blocks leave their files, and never overwrites a file that changed outside since the
 * plugin last read or wrote it (`fileState`).
 */

export type LinkedFile = {
  record: SourceRecord;
  /** The file's textboxes on the note, in reading order. */
  segment: SourceItem[];
  /** The file as the note would write it now (a dry run). */
  regeneration: SourceRegeneration;
  /** Whether that differs from what was last written (or the original), and roughly how much. */
  diff: {differs: boolean; changedBlocks: number};
  state: FileState;
  /** Its divider (name and title) is on the note. */
  hasDivider: boolean;
};

export type LinkedNote = {
  links: NoteLinks | null;
  /** In note order, then files linked to the note but no longer on it. */
  files: LinkedFile[];
  /** Textboxes before the first file's divider that belong to no file. */
  orphans: number;
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

/** The note's linked files with their states, or null when the note has none. */
export async function readLinkedNote(notePath: string, pageCount: number, fresh = false): Promise<LinkedNote | null> {
  const items = sourceItems(await readNoteTextboxes(notePath, pageCount, fresh));
  const links = await readNoteLinks(notePath);
  const segments = segmentByFile(items);
  const sourceIds = [...new Set([...segments.order, ...(links?.sources ?? [])])];
  if (sourceIds.length === 0) {
    return null;
  }
  const files: LinkedFile[] = [];
  await timed(
    'source.files',
    async () => {
      for (const sourceId of sourceIds) {
        const record = await readSourceRecord(sourceId);
        if (record) {
          files.push(await linkedFile(record, segments.bySource.get(sourceId) ?? [], segments.withDivider.has(sourceId)));
        }
      }
    },
    {files: sourceIds.length},
  );
  if (files.length === 0) {
    return null;
  }
  return {links, files, orphans: segments.orphans.length};
}

async function linkedFile(record: SourceRecord, segment: SourceItem[], hasDivider: boolean): Promise<LinkedFile> {
  const regeneration = regenerateSource(record, segment);
  const diff = fileDiff(regeneration, record);
  const current = await readTextFileIfExists(record.filePath).catch(() => null);
  const state = fileState({
    differs: diff.differs,
    current,
    record,
    onNote: hasDivider || regeneration.present,
  });
  return {record, segment, regeneration, diff, state, hasDivider};
}

/** Files that Update / an Apply would write. */
export function filesToWrite(note: LinkedNote | null): LinkedFile[] {
  return (note?.files ?? []).filter(file => isWritable(file.state));
}

/** Files that changed here but are not written (changed outside too, file gone, …). */
export function filesHeldBack(note: LinkedNote | null): LinkedFile[] {
  return (note?.files ?? []).filter(file => file.diff.differs && !isWritable(file.state) && file.state !== 'inSync');
}

/** Check write access: writes, reads back and deletes a probe file next to the linked file. */
export async function checkSourceWriteAccess(record: SourceRecord): Promise<WriteAccess> {
  const result = await checkWriteAccess(sourceFolder(record.filePath));
  console.log('[SourceLink] write access', JSON.stringify(result));
  return result;
}

/** Forgets one file's link: its record goes; the tags left on the textboxes are harmless. */
export async function unlinkFile(record: SourceRecord): Promise<void> {
  await deleteSourceRecord(record.sourceId);
  const links = await readNoteLinks(record.notePath);
  if (links) {
    await writeNoteLinks(withoutSource(links, record.sourceId));
  }
  console.log('[SourceLink] unlinked', record.sourceId);
}

/**
 * Puts the file titles back over every divider of the note and removes ours left without one
 * (every page is read: a deleted divider may have left its title anywhere), then saves the note.
 */
export async function restoreFileTitles(notePath: string, pageCount: number): Promise<string> {
  const pages = Array.from({length: pageCount}, (_, page) => page);
  const {added, removed} = await syncFileTitles(notePath, pages);
  if (added + removed > 0) {
    await saveCurrentNoteForConsistency('restoring the file titles');
  }
  return added + removed > 0
    ? `${plural(added, 'title')} added${removed ? `, ${removed} removed` : ''}.`
    : 'Every file has its title.';
}

/** "Can write here (host copy), probe deleted." — for Details. */
export function writeAccessText(access: WriteAccess): string {
  if (!access.written) {
    return `Can't write in ${access.folder.split('/').slice(-1)[0] || access.folder}: ${access.error ?? 'unknown reason'}`;
  }
  return `Can write here (${access.written}).${access.deleted ? '' : ' The probe file could not be deleted: .textbox-tools-probe.txt'}`;
}

export type SourceWriteMode = 'file' | 'copy' | 'export';

/** Protected blocks deleted on the page, per file, waiting for the user's answer. */
export type PendingRemoval = {sourceId: string; fileName: string; blocks: SourceBlock[]};

export type FilesWriteResult =
  | {
      kind: 'written';
      /** File names written, and those already up to date. */
      written: string[];
      unchanged: string[];
      /** Files that changed here but weren't written, with the reason. */
      skipped: {name: string; reason: string}[];
      warnings: string[];
    }
  | {kind: 'confirm'; pending: PendingRemoval[]};

/** The regeneration with the user's answer about protected blocks deleted on the page. */
function answered(
  file: LinkedFile,
  answer: 'remove' | 'keep' | undefined,
): {record: SourceRecord; regeneration: SourceRegeneration} {
  if (answer !== 'remove' || file.regeneration.pendingRemoval.length === 0) {
    return {record: file.record, regeneration: file.regeneration};
  }
  const removed = new Set([...file.record.removedProtected, ...file.regeneration.pendingRemoval.map(block => block.index)]);
  const record = {...file.record, removedProtected: [...removed].sort((a, b) => a - b)};
  return {record, regeneration: regenerateSource(record, file.segment)};
}

/**
 * Writes every file of the note that changed here (or only those in `only`). Protected blocks
 * deleted on the page make the write stop and ask once for all files (`confirm`), unless
 * `protectedAnswer` is given.
 */
export async function writeLinkedFiles(params: {
  notePath: string;
  pageCount: number;
  only?: string[];
  protectedAnswer?: 'remove' | 'keep';
}): Promise<FilesWriteResult> {
  const note = await readLinkedNote(params.notePath, params.pageCount, true);
  if (!note) {
    throw new Error('The note has no linked files any more.');
  }
  const chosen = note.files.filter(file => !params.only || params.only.includes(file.record.sourceId));
  const targets = chosen.filter(file => isWritable(file.state));
  const pending = targets
    .filter(file => file.regeneration.pendingRemoval.length > 0)
    .map(file => ({
      sourceId: file.record.sourceId,
      fileName: sourceFileName(file.record),
      blocks: file.regeneration.pendingRemoval,
    }));
  if (pending.length > 0 && !params.protectedAnswer) {
    return {kind: 'confirm', pending};
  }
  const written: string[] = [];
  const unchanged: string[] = [];
  const skipped = filesHeldBack({...note, files: chosen}).map(file => ({
    name: sourceFileName(file.record),
    reason: FILE_STATE_LABEL[file.state].toLowerCase(),
  }));
  const warnings: string[] = [];
  for (const file of targets) {
    const name = sourceFileName(file.record);
    try {
      const {record, regeneration} = answered(file, params.protectedAnswer);
      const result = await writeOneFile(record, regeneration, 'file');
      (result.unchanged ? unchanged : written).push(name);
      warnings.push(...regeneration.warnings.map(warning => (note.files.length > 1 ? `${name}: ${warning}` : warning)));
    } catch (error) {
      console.warn('[SourceLink] file not written', String(error));
      skipped.push({name, reason: error instanceof Error ? error.message : String(error)});
    }
  }
  return {kind: 'written', written, unchanged, skipped, warnings};
}

/**
 * Writes one file's text into the linked file (after checking it didn't change outside), a copy
 * next to it, or EXPORT. The original text is kept once and the file's text before every write.
 */
async function writeOneFile(
  record: SourceRecord,
  regeneration: SourceRegeneration,
  mode: SourceWriteMode,
): Promise<{path: string; method: WriteMethod; unchanged: boolean}> {
  const text = regeneration.text;
  if (mode === 'copy') {
    const path = copyPath(record.filePath, new Date());
    const method = await writeTextFile(path, text);
    logWrite(record, mode, method, regeneration);
    return {path, method, unchanged: false};
  }
  if (mode === 'export') {
    const path = await writeTextToExport(sourceFileName(record), text);
    logWrite(record, mode, 'host copy', regeneration);
    return {path, method: 'host copy', unchanged: false};
  }
  const current = await readTextFileIfExists(record.filePath);
  if (current !== null && fingerprint(current) !== record.fileFingerprint) {
    // Read again just now: changed since the card looked.
    throw new Error(`${sourceFileName(record)} was changed outside since the last write, so it wasn't overwritten.`);
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
  logWrite(record, mode, method, regeneration);
  return {path: record.filePath, method, unchanged};
}

/** Save as copy / Save to EXPORT for one file, from the note as it is now. */
export async function saveFileCopy(params: {
  notePath: string;
  pageCount: number;
  sourceId: string;
  mode: 'copy' | 'export';
}): Promise<string> {
  const note = await readLinkedNote(params.notePath, params.pageCount, true);
  const file = note?.files.find(item => item.record.sourceId === params.sourceId);
  if (!file) {
    throw new Error('The link to the text file is gone.');
  }
  // A copy keeps protected blocks deleted on the page: nothing is confirmed by saving a copy.
  const {path} = await writeOneFile(file.record, file.regeneration, params.mode);
  const name = path.split('/').slice(-1)[0];
  return params.mode === 'copy' ? `Saved as ${name}.` : `Saved ${name} to EXPORT.`;
}

function logWrite(record: SourceRecord, mode: SourceWriteMode, method: WriteMethod, result: SourceRegeneration): void {
  console.log(
    '[SourceLink] written',
    JSON.stringify({sourceId: record.sourceId, mode, method, counts: result.counts, warnings: result.warnings.length}),
  );
}

/** "Essay.txt updated", "3 files updated · 1 skipped (Notes.txt: changed in obsidian)" and the like. */
export function writeResultText(result: FilesWriteResult): string {
  if (result.kind === 'confirm') {
    return 'Protected blocks were deleted on the page: answer the question on the card first.';
  }
  const parts: string[] = [];
  if (result.written.length === 1) {
    parts.push(`${result.written[0]} updated`);
  } else if (result.written.length > 1) {
    parts.push(`${plural(result.written.length, 'file')} updated`);
  }
  if (result.written.length === 0 && result.unchanged.length > 0) {
    parts.push(result.unchanged.length === 1 ? `${result.unchanged[0]} is up to date` : 'All files are up to date');
  }
  if (result.skipped.length > 0) {
    const first = result.skipped[0];
    parts.push(
      result.skipped.length === 1
        ? `${first.name} not written (${first.reason})`
        : `${result.skipped.length} not written (${first.name}: ${first.reason}, …) — see Details`,
    );
  }
  if (parts.length === 0) {
    parts.push('Nothing to write');
  }
  const warnings = result.warnings.length;
  return `${parts.join(' · ')}${warnings > 0 ? ` · ${plural(warnings, 'warning')}, see Details` : ''}.`;
}
