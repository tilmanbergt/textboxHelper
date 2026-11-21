import {parseBlockTag} from '../domain/blockTag';
import type {ScannedTextBox} from '../domain/exportClassification';
import {heldElsewhere, segmentByFile, type FileSegments} from '../domain/fileSegments';
import {fileState, isWritable, FILE_STATE_LABEL, type FileState} from '../domain/fileState';
import {fingerprint} from '../domain/fingerprint';
import {INDEX_FILE, withFolder, withoutSource, type LinkedFolder, type NoteLinks} from '../domain/noteLinks';
import {plural} from '../domain/plural';
import type {SourceBlock} from '../domain/sourceBlocks';
import {
  fileDiff,
  regenerateSource,
  type CrossingOptions,
  type SourceItem,
  type SourceRegeneration,
} from '../domain/sourceExport';
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
import {linkedFileNames, readFolderState, writeIndexFile, type FolderState} from './folderLink';
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
  /** How textboxes that crossed between files were treated in this dry run. */
  options: CrossingOptions;
};

export type LinkedNote = {
  links: NoteLinks | null;
  /** In note order, then files linked to the note but no longer on it. */
  files: LinkedFile[];
  /** Textboxes before the first file's divider that belong to no file. */
  orphans: number;
  /** Folder mode: the bound folder's new files, files left out and index. */
  folder: FolderState | null;
  /** Textboxes under another file's title, waiting for the user to confirm the move. */
  crossings: number;
  /** What the dry run was made from, to make it again with the moves confirmed. */
  basis: {segments: FileSegments; records: SourceRecord[]; hasDivider: Map<string, boolean>};
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
  const records: SourceRecord[] = [];
  const hasDivider = new Map<string, boolean>();
  await timed(
    'source.records',
    async () => {
      for (const sourceId of sourceIds) {
        const record = await readSourceRecord(sourceId);
        if (record) {
          records.push(record);
          hasDivider.set(sourceId, segments.withDivider.has(sourceId));
        }
      }
    },
    {files: sourceIds.length},
  );
  const files = await timed('source.files', () => linkedFiles(records, segments, hasDivider, false), {
    files: records.length,
  });
  if (files.length === 0 && !links?.folder) {
    return null;
  }
  const folder = links?.folder
    ? await timed('source.folder', () =>
        readFolderState(
          links.folder as LinkedFolder,
          linkedFileNames(files.filter(file => file.hasDivider).map(file => file.record.filePath)),
        ),
      )
    : null;
  const crossings = files.reduce((sum, file) => sum + file.regeneration.crossings.length, 0);
  return {links, files, orphans: segments.orphans.length, folder, crossings, basis: {segments, records, hasDivider}};
}

/**
 * Every file's dry run. Textboxes under another file's title are held back (kept at their old place
 * in their own file) unless `accept`: then every one is written where it is now and adopted there.
 */
async function linkedFiles(
  records: SourceRecord[],
  segments: FileSegments,
  hasDivider: Map<string, boolean>,
  accept: boolean,
): Promise<LinkedFile[]> {
  const lookup = new Map(records.map(record => [record.sourceId, record]));
  const held = accept ? new Map<string, Set<number>>() : heldElsewhere(segments, new Map(records.map(record => [record.sourceId, record.adopted ?? []])));
  const files: LinkedFile[] = [];
  for (const record of records) {
    const segment = segments.bySource.get(record.sourceId) ?? [];
    const options: CrossingOptions = {accept, elsewhere: held.get(record.sourceId), lookup};
    files.push(await linkedFile(record, segment, hasDivider.get(record.sourceId) ?? false, options));
  }
  return files;
}

async function linkedFile(
  record: SourceRecord,
  segment: SourceItem[],
  hasDivider: boolean,
  options: CrossingOptions,
): Promise<LinkedFile> {
  const regeneration = regenerateSource(record, segment, options);
  // Adopted ids are kept in the record when the file is written.
  const adopted = [...new Set([...(record.adopted ?? []), ...regeneration.adoptedIds])];
  const diff = fileDiff(regeneration, record);
  const current = await readTextFileIfExists(record.filePath).catch(() => null);
  const state = fileState({
    differs: diff.differs,
    current,
    record,
    onNote: hasDivider || regeneration.present,
  });
  return {
    record: adopted.length > 0 ? {...record, adopted} : record,
    segment,
    regeneration,
    diff,
    state,
    hasDivider,
    options,
  };
}

/** Whether Update would write the folder's `index.txt` (only when it didn't change in Obsidian). */
export function indexToWrite(note: LinkedNote | null): boolean {
  return note?.folder?.index === 'stale';
}

/** Files that Update / an Apply would write. */
export function filesToWrite(note: LinkedNote | null): LinkedFile[] {
  // Files with textboxes of other files waiting count too: Update asks about them first.
  if (note && note.crossings > 0) {
    return note.files.filter(file => isWritable(file.state) || file.regeneration.crossings.length > 0);
  }
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

/** "Can write here (host copy), probe deleted." — for the Files tab. */
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
      /** Whether `index.txt` was written. */
      index: boolean;
    }
  | {kind: 'confirm'; pending: PendingRemoval[]; moves: PendingMove[]};

/** Textboxes of one file now under another file's title, waiting for Move / Keep apart. */
export type PendingMove = {from: string; to: string; count: number; names: string[]; titleGone: boolean};

