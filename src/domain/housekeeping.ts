/**
 * What the plugin removes from its own folder (technical-design-housekeeping.md): done pen edits,
 * left-over pictures and broken indexes, and old backups. Pure: the listings come in, the names
 * to remove go out.
 */
import type {PenEditEntry, PenEditIndex} from './penEditModel';

export const HOUSEKEEPING_LIMITS = {
  /** Applied or dropped pen edits, folders without an entry and broken indexes. */
  penEditDays: 3,
  /** Lasso pictures left in `pen-edits/tmp/`. */
  tmpPictureHours: 24,
  /** Backups: none older than this … */
  backupDays: 14,
  /** … and at most this many. */
  backupKeep: 3,
} as const;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** One entry of a folder listing. */
export type StoredFile = {name: string; isDirectory: boolean; mtimeMs: number; size: number};

/** The folder the host writes lasso pictures into, inside `pen-edits/`. */
export const PEN_EDIT_TMP_DIR = 'tmp';

function timeOf(iso: string | null | undefined): number {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : NaN;
}

function olderThan(ms: number, limitMs: number, nowMs: number): boolean {
  // An unknown time counts as old: the file is kept only while it is known to be fresh.
  return !Number.isFinite(ms) || nowMs - ms > limitMs;
}

/** When the entry was applied or dropped; entries done before `doneAt` existed use `createdAt`. */
function doneTime(entry: PenEditEntry): number {
  const done = timeOf(entry.doneAt);
  return Number.isFinite(done) ? done : timeOf(entry.createdAt);
}

/** Applied or dropped entries whose limit has passed. Active entries are never in it. */
export function donePenEditIds(index: PenEditIndex, nowMs: number): string[] {
  const limit = HOUSEKEEPING_LIMITS.penEditDays * DAY_MS;
  return index.entries
    .filter(entry => entry.state !== 'active' && olderThan(doneTime(entry), limit, nowMs))
    .map(entry => entry.id);
}

export function withoutPenEdits(index: PenEditIndex, ids: string[]): PenEditIndex {
  if (ids.length === 0) {
    return index;
  }
  const gone = new Set(ids);
  return {...index, entries: index.entries.filter(entry => !gone.has(entry.id))};
}

/**
 * Names in `pen-edits/` to remove: entry folders whose entry is gone (kept for the limit, so a tag
 * still being written is never touched) and set-aside broken indexes. `keptIds` are the ids still
 * in the index after done entries were taken out.
 */
export function penEditFilesToRemove(listing: StoredFile[], keptIds: Set<string>, nowMs: number): string[] {
  const limit = HOUSEKEEPING_LIMITS.penEditDays * DAY_MS;
  return listing
    .filter(file => {
      if (!olderThan(file.mtimeMs, limit, nowMs)) {
        return false;
      }
      if (file.isDirectory) {
        return file.name !== PEN_EDIT_TMP_DIR && !keptIds.has(file.name);
      }
      return file.name.startsWith('index.broken-');
    })
    .map(file => file.name);
}

/** Pictures in `pen-edits/tmp/` the host wrote for a tag that never finished. */
export function tmpPicturesToRemove(listing: StoredFile[], nowMs: number): string[] {
  const limit = HOUSEKEEPING_LIMITS.tmpPictureHours * HOUR_MS;
  return listing.filter(file => !file.isDirectory && olderThan(file.mtimeMs, limit, nowMs)).map(file => file.name);
}

/** Backups beyond the newest few, and every backup older than the limit. */
export function backupsToRemove(listing: StoredFile[], nowMs: number): string[] {
  const limit = HOUSEKEEPING_LIMITS.backupDays * DAY_MS;
  const backups = listing
    .filter(file => !file.isDirectory && file.name.endsWith('.json'))
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
  return backups
    .filter((file, position) => position >= HOUSEKEEPING_LIMITS.backupKeep || olderThan(file.mtimeMs, limit, nowMs))
    .map(file => file.name);
}

export type HousekeepingResult = {files: number; bytes: number; penEdits: number; backups: number};

export const NOTHING_REMOVED: HousekeepingResult = {files: 0, bytes: 0, penEdits: 0, backups: 0};

export function addResults(a: HousekeepingResult, b: HousekeepingResult): HousekeepingResult {
  return {files: a.files + b.files, bytes: a.bytes + b.bytes, penEdits: a.penEdits + b.penEdits, backups: a.backups + b.backups};
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type PluginStorage = {files: number; bytes: number; orphanRecords: number};

/** "Plugin files: 214, 31.2 MB. 2 link records belong to notes that no longer exist." */
export function storageSummaryText(storage: PluginStorage): string {
  const base = `Plugin files: ${storage.files}, ${formatBytes(storage.bytes)}.`;
  if (storage.orphanRecords === 0) {
    return base;
  }
  const records =
    storage.orphanRecords === 1
      ? '1 link record belongs to a note that no longer exists.'
      : `${storage.orphanRecords} link records belong to notes that no longer exist.`;
  return `${base} ${records}`;
}

/** "Removed 37 files (12.4 MB)." / "Nothing to remove." */
export function housekeepingResultText(result: HousekeepingResult): string {
  if (result.files === 0) {
    return 'Nothing to remove.';
  }
  return `Removed ${result.files === 1 ? '1 file' : `${result.files} files`} (${formatBytes(result.bytes)}).`;
}
