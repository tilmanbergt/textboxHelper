import {buildPenEditDir, SOURCE_DIR_NAME} from '../domain/backupPaths';
import {
  addResults,
  donePenEditIds,
  NOTHING_REMOVED,
  PEN_EDIT_TMP_DIR,
  penEditFilesToRemove,
  tmpPicturesToRemove,
  withoutPenEdits,
  type HousekeepingResult,
  type PluginStorage,
} from '../domain/housekeeping';
import {parseSourceRecord} from '../domain/sourceRecord';
import {
  fileExists,
  folderStats,
  listFolder,
  pluginFolder,
  pruneBackups,
  readTextFile,
  removeFromFolder,
} from '../storage/housekeepingStore';
import {changePenEditIndex} from '../storage/penEditStore';

/**
 * Housekeeping (technical-design-housekeeping.md): removes done pen edits, left-over pictures,
 * broken indexes and old backups from the plugin folder. Never throws; every part that fails is
 * logged and the rest still runs.
 */

async function prunePenEdits(nowMs: number): Promise<HousekeepingResult> {
  let removedIds: string[] = [];
  const index = await changePenEditIndex(current => {
    removedIds = donePenEditIds(current, nowMs);
    return withoutPenEdits(current, removedIds);
  });
  const dir = buildPenEditDir(await pluginFolder());
  const keptIds = new Set(index.entries.map(entry => entry.id));
  const listing = await listFolder(dir);
  const present = new Set(listing.map(file => file.name));
  // A done entry's folder goes with it, whatever its age; other strays wait for the limit.
  const names = [
    ...removedIds.filter(id => present.has(id)),
    ...penEditFilesToRemove(listing, keptIds, nowMs).filter(name => !removedIds.includes(name)),
  ];
  const folders = await removeFromFolder(dir, names);
  const tmpDir = `${dir}/${PEN_EDIT_TMP_DIR}`;
  const pictures = await removeFromFolder(tmpDir, tmpPicturesToRemove(await listFolder(tmpDir), nowMs));
  return {
    files: folders.files + pictures.files,
    bytes: folders.bytes + pictures.bytes,
    penEdits: removedIds.length,
    backups: 0,
  };
}

async function safely(part: string, job: () => Promise<HousekeepingResult>): Promise<HousekeepingResult> {
  try {
    return await job();
  } catch (error) {
    console.warn('[Housekeeping] part failed', JSON.stringify({part, error: String(error)}));
    return NOTHING_REMOVED;
  }
}

export async function runHousekeeping(nowMs: number = Date.now()): Promise<HousekeepingResult> {
  const penEdits = await safely('pen edits', () => prunePenEdits(nowMs));
  const backups = await safely('backups', () => pruneBackups(nowMs));
  const result = addResults(penEdits, backups);
  console.log('[Housekeeping] done', JSON.stringify(result));
  return result;
}

let ranInThisContext = false;

/** Runs once per JS context (the Manuscript card calls it after opening). */
export async function runHousekeepingOnce(): Promise<void> {
  if (ranInThisContext) {
    return;
  }
  ranInThisContext = true;
  await runHousekeeping();
}

/** Link records (not the notes' link lists) whose note no longer exists. */
async function orphanRecordCount(root: string): Promise<number> {
  const dir = `${root}/${SOURCE_DIR_NAME}`;
  let count = 0;
  for (const file of await listFolder(dir)) {
    if (file.isDirectory || !file.name.endsWith('.json') || file.name.startsWith('note-')) {
      continue;
    }
    try {
      const record = parseSourceRecord(await readTextFile(`${dir}/${file.name}`));
      if (record && !(await fileExists(record.notePath))) {
        count += 1;
      }
    } catch (error) {
      console.warn('[Housekeeping] record not read', JSON.stringify({file: file.name, error: String(error)}));
    }
  }
  return count;
}

/** The plugin folder's files and size, for Settings → Diagnostics. */
export async function pluginStorage(): Promise<PluginStorage> {
  const root = await pluginFolder();
  const stats = await folderStats(root);
  return {...stats, orphanRecords: await orphanRecordCount(root)};
}