/** The note's crossings, grouped by the file they came from and the file they are under now. */
function pendingMoves(note: LinkedNote): PendingMove[] {
  const name = (sourceId: string) => {
    const file = note.files.find(item => item.record.sourceId === sourceId);
    return file ? sourceFileName(file.record) : 'another file';
  };
  const moves = new Map<string, PendingMove>();
  for (const file of note.files) {
    for (const crossing of file.regeneration.crossings) {
      const key = `${crossing.from}>${file.record.sourceId}`;
      const move = moves.get(key) ?? {
        from: name(crossing.from),
        to: sourceFileName(file.record),
        count: 0,
        names: [],
        titleGone: !note.basis.hasDivider.get(crossing.from),
      };
      move.count++;
      move.names.push(crossing.name);
      moves.set(key, move);
    }
  }
  return [...moves.values()];
}

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
  return {record, regeneration: regenerateSource(record, file.segment, file.options)};
}

/**
 * Writes every file of the note that changed here (or only those in `only`). Textboxes moved under
 * another file's title, and protected blocks deleted on the page, make the write stop and ask once
 * for all files (`confirm`), unless answered: `moves` 'move' writes the textboxes where they are now
 * (and remembers that), 'keep' leaves them in their own files this time.
 */
export async function writeLinkedFiles(params: {
  notePath: string;
  pageCount: number;
  only?: string[];
  protectedAnswer?: 'remove' | 'keep';
  movesAnswer?: 'move' | 'keep';
  /** Also overwrite an `index.txt` changed in Obsidian (Files → Rewrite index.txt). */
  rewriteIndex?: boolean;
}): Promise<FilesWriteResult> {
  const read = await readLinkedNote(params.notePath, params.pageCount, true);
  if (!read) {
    throw new Error('The note has no linked files any more.');
  }
  const moves = pendingMoves(read);
  const note =
    moves.length > 0 && params.movesAnswer === 'move'
      ? {
          ...read,
          crossings: 0,
          files: await linkedFiles(read.basis.records, read.basis.segments, read.basis.hasDivider, true),
        }
      : read;
  const chosen = note.files.filter(file => !params.only || params.only.includes(file.record.sourceId));
  const targets = chosen.filter(file => isWritable(file.state));
  const pending = targets
    .filter(file => file.regeneration.pendingRemoval.length > 0)
    .map(file => ({
      sourceId: file.record.sourceId,
      fileName: sourceFileName(file.record),
      blocks: file.regeneration.pendingRemoval,
    }));
  if (moves.length > 0 && !params.movesAnswer) {
    return {kind: 'confirm', pending: [], moves};
  }
  if (pending.length > 0 && !params.protectedAnswer) {
    return {kind: 'confirm', pending, moves: []};
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
  let index = false;
  const state = note.folder;
  if (
    note.links &&
    state?.folder.ordered &&
    (state.index === 'stale' || (state.index === 'changedOutside' && params.rewriteIndex))
  ) {
    try {
      await writeIndexFile(note.links, state.wantedIndex);
      index = true;
    } catch (error) {
      console.warn('[SourceLink] index not written', String(error));
      skipped.push({name: INDEX_FILE, reason: error instanceof Error ? error.message : String(error)});
    }
  } else if (state?.index === 'changedOutside') {
    skipped.push({name: INDEX_FILE, reason: 'changed in Obsidian: Files → Rewrite index.txt'});
  }
  if (moves.length > 0 && params.movesAnswer === 'keep') {
    warnings.push(`${plural(moves.reduce((sum, move) => sum + move.count, 0), 'block')} under another file's title stayed in their own files.`);
  }
  return {kind: 'written', written, unchanged, skipped, warnings, index};
}

/** Folder mode: keep the order in `index.txt` (ordered) or not; the file itself stays either way. */
export async function setFolderOrdered(notePath: string, ordered: boolean): Promise<void> {
  const links = await readNoteLinks(notePath);
  if (links?.folder) {
    await writeNoteLinks(withFolder(links, {ordered}));
  }
}

/** Folder mode: files the user chose to leave out, or takes back (`leave: false`). */
export async function setFilesLeftOut(notePath: string, names: string[], leave: boolean): Promise<void> {
  const links = await readNoteLinks(notePath);
  if (!links?.folder) {
    return;
  }
  const lower = new Set(names.map(name => name.toLowerCase()));
  const kept = links.folder.skipped.filter(name => !lower.has(name.toLowerCase()));
  await writeNoteLinks(withFolder(links, {skipped: leave ? [...kept, ...names] : kept}));
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
    return result.moves.length > 0
      ? 'Text was moved under another file\'s title: answer the question on the card first.'
      : 'Protected blocks were deleted on the page: answer the question on the card first.';
  }
  const parts: string[] = [];
  if (result.written.length === 1) {
    parts.push(`${result.written[0]} updated`);
  } else if (result.written.length > 1) {
    parts.push(`${plural(result.written.length, 'file')} updated`);
  }
  if (result.index) {
    parts.push(result.written.length > 0 ? 'index.txt too' : 'index.txt updated');
  }
  if (result.written.length === 0 && !result.index && result.unchanged.length > 0) {
    parts.push(result.unchanged.length === 1 ? `${result.unchanged[0]} is up to date` : 'All files are up to date');
  }
  if (result.skipped.length > 0) {
    const first = result.skipped[0];
    parts.push(
      result.skipped.length === 1
        ? `${first.name} not written (${first.reason})`
        : `${result.skipped.length} not written (${first.name}: ${first.reason}, …) — see Files`,
    );
  }
  if (parts.length === 0) {
    parts.push('Nothing to write');
  }
  const warnings = result.warnings.length;
  return `${parts.join(' · ')}${warnings > 0 ? ` · ${plural(warnings, 'warning')}, see Files` : ''}.`;
}
