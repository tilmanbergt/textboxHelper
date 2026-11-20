# Technical design: Source link — small Obsidian round trip

Status: **decided 2026-11-20 (§9); built in R1–R3, see As built.** Builds on the Manuscript card
(`technical-design-manuscript.md`, `technical-design-manuscript-cache.md`). Built on `main`
`abf2737`, branch `feature/source-link`.

## 0. Goal and scope (Tilman, 2026-11-20)

Round trip, small: **import a text file (e.g. synced from Obsidian) → edit it with pen marks in
Manuscript (or directly in the textboxes) → write it back to the same file.** Write-through while
reviewing: every Apply in Manuscript also updates the file right away (unless unticked for that
Apply).

- **In:** `.txt` files from **anywhere on the device** (not only INBOX), written back to the same
  place; headings (`#`…`######`) and paragraphs editable; lists editable as plain text;
  frontmatter kept untouched (not placed on the page); **everything else is a protected block:
  moved like any block, never edited, written back exactly as it was** (§2.5).
- **Out:** lists as structure, editing protected blocks, shelf, desk card, three-way merge, `.md`
  files.
- **Principle:** the note is the truth; the file is **regenerated from the note and the original
  text** every time it is written. So any change to the textboxes (marks, typing into a textbox
  in NOTE, lasso split/join, Outline moves) ends up in the file without each tool knowing about
  files.
- **Safety rule:** nothing leaves the file silently. What can't be edited safely is protected;
  deleting a protected block asks once; whatever might have gone wrong is said in a warning.

## 1. What was there

- Import (`actions/textImport.ts`, `domain/importParsing.ts`, `importPlan.ts`,
  `blockPagination.ts`, `supernote/noteTextInsertion.ts`): layout
  `'continuous' | 'paragraphTextboxes'`, separator `blankLine | line`, `#`–`###` headings with
  styles; a paragraph too tall for a page is cut at words into several textboxes; insert with
  `createElement(500)` + file-API `insertElements` + save.
- File choice: `supernote/fileSelector.ts` limited to INBOX; `importSettings.filename` relative to
  INBOX.
- Manuscript: Review of the whole note, Outline with block tags `tbt:b:` (`domain/blockTag.ts`,
  already with the source fields `s/i/p`), an in-memory cache of what was read.
- File writing: `storage/exportFile.ts` (temp file + `FileUtils.copyFile` into EXPORT).

## 2. Model

### 2.1 Source blocks (`domain/sourceBlocks.ts`, pure)

`parseSourceBlocks(text) → {eol, frontmatterEnd, blocks, summary}`; a block has `index`, `role`
(`heading | paragraph | list | protected`), `level` (heading 1–6), `protectedKind`, its span
`start…end` in the original text, and `text` (what goes into the textbox).

- Frontmatter: the file starts with `---` and a closing `---` line; not a block.
- Blocks are separated by blank lines, except inside fenced code, `$$` math and `%%` comments
  (they run to their closing line, or to the end of the file when unclosed). A `#` line is a
  heading block on its own; a heading or a code fence also ends the block before it.
- **List:** first line starts with `-`, `*`, `+`, `1.`/`1)` (after optional indentation). Kept
  exactly as text.
- **Protected:** code, math, tables (`|`), quotes and callouts (`>`), HTML (`<`), `%%` comments,
  blocks of only `![[…]]` embeds, horizontal rules. Their textbox text is a label like
  `⟦Table · 5 rows · kept as is⟧`.
- Paragraph text keeps its line breaks, so untouched text compares exactly.
- **Invariant (tested):** everything outside the frontmatter and the spans is whitespace.

### 2.2 Tag (`domain/blockTag.ts`)

`tbt:b:{"v":1,"id":"b-…","s":"<sourceId>","i":12,"p":0}`; protected placeholders carry
`"k":"x"`. `p` numbers the pieces of a paragraph the import cut (joined with a space).

### 2.3 Source record (`domain/sourceRecord.ts` pure, `storage/sourceStore.ts`)

`<pluginDir>/sources/<sourceId>.json`: `filePath` (absolute), `notePath`, `importedAt`, the
`original` text, `eol`, `frontmatterEnd`, `blocks`, `removedProtected`, `lastWrittenAt`,
`lastWrittenText`, `fileFingerprint` (`domain/fingerprint.ts`, FNV-1a + length). Written before
the textboxes are inserted.

### 2.4 Regenerating the file (`domain/sourceExport.ts`, pure)

Input: the record and the note's textboxes in reading order (`page`, `text`, `tag`). Linked range
= first to last page holding a tag of this source; textboxes of another linked file are skipped.

