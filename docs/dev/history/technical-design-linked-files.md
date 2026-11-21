# Technical design: Linked files — many files per note, files mode and folder mode

Status: **approved 2026-11-21; L1–L4 and the confirmation of cross-file moves built (As built below); "New file from the note" (§5) dropped for now.** Requirements agreed in conversation 2026-11-20/21 (claude.ai project document `claude/requirements-linked-files.md`): two modes (files: files added one by one from any folder; folder: exactly one folder, no subfolders); every file starts with its name as a NOTE title; per-file write-back; in folder mode an `index.txt` (plain `[[links]]`, owned by the plugin) for ordered folders, chosen at setup, switchable later in Details; modes stay fixed.

**Built on:** the Source link (`technical-design-source-link.md`, R1–R3).

**Guiding rule:** reuse the source link's core unchanged where it fits, replace the one part that doesn't scale (the page-range rule) instead of adding a second one, and delete what the new model makes unused in the same commit. No migration code beyond one small fallback for notes linked before dividers existed (§1.2).

## 0. What the source link gives us (and what was in the way)

| Piece | Reused | Changed | In the way |
|---|---|---|---|
| `domain/sourceBlocks.ts` (parse, summary, `blockName`, placeholders) | ✓ | | |
| `domain/sourceRecord.ts` (`SourceRecord`, ids, `copyPath`) | ✓ | | |
| `domain/sourceExport.ts` (`regenerateSource`, `fileDiff`, warnings, protected handling) | ✓ | gets the file's **segment** instead of a page range | `linkedRange`: untagged text between two files' pages counted for both |
| `domain/blockTag.ts` | ✓ | `k` gains `'f'` (divider) and `'t'` (title) | |
| `storage/sourceStore.ts`, `storage/sourceFile.ts` | ✓ | temp-file writing shared with `blockStatusStore.ts` | |
| `actions/sourceLink.ts` | write path per file ✓ | all linked files of the note; write per file | "the source with most tags" |
| `actions/textImport.ts` | ✓ | list of files; divider per file | single path |
| `useSourceLink.ts`, Details "Source file", button states, "Also update" | logic ✓ | plural, per-file rows | one `linked` |
| Outline (`sectionOf`, `checkRebuild`, `applyOutlinePlan`) | ✓ | file sections; our titles no blocker, rebuilt after an apply | every NOTE title blocks |
| Kept GTD `noteTitles.ts`, `headingText` | ported | | |

## 1. Model

### 1.1 Tags

`BlockTag.k`: `'x'` protected placeholder · **`'f'` file divider** (a textbox; `s` = source id, no `i`) · **`'t'` file title** (the NOTE title element over a divider; `s` = source id). Title elements carry the tag in their `userData`.

### 1.2 Segments instead of page ranges — `domain/fileSegments.ts`

`segmentByFile(items)`: each file's textboxes from its divider (left out) to the next divider, files in note order, textboxes before the first divider as `orphans`. Reading order is the scan's. **Fallback** for notes linked before dividers: exactly one file with tags but no divider owns the textboxes before the first divider (on its pages; As built). `regenerateSource(record, segment)`: `linkedRange` goes. A tagged textbox of another file inside a segment (moved across a divider) is new text there (`movedIn`) until L5 adds the confirmation (§6).

### 1.3 The note's links — `domain/noteLinks.ts`

```ts
type NoteLinks = {
  version: 1; notePath: string; mode: 'files' | 'folder';
  sources: string[];                       // source ids linked to this note (as added)
  folder?: {path: string; ordered: boolean; skipped: string[]; seen: string[];
            indexText: string | null; indexFingerprint: string | null};   // L3
};
```

Stored as `<pluginDir>/sources/note-<key>.json`. Pure helpers for L3: `fileName` validation (no `/ \ : * ? " < > |`, not `index`, not empty, ≤ 120 chars), `indexText(names)`, `indexLinks(text)` (last path part of `[[a/b|alias]]`), `newFiles`, `startOrder`. The record holds what isn't on the pages (mode, folder, ordered, skipped/seen, index fingerprint); a note with dividers but no record is read as files mode.

### 1.4 File state — `domain/fileState.ts`

In sync · changed here · changed in Obsidian · changed on both · not found · not on the note · new (started on the note, never written). The card and the write both use it, so they agree: only "changed here" and "new" are written.

