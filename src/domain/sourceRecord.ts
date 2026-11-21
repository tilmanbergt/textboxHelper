/**
 * The record of a linked text file (technical-design-source-link.md §2.3), stored as JSON in the
 * plugin folder: where the file is, its text at import, its blocks, what the plugin wrote last and
 * which protected blocks the user removed. Pure: building, reading and writing the JSON.
 */
import type {SourceBlock} from './sourceBlocks';

export type SourceRecord = {
  version: 1;
  sourceId: string;
  /** Absolute path of the text file. */
  filePath: string;
  notePath: string;
  importedAt: string;
  /** The file text at import. */
  original: string;
  eol: '\n' | '\r\n';
  frontmatterEnd: number;
  blocks: SourceBlock[];
  /** Protected blocks the user confirmed to remove from the file. */
  removedProtected: number[];
  lastWrittenAt: string | null;
  /** What the plugin wrote last; null before the first write. */
  lastWrittenText: string | null;
  /** Fingerprint of the file as the plugin last read or wrote it. */
  fileFingerprint: string;
};

/** A new source id: "s-" + time in base 36 + four random characters. */
export function newSourceId(now: Date, random: () => number = Math.random): string {
  const tail = Array.from({length: 4}, () => Math.floor(random() * 36).toString(36)).join('');
  return `s-${now.getTime().toString(36)}${tail}`;
}

/** The file name without its folder. */
export function sourceFileName(record: Pick<SourceRecord, 'filePath'>): string {
  return record.filePath.split('/').slice(-1)[0] || record.filePath;
}

/** The file's folder ("" for a bare name). */
export function sourceFolder(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash > 0 ? path.slice(0, slash) : '';
}

/** "Essay (Supernote 2026-11-20 1734).txt" next to the original. */
export function copyPath(filePath: string, now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}`;
  const folder = sourceFolder(filePath);
  const name = filePath.slice(folder.length + (folder ? 1 : 0));
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '.txt';
  return `${folder ? `${folder}/` : ''}${base} (Supernote ${stamp})${extension}`;
}

export function serializeSourceRecord(record: SourceRecord): string {
  return JSON.stringify(record);
}

function isBlock(value: unknown): value is SourceBlock {
  const block = value as SourceBlock;
  return (
    !!block &&
    Number.isInteger(block.index) &&
    ['heading', 'paragraph', 'list', 'protected'].includes(block.role) &&
    Number.isInteger(block.level) &&
    Number.isInteger(block.start) &&
    Number.isInteger(block.end) &&
    typeof block.text === 'string'
  );
}

/** The record in a file's text, or null when it is not one (broken, another version). */
export function parseSourceRecord(text: string): SourceRecord | null {
  try {
    const raw = JSON.parse(text) as Partial<SourceRecord>;
    if (
      raw?.version !== 1 ||
      typeof raw.sourceId !== 'string' ||
      typeof raw.filePath !== 'string' ||
      typeof raw.original !== 'string' ||
      !Array.isArray(raw.blocks) ||
      !raw.blocks.every(isBlock)
    ) {
      return null;
    }
    return {
      version: 1,
      sourceId: raw.sourceId,
      filePath: raw.filePath,
      notePath: typeof raw.notePath === 'string' ? raw.notePath : '',
      importedAt: typeof raw.importedAt === 'string' ? raw.importedAt : '',
      original: raw.original,
      eol: raw.eol === '\r\n' ? '\r\n' : '\n',
      frontmatterEnd: Number.isInteger(raw.frontmatterEnd) ? (raw.frontmatterEnd as number) : 0,
      blocks: raw.blocks,
      removedProtected: Array.isArray(raw.removedProtected)
        ? raw.removedProtected.filter(n => Number.isInteger(n))
        : [],
      lastWrittenAt: typeof raw.lastWrittenAt === 'string' ? raw.lastWrittenAt : null,
      lastWrittenText: typeof raw.lastWrittenText === 'string' ? raw.lastWrittenText : null,
      fileFingerprint: typeof raw.fileFingerprint === 'string' ? raw.fileFingerprint : '',
    };
  } catch {
    return null;
  }
}

/** The text of a file's divider on the note: its name without the `.txt`. */
export function dividerText(filePath: string): string {
  const name = filePath.split('/').slice(-1)[0] || filePath;
  return name.replace(/\.txt$/i, '');
}