1. Consecutive textboxes of the same block form one group (the import's pieces).
2. Protected placeholder → original span. Tagged and text unchanged (line ends and both ends
   trimmed), first occurrence → original span. Tagged and changed → its text (heading with `#`s).
   The same block again later → its text at that place. Untagged → new text as typed.
3. Editable blocks not seen → missing. Protected blocks not seen → removed when in
   `removedProtected`, else **pending removal**: kept right after the nearest earlier block of the
   file that is in the output, and the write asks first.
4. Separators: the original text between two untouched neighbours of the file, else one blank
   line. Frontmatter and leading whitespace first, the original's tail last, line endings as
   `eol`.
5. `fileDiff(result, record)`: does the result differ from what was last written (or the
   original), and how many blocks changed — for the "Update file" button.

### 2.5 Protected blocks

Placeholder textbox (italic, framed); moved like any block, never edited (marks on it are
ignored); written back at the placeholder's place. **Deleted → removed after a confirmation:** the
first write after its placeholder is gone asks "Remove … from Essay.txt too?" (**Remove** /
**Keep it**, or **Remove all** / **Keep all** for several). Remove → `removedProtected`, not
asked again; Keep → written back near its old place, asked again next time. A copied placeholder
is written once.

### 2.6 Warnings

Protected block kept near its old place / copy left out; list indentation changed in an edited
list; a link may be broken (`[[`/`]]`/`](`/backtick counts changed or unbalanced in an edited
block); missing blocks. Warnings never stop the write; only a protected removal asks.

## 3. Import

- **Any `.txt` on the device:** the file selector without `limitPath`, opening in the folder of
  the last file (else INBOX); `importSettings.filename` holds the absolute path; an older value
  relative to INBOX is read as `INBOX/<path>`.
- In layout **Paragraph boxes**, a checkbox **"Link to file (write changes back)"** (default on).
  Linked: the source blocks replace the paragraph parsing (blank lines always separate, headings
  always recognized; levels 4–6 use the `###` style), placeholders are italic and framed, the
  preview header shows what the file contains ("Kept as is: …"), the record is written before
  the textboxes, every textbox carries its tag.

## 4. Manuscript: the file slot

The card finds its source by the tags of the note (the Outline's scan; most frequent `s`).

- **Header context** names the file.
- **File check on open:** after the current page is shown, the scan runs in the background and
  regenerates the file as a dry run.
- **Primary button (Review tab):** marks waiting → "Apply n edits" with the checkbox **"Also
  update <file>"** next to it (on every time the card opens, not remembered); no marks but the
  note differs from the file → **"Update <file> · n changed blocks"**; nothing differs → the status
  says the file is up to date.
- Every write goes through one path: protected-removal confirmation, conflict check, write,
  warnings in the status.
- **Details → Source:** file, folder, imported, last written, state, counts, warnings, **Save as
  copy**, **Unlink**, **Check write access**.

## 5. Writing the file (`actions/sourceWrite.ts`, `storage/sourceFile.ts`)

1. Scan the note, regenerate. No tag of the file left → nothing is written.
2. Pending protected removals → the confirmation first.
3. Read the file: missing → written new; fingerprint ≠ `fileFingerprint` → not overwritten
   ("changed outside since the last write — Save as copy").
4. Before the first write a copy of the original goes to `<pluginDir>/sources/<id>-original.txt`.
5. Write: through a temporary file and the host's `FileUtils.copyFile` (the way EXPORT is
   written), then read back and compared; if that fails, written directly with `react-native-fs`.
6. Save as copy: `<name> (Supernote <yyyy-mm-dd HHmm>).txt` next to the original.

**Check write access** (Details) writes, reads back and deletes `.textbox-tools-probe.txt` in the
file's folder. No write access → the footer says so and Details offers **Save to EXPORT**.

## 6. Steps

1. **R1 Pure core:** `sourceBlocks`, `blockTag` (`k`), `fingerprint`, `sourceRecord`,
   `sourceExport` + Jest.
2. **R2 Linked import, any folder:** file selector, absolute path, checkbox, content overview,
   placeholders, tags, record, Details Source section with Check write access.
3. **R3 Write-back:** file check on open, primary button states, write after Apply, protected
   removal confirmation, warnings, conflict check, Save as copy.

## 7. Tests (Jest)

`__tests__/domain/sourceLink.test.ts`: block parsing (frontmatter, headings, lists, every
protected kind, CRLF, unclosed fences, whitespace outside spans); **untouched → byte-identical**
(also CRLF, BOM, no trailing newline); edits, heading levels, split tail, join, typed markdown,
page order, import pieces, protected move / pending / removed / copy, warnings, other files and
pages left alone, CRLF for edited text; `fileDiff`; record round trip; tag `k`; fingerprint.
`importSettings` / `settingsModel` tests for absolute paths and the old INBOX-relative value.

## 8. Open points (device)

- **P1 Write access** next to the source file (Check write access).
- **P2 Tag survival** when a textbox is edited in NOTE: a lost tag makes the textbox new and its
  block missing; the text written is still right.
- **P3 Two linked files in one note:** each has its own range; the card uses the one with more
  tags.
- **P4 Folders the file selector opens** without `limitPath`.
- **P5 Leading whitespace in textboxes:** if NOTE drops it, nested lists lose their indentation
  when edited (a warning says so).
- **P6 Timing** of the file check on open (it reuses the Outline's scan and cache).

## 9. Decisions (Tilman, 2026-11-20)

1. "Also update <file>" is on by default every time, not remembered.
2. Linking only in the Paragraph boxes layout.
3. A file changed outside since the last write is not overwritten; Save as copy instead.
4. Write-back only with write permission to the source folder.
5. Import from any `.txt` on the device, written back to the same place.
6. Protected blocks: placeholder on the page, can be moved, not edited, written back exactly; they
   can be deleted, with an extra confirmation before they leave the file.
7. Lists are editable as text (markers and indentation kept).
8. Warnings for possibly broken links, changed list indentation, missing blocks; a content
   overview at import.
9. Direct textbox edits are written back with the card's "Update <file> · n changed blocks".