### 1.5 Titles — `supernote/noteTitles.ts`, `domain/fileTitles.ts`, `actions/fileTitles.ts`

`planFileTitles(pageElements)`: every divider gets exactly one of our titles covering it; ours covering no divider of their file are removed; foreign titles are never touched. `syncFileTitles(notePath, pages)` carries it out — **one idempotent function** after an import, an Outline apply, "Make file title" and Restore titles. Title style: `import.fileTitleStyle` (1–4, default 1). Divider: the `#` style, the file name without `.txt`.

## 2. Import

### 2.1 Settings and screens (L3)

`importSettings` gains `folderPath` and `source: 'file' | 'folder'`. The Import screen offers File · Folder on a note without links; on a linked note "Add a file" (files mode) or "Add new files" (folder mode). Folder choice: pick any file, then "Use its folder". **Folder setup** (`screens/import/FolderSetupScreen.tsx`, paged): file rows with checkbox, size and block count; order (index.txt found → ordered by it, the plugin rewrites it from now on; else Ordered / Unordered, ordered starting by name or date); totals; Import. `storage/folderFiles.ts` `listTextFiles(folder)` via `RNFS.readDir`.

### 2.2 Planning many files — `actions/textImport.ts`

One divider block per file before its blocks; one record per file, then the note record, **before** inserting. Adding to a linked note goes after the last page. After the insert `syncFileTitles` on the dividers' pages, then a save. **Ordered folder, new files:** added at the end, then the Outline opens with the first new file's divider selected and its ← targets ("Where does *Intro* go?"); the normal Outline apply places it. No separate placement screen.

## 3. Manuscript: many files

### 3.1 `actions/linkedFiles.ts` (from `sourceLink.ts`)

`readLinkedNote(notePath, pageCount, fresh)` → `{links, files: LinkedFile[], orphans}` with per file record, segment, regeneration, diff, state. `writeLinkedFiles({notePath, pageCount, only?, protectedAnswer?})`: one fresh scan; the files to write; protected blocks pending in any of them → one question for all; then per file the source link's write body (`writeOneFile`: check unchanged outside, original and previous copies, write, read back, record). L3: `index.txt` after the files when the order or set of files changed. Save as copy / Save to EXPORT / Unlink per file.

### 3.2 `useLinkedFiles` (from `useSourceLink.ts`)

Same structure; header context: the file's name or "n files" (L3: "Zettelkasten · 14 files"); primary "Apply n edits" + "Also update changed files" · "Update n files" · status "All files are up to date"; the protected question names the files.

### 3.3 Details → Linked files (`screens/manuscript/FilesSection.tsx`)

File rows (paged) with state; the chosen file's part (where, imported, last written, counts, warnings, Save as copy, Save to EXPORT, Check write access, Unlink); Restore titles. L3: the folder part (Ordered/Unordered switch, "n new files — Add", "index.txt changed in Obsidian — Rewrite index.txt", "n files not in this note — Add back").

## 4. Outline

`OutlineBlock.kind` `'file' | 'heading' | 'paragraph' | 'placeholder'`; `sectionOf` by rank (file 0, heading 1): a file moves with its whole segment, a heading with its section. Filter **Files**. `checkRebuild`: our titles are no blocker; `applyOutlinePlan` then `syncFileTitles` on the touched pages. "New file here" later.

## 5. New file from the note (folder mode)

Textbox Tools panel: **Make file title** (one textbox selected in a folder-mode note): its text is the file name (checked, not existing, not linked); preview "Creates Intro.txt in Zettelkasten at the next update"; Apply → record with `original: ''` (state new), the divider tag on the textbox, `syncFileTitles`. The write needs nothing new (a missing file is written as new). Ordered: the next index write includes it.

## 6. Cross-file moves (L5)

A foreign-tagged textbox in a segment becomes `movedIn` on the target and missing in its source. The write's question gains a second kind: "1 block moved from *A* to *B*. Move it in the files too?" **Move** (target writes it with its source block's serialization, the source counts it missing) · **Put back** (target ignores it, source writes it near its old place, as protected blocks are kept).

## 7. Steps

