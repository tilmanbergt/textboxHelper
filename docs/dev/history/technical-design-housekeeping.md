# Technical design: Housekeeping — the plugin cleans up after itself

Status: **agreed with Tilman (limits decided).** Backlog item "Applied/dropped pen-edit entries
and their folders and old backups are never cleaned up; decide on a limit. Same for `sources/`".

## 0. Goal and scope

The plugin writes files on every tag and every write to a note and never removes them. Over weeks
this fills the device and slows the Review (the pen-edit index is parsed on every page read).
Housekeeping removes what nothing reads any more, by fixed limits, without asking.

- **In:** done pen edits and their folders, left-over lasso pictures, set-aside broken indexes,
  backups, the copies of an unlinked file, temporary export files, a storage line with a
  **Clean up now** button in Settings → Diagnostics.
- **Out:** files in EXPORT (written only when the user asks for them), the linked text files
  themselves, link records of notes that no longer exist (only counted), `block-status.json`.
- **Never removed:** an active pen edit, the newest backup, anything in a linked file's folder.

## 1. What piles up today

| Where (plugin folder) | Written | Read again | Removed today |
|---|---|---|---|
| `pen-edits/index.json` entries | every tag | only `active` ones | never |
| `pen-edits/<id>/` (`strokes.json`, `picture.png`) | every tag | only for `active` entries | only when tagging fails |
| `pen-edits/tmp/<id>.png` | by the host, before the move | no | after a successful move |
| `pen-edits/index.broken-*.json` | when the index can't be read | no | never |
| `textbox-action-backups/*.json` | before every write to a note | no (path shown once) | never |
| `sources/<id>-original.txt`, `-previous.txt` | at write-back | while linked | never (not even on unlink) |
| app Documents: DOCX / diagnostics / timings temp files | every export | no | never |

Applied and dropped entries are dead: tag numbers, page sync, the Review and the cache all look at
`active` entries only.

## 2. Limits (Tilman)

| What | Rule |
|---|---|
| Applied or dropped pen edit (entry + folder) | removed 3 days after it was applied or dropped |
| Pen-edit folder with no entry, broken index | removed when older than 3 days |
| `tmp/` picture | removed when older than 1 day |
| Backups | at most the **3 newest**, and none older than **14 days** |
| Copies of an unlinked file | removed with the link |
| Temporary export file | removed right after the copy into EXPORT |

"3 days after" needs the moment: entries get `doneAt` (ISO time) when they become applied or
dropped. Entries done before this change have none; their `createdAt` counts (they are older than
their `doneAt` would be, so they go a little sooner). An entry with neither counts as old.

Folders without an entry are kept for 3 days so a tag that is still being written (folder first,
index entry after) is never touched.

## 3. Code

- **`domain/housekeeping.ts`** (pure): `HOUSEKEEPING_LIMITS`; `donePenEditIds(index, now)`,
  `withoutPenEdits(index, ids)`, `penEditFilesToRemove(listing, keptIds, now)` (orphan folders,
  old `tmp/` pictures, broken indexes), `backupsToRemove(files, now)`, `storageSummaryText(stats)`.
  Input listings are `{name, isDirectory, mtimeMs, size}`.
- **`domain/penEditModel.ts`:** `PenEditEntry.doneAt: string | null`, parsed and written.
  `actions/penEditReview.ts` sets it in `setPenEditsState` and in the page sync's drop.
- **`storage/housekeepingStore.ts`:** list a folder (`RNFS.readDir`), remove a path, a folder's
  file count and size; `pruneBackups()` (used after every backup write).
- **`storage/backupFile.ts`:** after writing a backup, `pruneBackups()`; a failure is logged,
  never thrown (the action goes on).
- **`storage/sourceStore.ts`:** `deleteSourceRecord` also removes `-original.txt` and
  `-previous.txt`.
- **`storage/exportFile.ts`, `storage/docxExport.ts`:** remove the temporary file after the copy
  (also when the copy fails).
- **`actions/housekeeping.ts`:** `runHousekeeping()` — pen edits (index change through the
  existing serial queue, then the folders), `tmp/`, broken indexes, backups; returns what was
  removed; logs `[Housekeeping]` with counts. `pluginStorage()` — files and size of the plugin
  folder plus the number of link records whose note no longer exists. Never throws.
- **Trigger:** the Manuscript card runs `runHousekeeping()` once per JS context, a few seconds
  after it opened (after the first list), so it never competes with the first page read.
- **Settings → Diagnostics → Storage:** "Plugin files: 214, 31.2 MB. 2 link records belong to
  notes that no longer exist." and **Clean up now** (runs it, then shows "Removed 37 files (12.4
  MB).").

## 4. Tests

`__tests__/domain/housekeeping.test.ts`: done entries by `doneAt` / `createdAt` / neither; active
entries never; orphan folders by age, `tmp` itself never removed as an orphan; tmp pictures by
age; backups: 3 newest within 14 days kept, the rest removed, 5 fresh → 2 removed, all older than
14 days → all removed; summary text. `penEdits` parse test for `doneAt`.

## 5. Device check

1. Note with pen edits applied and dropped more than 3 days ago: open the card, wait a few
   seconds; `[Housekeeping]` log shows them removed; the Review is unchanged.
2. Apply a few times: `textbox-action-backups/` holds at most 3 files.
3. Settings → Diagnostics → Storage shows a line; Clean up now reports what it removed.
4. Unlink a file: its two copies are gone from `sources/`.

## As built

- As designed. Backups older than 14 days go even when that leaves none (the backup just written
  is always the newest and fresh, so after an action there is always one). A done entry's folder
  is removed with its entry whatever the folder's age.
- The Diagnostics hint states the limits; Clean up now runs the same `runHousekeeping()`.
