/**
 * Linking an import to its files (technical-design-source-link.md §3,
 * technical-design-linked-files.md §2.2): the records of the files and the note's links, written
 * before the insert; every planned textbox's tag; the file titles over the dividers after it; an
 * ordered folder's first `index.txt`.
 */

import {dividerTag, formatBlockTag, newBlockId} from '../domain/blockTag';
import {fingerprint} from '../domain/fingerprint';
import type {TextboxImportPlan} from '../domain/importPlan';
import {indexText, newLinkedFolder, newNoteLinks, withSources, type NoteLinks} from '../domain/noteLinks';
import {plural} from '../domain/plural';
import type {ParsedSource} from '../domain/sourceBlocks';
import {newSourceId, sourceFileName, type SourceRecord} from '../domain/sourceRecord';
import {readSourceRecord, writeNoteLinks, writeSourceRecord} from '../storage/sourceStore';
import {saveCurrentNoteForConsistency} from '../supernote/noteElements';
import {syncTitles} from './titleSync';
import {folderName, linkedFileNames, writeIndexFile} from './folderLink';

export type ImportFile = {
  path: string;
  /** The file as read (the record keeps it exactly). */
  raw: string;
  parsed: ParsedSource;
};

/**
 * A folder bound as a whole (technical-design-linked-files.md §2.1): its chosen files in the order
 * they go onto the note, whether the order is kept in `index.txt`, and the files left out.
 */
export type FolderImport = {
  path: string;
  names: string[];
  ordered: boolean;
  skipped: string[];
};

/** Refuses a file that is already linked to this note. */
export async function checkNotLinkedYet(links: NoteLinks | null, paths: string[]): Promise<void> {
  if (!links) {
    return;
  }
  for (const sourceId of links.sources) {
    const record = await readSourceRecord(sourceId);
    if (record && paths.includes(record.filePath)) {
      throw new Error(`${sourceFileName(record)} is already linked to this note.`);
    }
  }
}

export function linkedName(records: SourceRecord[], folder?: FolderImport): string {
  if (folder) {
    return `${plural(records.length, 'file')} of the folder ${folderName(folder.path)}`;
  }
  return records.map(sourceFileName).join(', ');
}

/** An ordered folder gets its `index.txt` right away, in the order the files went onto the note. */
export async function writeFirstIndex(links: NoteLinks, filePaths: string[]): Promise<string> {
  try {
    await writeIndexFile(links, indexText(linkedFileNames(filePaths)));
    return ' index.txt written.';
  } catch (error) {
    console.warn('[TextImport] index not written', String(error));
    return ' index.txt could not be written: Manuscript → Update writes it.';
  }
}

/**
 * Puts our NOTE titles over the imported files' dividers and the headings of the titled levels
 * (technical-design-outline-sections.md §4), and saves the note. A title that can't be written
 * doesn't undo the import: the text (and the link) are there; Details → Restore titles tries again.
 */
export async function addTitles(notePath: string, pages: {pageNumber: number}[]): Promise<string> {
  try {
    await syncTitles(notePath, pages.map(page => page.pageNumber));
    await saveCurrentNoteForConsistency('adding the titles');
    return '';
  } catch (error) {
    console.warn('[TextImport] titles not added', String(error));
    return ' The titles could not be added: Manuscript → Details → Restore titles.';
  }
}

/**
 * Writes the records of a linked import (one per file) and the note's list of linked files, and
 * gives every planned textbox its tag: a block of its file (with the piece of a block cut to fit
 * the pages and the placeholder kind), or the file's divider.
 */
export async function linkImport(params: {
  files: ImportFile[];
  plan: TextboxImportPlan;
  notePath: string;
  links: NoteLinks | null;
  folder?: FolderImport;
}): Promise<{records: SourceRecord[]; links: NoteLinks}> {
  const now = new Date();
  const records: SourceRecord[] = params.files.map(file => ({
    version: 1,
    sourceId: newSourceId(now),
    filePath: file.path,
    notePath: params.notePath,
    importedAt: now.toISOString(),
    original: file.raw,
    eol: file.parsed.eol,
    frontmatterEnd: file.parsed.frontmatterEnd,
    blocks: file.parsed.blocks,
    removedProtected: [],
    lastWrittenAt: null,
    lastWrittenText: null,
    fileFingerprint: fingerprint(file.raw),
  }));
  for (const page of params.plan.pages) {
    for (const chunk of page.chunks) {
      const record = records[chunk.sourceFile ?? 0];
      if (!record) {
        continue;
      }
      if (chunk.divider) {
        chunk.userData = formatBlockTag(dividerTag(record.sourceId, now));
        continue;
      }
      if (chunk.sourceIndex === undefined) {
        continue;
      }
      chunk.userData = formatBlockTag({
        v: 1,
        id: newBlockId(now),
        s: record.sourceId,
        i: chunk.sourceIndex,
        ...(chunk.piece ? {p: chunk.piece} : {}),
        ...(chunk.placeholder ? {k: 'x' as const} : {}),
      });
    }
  }
  for (const record of records) {
    await writeSourceRecord(record);
  }
  const {folder} = params;
  const links = withSources(
    params.links ??
      (folder
        ? newNoteLinks(params.notePath, 'folder', newLinkedFolder(folder.path, folder.ordered, folder.skipped))
        : newNoteLinks(params.notePath, 'files')),
    records.map(record => record.sourceId),
  );
  await writeNoteLinks(links);
  console.log(
    '[TextImport] linked',
    JSON.stringify({files: records.length, blocks: records.reduce((sum, record) => sum + record.blocks.length, 0)}),
  );
  return {records, links};
}