1. **L1 Segments and dividers** and **L2 Many files, files mode** — together. Device: a single import gets its title (table of contents readability); an old linked note still writes correctly; titles survive a save and a page change; three files from two folders; edit two → "Update 2 files"; change one in Obsidian → named, the others written; delete one outside → Not found; Outline moves on pages with titles.
2. **L3 Folder mode** and **L4 Outline with files** — together. Device: folder listing in Document and the sync folder; ~30 files timing; `index.md` in Obsidian; a file section moved → title and index follow.
3. **L5 New file from the note + cross-file moves.** Device: the new file in Obsidian as `.md`; a moved paragraph after Move.

Later: Reload from file; Outline "New file here"; vault-path links in `index.txt`.

## 8. Tests (Jest)

`fileSegments` (order, orphans, fallback, second divider); `sourceExport` on segments (byte-identical untouched, moved-in text, `present`); `fileState` (the table); `fileTitles` (insert, keep, moved, foreign, coverage rule); `noteLinks` (round trip; L3: names, index, new files, start order); import blocks with dividers and summaries added up; L4: file sections in `outlinePlan`.

## 9. Open points

- **P1** Can `RattaFileSelector` select a folder? Not needed (pick a file → "Use its folder").
- **P2** Our titles: kept through save, page change, NOTE edits of the covered textbox, lasso moves? `syncFileTitles` matches by rectangle, so a lost tag only means a replaced title.
- **P3** `RNFS.readDir` in Document and the sync folder.
- **P4** Reading ~30 files when the card opens (`source.files` timing).
- **P5** Table-of-contents readability of a title over the `#`-sized divider.
- **P6** NOTE's title styles 1–4 are looks, not levels: all file titles use one style.

## As built

**L1 + L2 (one step, one commit).** 375 Jest tests (362 before).

