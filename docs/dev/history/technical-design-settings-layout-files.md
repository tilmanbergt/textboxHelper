# Technical design: Settings tabs, one page layout, Clean up, Files tab

Status: **built** on `feature/linked-files` (S1–S5). Requirements: `claude/requirements-settings-layout-files.md` (claude.ai project). **Base: `feature/linked-files` at `f11efd9`** (Outline sections built). Same rules as before: reuse what is there, one source of truth, delete what goes, every file well under 1,000 lines, each step with tests, docs and deletions in the same commit.

## 0. What is there

- **Margins** live in `TextboxImportSettings` (`marginLeft/Top/Right/Bottom`, defaults 100/100/200/200) and are used only by `importPlan.ts` (`maxRect`). Fonts per role are `settings.import.structure` (`paragraph`, `heading1–3`). Gap between blocks: `blockPagination.ts` `blockGap` (default constant).
- **The Outline's re-layout** (`outlineLayout.ts` `layoutRebuild`) keeps each block's size, left edge and gap and flows forward over later pages, adding pages at the end; `outlineApply.ts` `pageFrame` guesses top and bottom from the textboxes (bottom = page height − top).
- **Linked files** are stacked continuously within one import; a file added to a linked note starts after its last page.
- **Screens:** `ImportScreen` (+ `ImportLayoutScreen`, `FolderSetupScreen`) and `ExportScreen` (+ `ExportRulesScreen`) are opened by NOTE toolbar buttons 6290 / 6300 (`App.tsx`, `index.js`); Manuscript (6280) has Review · Outline and a Details sub-screen (`ManuscriptDetailsScreen` with `FilesSection`, `HeadingsSection`, calibration, diagnostics, speed).
- SDK: `PluginFileAPI.insertNotePage` / `removeNotePage` exist (not used yet).

## 1. One page layout — `domain/pageLayout.ts` (new, pure)

```ts
export type PageLayout = {
  margins: {left: number; top: number; right: number; bottom: number};  // page px
  /** Heading levels that start a new page (linked files always do). */
  breakBefore: HeadingLevel[];
  /** Space between blocks. */
  blockGap: number;
};
export const DEFAULT_PAGE_LAYOUT = {margins: {left: 100, top: 100, right: 280, bottom: 625}, breakBefore: [], blockGap: 18};
export function textArea(page, layout): Rect;      // throws when the margins leave none
export function startsPage(block: {kind: 'file' | 'heading' | 'paragraph'; level}, layout): boolean;
```

- **Settings:** `PluginSettings.layout: PageLayout` (parsed field by field, defaults above). The four `margin*` fields leave `TextboxImportSettings`; the import's fonts and bold stay where they are (`structure`) and are what "styles" means everywhere (import, level changes, Clean up). No migration (one user): a settings file with old import margins is read with the new defaults.
- **Import:** `textImport.ts` takes `textArea(pageSize, settings.layout)` and the layout's `blockGap`; `blockPagination.ts` gets `breakBefore?: (block) => boolean` — a block for which it is true starts a new page unless it is already at the top. Dividers always break; headings by `startsPage`.
- **Files start on a new page:** a linked import's dividers break (above); a file added to a linked note already goes after the last page.
- **Outline's Apply:** `pageFrame` goes; `checkRebuild` uses `textArea(pageSize, layout)` for top and bottom. `LayoutBlock` gains `startsPage: boolean`; `layoutRebuild` starts a new page before such a block when it isn't first on its page (same rule as the import). Blocks keep their size and left edge (only Clean up changes those).

## 2. Clean up layout

### 2.1 Plan — `domain/cleanupLayout.ts` (new, pure)

Input: the scope's blocks in order, each with its kind, level, measured height in its new style, and (for a block too tall for the text area) its pieces with their heights. Output: placements `{key, piece, page, rect}` and the page count the scope now needs.

Every block: left = area.left, width = area width, its measured height, `blockGap` between blocks, a new page when it doesn't fit or `startsPage`. Set-aside blocks are not in the scope (they stay on their pages at the end).

**Blocks taller than the text area are split** (decided: they have to be split at some point anyway), with the import's splitting (`blockPagination.ts` `splitIntoPageFittingPieces`, exported). Pieces of a linked block keep its tag with `p` = 0, 1, …; the write-back already joins consecutive pieces of one block with a space. Pieces cut before (an earlier import or Clean up) are joined first and split again for the new text area, so Clean up can also merge them back into one textbox. Keeping a split paragraph's inner line breaks and its identity across several textboxes is later work (backlog).

### 2.2 Planned like the Outline's changes

- `PlannedChange` gains `{kind: 'cleanup'; scope}` with scope `{kind: 'note'} | {kind: 'file'; sourceId}` (at most one; a new one replaces the old). `plannedOrder` ignores it for the order; `plannedSummary` adds "Clean up layout: whole note" / "… : Essay.txt".
- Settings → Layout → **Clean up layout** (scope: Whole note or one of the linked files) adds the change and goes back to the Outline tab, where the planned line names it and Apply runs it.

### 2.3 Check and apply — `actions/cleanupApply.ts` (new)