- **Tags:** `BlockKind` `'x' | 'f' | 't'`; `dividerTag` / `titleTag` build the divider's and the title's tags.
- **Segments** (`domain/fileSegments.ts`): `segmentByFile(items)` without a second parameter; it finds the files without a divider itself. The fallback for notes linked before dividers existed keeps their old reading exactly: the one such file owns the textboxes before the first divider **on the pages from its first to its last tag** (so text on other pages of such a note stays outside the file, as before). `orphans` are the rest before the first divider; Details counts them.
- **`regenerateSource`** gets the segment; `linkedRange` and `range` are gone; `present` says whether a textbox of the file is left. A textbox of another linked file in the segment is new text here (`counts.movedIn`), a placeholder of another file is left out; set-aside blocks of any file are left out.
- **Note record:** `domain/noteLinks.ts` with `mode` and `sources` only (the folder part comes with L3); stored by `storage/sourceStore.ts` (`readNoteLinks`, `writeNoteLinks`) as `sources/note-<fingerprint of the note path>.json` (no separate `noteLinkStore.ts`). `storage/jsonFile.ts` `writeTextAtomic` replaces the temp-file code of `sourceStore.ts` and `blockStatusStore.ts`.
- **File state** (`domain/fileState.ts`): `inSync`, `changedHere`, `changedOutside`, `changedBoth`, `notFound`, `notOnNote`, `new`; `isWritable` (changed here, new). All files' current texts are read when the card reads the note (`source.files` timing; P4).
- **Titles:** `supernote/noteTitles.ts` `insertTitles` (Kept GTD's way); `domain/fileTitles.ts` `planFileTitles` matches by rectangles only (half of the smaller one), not by `controlTrailNums`; `actions/fileTitles.ts` `syncFileTitles(notePath, pages)`. `textboxScan.ts` still calls `getTitles` itself (not needed for this step). Setting `import.fileTitleStyle` (1–4, default 1), not shown on a screen yet.
- **Import:** blocks keep `sourceIndex` and gain `sourceFile` and `divider` (instead of a `source` object); `sourceImportBlocks(blocks, structure, {index, divider})` puts the divider (the `#` style, the file name without `.txt`) first. `readImportText` reads a list of paths (one for now; L3 passes the folder's files). The records and the note record are written before the insert; after it, `syncFileTitles` on the dividers' pages and a save; a failed title doesn't undo the import ("Details → Restore titles").
- **Adding to a linked note:** no `endOfNote` insert mode: a note with a note record gets the import as `afterCurrentPage` with its last page as the current page, always linked, in paragraph boxes (`importTarget`, `effectiveSettings`). The Import screen says "Add a file to this note" and hides Layout and Link. A file already linked to the note is refused.
- **Manuscript:** `actions/linkedFiles.ts` (`readLinkedNote`, `writeLinkedFiles`, `saveFileCopy`, `unlinkFile`, `restoreFileTitles`), `useLinkedFiles.ts`. One file: "Update Essay.txt · n changed blocks" and "Also update Essay.txt" as before; several: "Update n files", "Also update changed files". The status names files held back. Details → Linked files (`FilesSection.tsx`): four rows a page, the chosen file's part below, Restore titles (reads every page).
- **Outline (part of L4, done now so linked notes don't lose moves):** our titles are no blocker; after an apply `syncFileTitles` runs on the touched pages. Moving a file's section as a whole, file rows and the Files filter stay in L4.

**L3 + L4 (one step, one commit).** 380 Jest tests.

- **Folder record:** `LinkedFolder` (`path`, `ordered`, `skipped`, `indexText`, `indexFingerprint`) in `NoteLinks.folder`; no `seen` list: new files are the folder's `.txt` files that are neither linked nor left out (`newFiles`). Helpers in `domain/noteLinks.ts`: `indexText`, `indexLinks`, `startOrder`, `newFiles`, `baseName`, `fileNameProblem` (for L5), `withFolder`.
- **Import:** no `folderPath`/`source` settings. The Import screen's "This file · Whole folder" is screen state (`useTextImport`); "Whole folder" reads the chosen file's folder (`actions/folderLink.ts` `readImportFolder`) and opens `FolderSetupScreen` under "Files and order". A folder with an `index.txt` starts ordered by it, otherwise unordered (the user switches). `performTextboxImport(settings, options, folder)` imports the chosen files in order; the linking code moved to `actions/importLinking.ts` (records, note record with the folder, tags, titles, the first `index.txt`), which keeps `textImport.ts` near 500 lines.
- **Refused:** a folder into a note that has linked files; a single file into a folder-bound note (it says to add new files from Details).
- **New files** are added from Manuscript → Details (`addLinkedFiles`, after the last page), not from the Import screen. The card's note info is read once when it opens, so after adding it only closes ("Open Manuscript again to move them to their place (Outline ←)"); the Outline then moves the new file's section like any file. No automatic placement step.
- **Card:** `readLinkedNote` adds `folder: FolderState` (new files, left out, index state `inSync` / `stale` / `changedOutside`, the wanted index). `writeLinkedFiles` writes `index.txt` after the files when it is stale, and a changed-in-Obsidian one only with `rewriteIndex`. Header "Zettelkasten · 14 files"; "Update index.txt" when only the order changed; the status line names new files and a changed index. Details: Ordered / Unordered, the index line with Rewrite index.txt, New: … Add n / Leave out, Left out: … Take back.
- **Outline (L4):** `OutlineBlock.fileSource`; `sectionOf` ranks a divider (0) above a heading (1), so a file moves with all its text and a heading's section ends at the next file; `canRemove` keeps a divider from being set aside or deleted alone. Rows show `§` (an emoji may not be in the device font). No Files filter: the planned Outline redesign (claude.ai project document `claude/ideas-outline-sections.md`) replaces the filters.

**Cross-file moves (§6, without the rest of L5).** 383 Jest tests.

- `regenerateSource(record, segment, options)`: a textbox of another file in the segment is held back by default (`crossings`), and its own file keeps the block at its old place (`elsewhere`, `counts.heldBack`). With `accept`, or its tag id in the target record's `adopted`, it is written in the target as its own file wrote it (a heading with its #s, a placeholder as its original text) and is missing in its own file.
- `fileSegments.ts` `heldElsewhere` finds the held blocks per file; `linkedFiles.ts` keeps the dry run's basis and makes it again with `accept` when the user answers Move. The first write after "Move" stores the adopted ids in the target's record, so the same move isn't asked again; moved back on the page, the block simply belongs to its own file again.
- One question per write, moves before protected blocks: "… of A is now under B. Move it to B in the files too?" **Move it** · **Keep apart**; a deleted file title reads "The title of A was deleted, so its text now belongs to B. Move it into B? (A stays as it is.)" — A isn't written then (its title is gone), so its file keeps its text.
- Files with waiting moves make Update show even when nothing else changed; the status line counts them.
- Import's file selector starts in the folder of the current note.