- **Scope blocks:** the whole note, or the file's section (divider to the next divider). Since files start on a new page, a file's pages are its own; a file whose divider isn't first on its page is offered only as part of the whole note.
- **Styles:** each block's style from its kind and level (the import's role styles; divider = `heading1`; protected placeholders keep theirs). Heights are measured in the new style with the textbox's font.
- **Pages:** for a file, `insertNotePage` / `removeNotePage` before the next file's first page make up the difference, so later files don't move; for the whole note, pages are added or removed at the end (set-aside pages stay last).
- **Blockers:** edits waiting (recognized marks) in the scope, pages not read, a user's own NOTE title in the scope. **Handwriting does not block:** it stays where it is; the check line names the pages.
- **Apply:** one backup of the scope's pages, textboxes rewritten in their new place and style (removed and inserted; the tags are kept), page inserts/removals, title sync on all scope pages, one save. Clean up changes no file's text.

## 3. Settings with tabs

- `ManuscriptDetailsScreen.tsx` → `screens/manuscript/settings/SettingsScreen.tsx` with tabs **Outline · Layout · Export · Calibration · Diagnostics** (plus Files until §4 moves it), one file per tab and `SettingsParts.tsx` for what they share.
- Layout: margins, "New page before #/##/###", paragraph and heading sizes, Bold headings, Reset to defaults, Clean up layout.
- Export: the classification rules (from `ExportRulesScreen`, deleted). `ImportLayoutScreen` is deleted too.

## 4. Files tab

- `ManuscriptScreen` tabs: **Review · Outline · Files**; `screens/manuscript/files/FilesTab.tsx`: Linked files (`FilesSection`), Into this note (Import a text file… / Add a file… — the Import screen as a sub-screen of the card), Out of this note (Export DOCX… — the Export screen as a sub-screen). The Import screen's layout line and the Export screen's rules line open Settings → Layout / Export.
- After an import, the card reads the note again and returns to Files with the import's status.
- An empty note (the Review finds no textboxes) opens on Files.
- Toolbar: `index.js` no longer registers 6290 / 6300; `App.tsx` drops the screens; `buttonIds.ts` keeps the ids as retired.

## 5. Steps

1. S1 Page layout + Settings tabs. 2. S2 Page breaks. 3. S3 Clean up layout. 4. S4 Files tab. 5. S5 Docs.

## 6. Decided open points

- Adding and removing pages in the middle of the note: works (Tilman).
- Retired toolbar buttons go with the update (Tilman).
- Blocks taller than the text area: split now (§2.1).
- Handwriting staying in place during Clean up: assumed, confirm on the device.

## As built

- **S1** `domain/pageLayout.ts` (`DEFAULT_PAGE_LAYOUT`, `textArea`, `startsPage`, `marginsSummary`),
  `settings.layout`; the import's margins are gone (`withDefaultLayout` became `withDefaultStyles`,
  which resets the styles only). Settings is `screens/manuscript/settings/` with
  `SettingsScreen`, `OutlineSettings`, `LayoutSettings`, `ExportSettings`, `CalibrationSettings`,
  `DiagnosticsSettings` and `SettingsParts`. The heading sizes and Bold headings moved from the
  Import screen to Settings → Layout. `useExportScan` scans with the saved rules only.
- **S2** `blockPagination` `breakBefore`; `textImport.ts` `blockStartsPage`; `LayoutBlock.startsPage`
  in `layoutRebuild`, decided by `checkRebuild` from the planned level; `pageFrame` uses
  `textArea` (and only without a page size the textboxes' extent).
- **S3** `domain/cleanupLayout.ts` (`blocksInScope`, `pieceGroups`, `groupText`, `fitText`,
  `layoutCleanup`, `cleanupRange`, `fileStartsPage`); `OutlineBlock` gained `sourceBlock`, `piece`,
  `placeholder`; `PlannedChange` `{kind: 'cleanup', key: '#cleanup', scope}`, `PlannedOrder.cleanup`.
  `actions/cleanupApply.ts` (`checkCleanup`, `applyCleanup`); `useOutline` dispatches check and
  apply by the plan; blocker kind `plan` for changes planned outside a file's clean up. A textbox
  that stays one textbox on its page is modified in place; joined or cut blocks and blocks that
  change page are rewritten (the first piece keeps the tag without `p`, the others get a new id
  with `p`). Pages are inserted at the range's end, set-aside blocks go to new pages at the note's
  end, pages left with no text and no handwriting are removed last, titles are synced from the
  first page on. Settings → Layout → `CleanupSection` (Whole note / One file with ‹ ›) plans it and
  opens the Outline; the button reads "Apply clean up".
- **S4** `screens/manuscript/files/` (`FilesTab`, `FilesSection` moved); Import and Export screens
  take `onBack` and open Settings → Layout / Export; the card is a wrapper that starts over with a
  new key after an import; `actions/noteContent.ts` `noteHasTextboxes`; buttons 6290 / 6300 retired.
- **Still to confirm on the device:** handwriting staying in place reads well; pages inserted and
  removed in the middle show at once in NOTE.
