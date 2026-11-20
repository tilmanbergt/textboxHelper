# Technical design: Manuscript — Review and Outline on one card

Status: **draft for review, 2026-11-20.** Mockups: design canvas "Textbox Tools Calmer Screens", row "Manuscript" (https://claude.ai/artifact/PqbbeUQjAiTAYkMbMSokzH): Review on open, long pen insert, multi-line swap + Drop, Outline All, Outline Planned, Outline blocked. Goes into the repo as `docs/dev/history/technical-design-manuscript.md` with the first step.

Built on `main` `989c6e8` (swap/space marks, font rule and mark help merged). Branch `feature/manuscript`.

**Guiding rule for this change:** reuse what is there, delete what the new card makes unused, and leave every touched module smaller and clearer than before. Every step removes code it replaces in the same commit; nothing old stays "for now".

## 0. Requirements (agreed with Tilman, 2026-11-19/20)

1. **One card, "Manuscript"**, for the whole note. It replaces the edit-marker review. Two tabs: **Review** (pen marks: shaping the text) and **Outline** (order of textboxes: shaping the document). A dashed slot for the later desk (File tab, "Also update source file") is kept in the layout, not built.
2. **Edits first, then structure.** A block with pending edits can be read and given a status, but not moved, set aside or deleted.
3. **Review = changes in context**, grouped by page; a page strip with counts per page (✓ none, `?` not read yet, "Read n pages"). Long changes (multi-line insert, multi-line swap) show their whole changed text; only the context is cut.
4. **Side bar** for the selected change; the first change is selected on open; nothing in the list moves when the selection changes. Pen text: recognized text at the top of the side bar (out of the writing pad's reach), handwriting, place, Select mark.
5. **Fine-tuning edges:** insert 1 (place), delete and replace 2 (start, end), swap 3 (start of A, A|B, end of B), each with ‹ ›.
6. **Row action: Drop only**; Drop confirms in the side bar (keep / erase handwriting). No "Later".
7. **Needs attention** line above the list (pen text without a mark: Select mark ›, Drop).
8. **Outline rows:** H/¶, first and last line, planned change, ✎ pending edits, status glyph on the right (○ open ◐ review ● final). **Status is kept in the plugin only.**
9. **Filters:** All, Planned, Pending edits, ○ Open, ◐ Review, ● Final. ← move targets show only under All.
10. **Select a block** → its whole text pages in the bottom panel (nothing is typed there) with an action bar: Set aside, Delete, Status ▾, More › (room for later actions); on a planned block also Undo move / set aside / delete. "Undo last" in the planned line; no "Show".
11. **Move:** while a block is selected, ← sits on the line between blocks (right edge); tap it to move the block there. A heading takes its section.
12. **Batch:** moves, set aside and delete are planned and applied together ("Apply 3 changes"): one backup, one rebuild, one save. Status applies at once.
13. **Set aside on a plain note:** onto a new page at the end of the note.
14. **Rebuild range** = first to last touched page; overflow carries on. Anything pending there blocks: marks, pen text, handwriting outside textboxes.
15. **Plain notes:** each textbox is a block; H = heading guessed by size, as the DOCX export does.

## 1. What is there today (short)

- **Edit markers:** `actions/editMarkers.ts` (997 lines — at the 1,000 limit) builds a preview for `'lasso' | 'page'` scope of the **current page** (`supernote/noteElements.ts` `getPreviewContext`), `domain/markerAssembly.ts` assembles it from `MarkerPreviewBase` + pen states + edge nudges, `applyEditMarkerPreview` applies one page's plan (file API `modifyElements`, `insertTextboxesIntoFile`, save). `actions/editMarkerDrop.ts` drops; `actions/penEditReview.ts` holds pen-edit state, recognition, Select mark.
- **Review screen:** `screens/markers/EditMarkerReviewScreen.tsx` (604) + `useEditMarkerReview.ts` (342) + `ChangeDetail.tsx` (428: `Handwriting`, `EdgeControl`, `EdgeRow`, `ResultLine`, `DropConfirm`) + `usePenRecognitionQueue.ts` + `MarkerDetailsScreen.tsx`. Left `CountTabs` Changes/Ignored with `PagedSection` (fixed `ROW_HEIGHT` 96), right `PagedText` of one textbox (`domain/markerDiff.ts` segments).
- **Whole-note reading** exists only in the export scan (`actions/textboxScan.ts`: `getNoteTotalPageNum`, `getElements` per page, `compareByReadingOrder`, `classifyTextRole`).
- **Page layout** helpers: `domain/paginationCore.ts`, `blockPagination.ts`, `importPlan.ts` (import), `textboxEditPlan.ts` (`ensureLayoutFitsPage`, `ensureNoCollision`).
- **Buttons** (`domain/buttonIds.ts`, `index.js`): lasso 6200 Textbox Tools, 6230/6235/6240/6250/6260 direct actions, 6270 apply edit markers (lasso), 6310 pen text; NOTE 6280 apply all edit markers (page), 6290 import, 6300 export.
- **Host facts that shape this design:** element uuids and numbers are not identities (§3); `userData` round-trips through `getElements` / `insertElements` / `modifyElements`; file-API reads work for any page.

## 2. Scope and order

1. **Review (M1)** on the current page with the new screen, then across the note.
2. **Outline (M2)**: read-only list with filters and status, then planned changes and rebuild.
3. **Toolbar and cleanup (M3)**: Manuscript on the NOTE toolbar; the lasso keeps Textbox Tools and Pen text.

**Out:** desk/file parts (slot only), "Later", status shown on the page, typing in the outline, Send to page…, More › contents, landscape layout.

## 3. Entry points and buttons

| Today | After |
|---|---|
| NOTE 6280 "Apply all edit markers" | **6280 "Manuscript"** (id kept so the host slot stays) → `App` screen `'manuscript'` |
| Lasso 6270 "Apply edit markers" (lasso scope) | **removed**: the card covers the whole note; lasso scope goes with it |
| Lasso 6230/6235/6240/6250/6260 direct actions | **removed** (decision D1): the Textbox Tools panel (6200) has the same actions with a preview |
| Lasso 6200 Textbox Tools, 6310 Pen text | unchanged |

With D1, `screens/direct/DirectActionScreen.tsx`, the `DIRECT_ACTIONS` map in `App.tsx` and the policy exception O7 (direct actions without preview) are deleted. `App.tsx` routes 6200, 6280, 6290, 6300 and the pen-text outcome only.

## 4. Review across the note

### 4.1 Split `actions/editMarkers.ts` (pure refactor first, S1)

No behaviour change; the file drops under the limit and the pieces become reusable per page.

- `actions/markerPageAnalysis.ts` — `analyzeMarkerPage(notePath, page): Promise<MarkerPreviewBase>`: everything `buildEditMarkerPreview` does up to the base (read page elements, pen context, stroke stats, candidates, drafts, ignored, insertions, diagnostics stages). Page scope only.
- `actions/markerApply.ts` — `applyMarkerPlan(plan, options)`: today's `applyEditMarkerPreview` body (re-read, original-text check, split tails, insertions, mutations, pen edits applied, save).
- `actions/editMarkers.ts` keeps calibration and diagnostics only (`get/set/resetEditMarkerCalibration`, `saveEditMarkerDiagnostics`) and is renamed `actions/markerCalibration.ts`.
- **Deleted with the lasso scope:** `EditMarkerPreviewScope`, the `'lasso'` branch of `getPreviewContext` and `loadPenEditContext(…, lassoElements)`, `effectiveSelection`, `selectedMarkerCount` / `selectedTextboxCount` / `selectionMessage` / `summaryMessage` in `EditMarkerPreview` and `MarkerPreviewBase` (the card's header counts come from the page states). `getPreviewContext` becomes `readPageContext(notePath, page)`; the current note and page come from `getCurrentNoteContext` once when the card opens.
- Backlog item folded in: the duplicated SDK helpers (`errText`, `recycle`, `Response`) move into `supernote/sdkElements.ts`.

### 4.2 Page states (`domain/manuscriptPages.ts`, pure)

```ts
type PageReview =
  | {state: 'unread'; penCount: number}                 // pen edits known from the index, cheap
  | {state: 'reading'}
  | {state: 'read'; base: MarkerPreviewBase}
  | {state: 'failed'; message: string};
type ManuscriptPages = {notePath: string; pageCount: number; current: number; pages: Record<number, PageReview>};
```

Helpers: `pageCount(review)` (changes per page, from the assembled preview), `chipLabel` (`✓` / `· 3` / `?`), `unreadPages`, `pagesWithChanges`, `totalChanges`. Counts live in memory while the card is open. On open: the current page is read at once; the other pages show `?` (with their pen-edit count from the index where known) until "Read n pages" or a chip tap reads them, one page at a time with progress in the status line.

### 4.3 Assembly per page, hunks for the list (`domain/markerHunks.ts`, pure)

`assembleMarkerPreview` (`domain/markerAssembly.ts`) is reused unchanged per page. What the screen needs instead of one `PagedText` per textbox is one **hunk** per operation:

```ts
type ChangeHunk = {
  operationId: string; page: number; number: number;      // the circled number on the page
  kind: ReviewOperationKind;                              // incl. 'swap', 'space' after S0
  label: string;                                          // "Insert · 4 lines", "Swap · 3 lines"
  before: string; segments: TextSegment[]; after: string; // context + whole change
  meta: string;                                           // "Textbox 6 · after line 1 · pen text 3"
};
```

`buildHunks(textbox, operations, ranges)` reuses `buildDiffSegments` (`markerDiff.ts`) on the textbox text and cuts the **context** around each operation's span at word boundaries (about six words each side, `…`); the changed span itself is never cut. A swap renders as A struck at its place, B unchanged, A in bold at the new place (one segment run, built from the swap's two ranges). Hunks are sorted into reading order (page, textbox order, `textStart`) — this also closes the backlog item "insertions listed after textbox changes".

**Deleted:** `EditMarkerTextboxPreview` and `EditMarkerPreview.textboxes` (the per-textbox diff pane), unless the Outline's bottom panel reuses it for a block with pending edits (§5.4) — then it stays, renamed `textboxDiff`.

### 4.4 Edges: 1, 2 or 3 (`domain/edgeShift.ts`)

`EdgeShift {start, end}` becomes `EdgeShift = number[]` with one entry per edge, by kind: insert / paragraph break / space `[place]`, delete / replace `[start, end]`, swap `[startA, meet, endB]`. `shiftSpans` and `edgeContext` already work per offset; the swap's pieces are derived from the three offsets. `EdgeView` becomes `{edges: {offset, before, after}[]; result}`. Stored pen-edit edges (`PenTextState.edges`) parse the old `{start,end}` shape into `[start, end]` (no users, but old entries on Tilman's device). `ChangeDetail`'s `EdgeControl` renders `edges.length` rows with labels from the kind (Place / Start, End / Start of A, A | B, End of B).

### 4.5 Apply across pages (`actions/manuscriptApply.ts`)

"Apply 9 edits": for every read page with ready changes, in page order: `applyMarkerPlan` with the page's plan. One backup for the whole apply: `backupPayload.ts` gains `pages: {page, textboxes}[]` (today one page). One `saveCurrentNote` at the end instead of one per page. Pages still unread are not applied (the button counts only read pages: "Apply 9 edits" = read pages; the status line says "Pages 6–7 not read").

**Open point P1:** file-API writes to pages other than the current one in the open note — does NOTE show them after the save, or only after a page change? Device test in S3; fallback: `reloadFile` / `jumpToPage(current)` after the save, as the desk design lists for P1 there.

### 4.6 Hook (`screens/manuscript/useManuscriptReview.ts`)

Evolves from `useEditMarkerReview.ts` (moved, not copied): same nudge / drop / correct / selectMark / recognition queue (`usePenRecognitionQueue.ts` reused), but state keyed by page (`ManuscriptPages`), `selected: operationId` (first hunk on open), `readPages(pages[])`, `apply()`. Recognition runs for the pen edits of the pages read so far, current page first.

## 5. Outline

### 5.1 Blocks (`domain/outlineModel.ts`, pure)

```ts
type OutlineBlock = {
  key: string;                 // block id from the tag, else `${page}:${numInPage}` for this read only
  page: number; numInPage: number; rect: Rect; style: TextboxStyle;
  text: string; firstLine: string; lastLine: string;
  role: 'heading' | 'paragraph';   // classifyTextRole (exportClassification.ts), as the export
  titleNum: number | null;         // NOTE title element covering it
  pendingEdits: number;            // from the page review (§4.2); unknown on unread pages
  status: BlockStatus;             // 'open' | 'review' | 'final'
};
```

`buildOutline(pagesElements, pageReviews, statuses)` orders by `compareByReadingOrder` (reused from `exportClassification.ts`). First and last line come from the native line measurement already used by the review (`textboxMetrics.ts` detailed lines); fallback: first and last 60 characters. `filterOutline(blocks, filter)` for the six filters.

**Reading the note:** the page loop of `actions/textboxScan.ts` moves into `supernote/notePages.ts` `readNotePages(notePath, pages?)`; export scan and Outline both use it (export loses its own copy).

### 5.2 Status, kept in the plugin

Status needs a stable identity, and host facts §3 say numbers and uuids aren't one. So the first status change writes a **block tag** into the textbox's `userData` with `modifyPageElements`: `tbt:b:{"v":1,"id":"b-<base36>"}` (`domain/blockTag.ts`, format/parse, Kept's id pattern). Statuses live in `<pluginDir>/manuscript/<noteKey>.json` (`storage/blockStatusStore.ts`, written like `penEditStore.ts`, `noteKey` = hash of the note path) as `{id → status, updated}`. Untagged blocks are `open`.

The desk design (`technical-design-desk.md` §3.1) plans `tbt:desk:` tags on the same textboxes; **decision D2:** one tag family — the desk tag later extends `tbt:b:` (adds desk and source block) instead of a second tag. The lineage rule ("every tool keeps the tag") then starts here: the lasso actions keep `userData` when they write textboxes (same change as desk step D3; until then a split/join loses the status — documented).

**Open point P2:** does a textbox's `userData` survive when the user edits its text in NOTE (NOTE replaces the element, host facts §3)? Tests page check; if not, the status falls back to `open` for that block and the review says so.

### 5.3 Planned changes (`domain/outlinePlan.ts`, pure)

```ts
type PlannedChange =
  | {kind: 'move'; key: string; before: string | {endOfPage: number}}
  | {kind: 'aside'; key: string}
  | {kind: 'delete'; key: string};
```

Pure functions, all tested:
- `planOrder(blocks, plan)` → the block order after the plan; a heading moves with its section (blocks up to the next heading of the same or higher level, by role and font size).
- `rebuildRange(blocks, plan)` → `{first, last}` pages: first to last page touched by a source or target; extended later by overflow at layout time.
- `rebuildBlockers(range, pageReviews, pageElements)` → pending edits per page, unread pages (read first, automatically, before apply), handwriting outside textboxes (stroke elements not tagged as pen edits or plugin decorations — `isPenEditElement`, `isPenEditDecoration` reused).
- `undoLast(plan)`, `undoFor(plan, key)`.
- `plannedSummary(plan, blocks)` → "1 move (p.4) · 1 set aside (p.5) · 1 delete (p.6)".

### 5.4 Layout of a rebuild (`domain/outlineLayout.ts`, pure)

Text doesn't change in a rebuild, so **no measuring**: every block keeps its rect size and style. `layoutRange(blocksInOrder, area, firstTop)` stacks blocks top-down from the range's first block top with each block's original gap above it (capped to the page's usual gap), moves a block that doesn't fit to the next page, and adds pages at the end of the range only when the overflow runs past the last page of the note (`insertNotePage`, as import does). A block taller than a page stays on its own page (no splitting). `ensureLayoutFitsPage` / `ensureNoCollision` (`textboxEditPlan.ts`) check the result against non-text elements left on the pages.

### 5.5 Apply (`actions/outlineApply.ts`)

1. Re-read the range pages (`readNotePages`), check every block's text is unchanged since the outline was read (as the marker apply does), check blockers again.
2. Backup of all range pages (the multi-page payload of §4.5).
3. **Same page:** `modifyPageElements` with the new `textRect` (and the covering title's rect) — the element, its number and its tag stay.
4. **Other page:** `insertTextboxesIntoFile` on the target page with the block's style and **its `userData`** (`StyledTextboxInsert` gains `userData?: string`), then `deletePageElements` on the source page; a covering title is recreated on the target (`createElement(100)`, Kept GTD `buildTitleElement` pattern) — open point P3.
5. Set aside: insert onto a new last page (created once per apply, titled "Set aside" with a NOTE title element so it is findable in the note's table of contents — Supernote-native); delete: `deletePageElements`.
6. One `saveCurrentNote`.

### 5.6 Hook (`screens/manuscript/useOutline.ts`)

Reads blocks on first opening the tab (pages already read by the Review are reused), keeps `filter`, `selectedKey`, `plan`, `blockers`, `apply()`. Status changes write at once (tag + store).

## 6. Screens

```
screens/manuscript/
  ManuscriptScreen.tsx      // ScreenFrame, tabs (CountTabs), Details, help, footer per tab
  ReviewTab.tsx             // PageStrip, AttentionLine, HunkList | ChangeSide
  ChangeSide.tsx            // from ChangeDetail.tsx: Handwriting, EdgeControl (1–3), DropConfirm
  OutlineTab.tsx            // FilterRow, BlockList with ← targets, PlannedLine, BlockPanel
  ManuscriptDetailsScreen.tsx // from MarkerDetailsScreen.tsx: calibration, diagnostics
  useManuscriptReview.ts, useOutline.ts, usePenRecognitionQueue.ts (moved)
```

- **Reused unchanged:** `ScreenFrame`, `PillButton`, `CountTabs` (tabs and filter counts), `HelpOverlay`, `PagedText` (block panel text, side bar long text), `screenRefresh`, theme tokens.
- **`PagedSection` with measured rows:** hunks and blocks have different heights (a four-line insert vs. a one-line delete). `PagedSection` gets an optional `measure` mode: rows report `onLayout` heights (as `PagedText` does with lines, `useMeasuredHeight.ts`), pages break where the next row doesn't fit; fixed `rowHeight` stays the default for the other screens. No second paging component.
- **New small UI:** `ui/ChipRow.tsx` (page strip and filter row: chips with on / dashed states), `MoveTarget` (the ← on a row border, absolutely placed in the row gutter — no extra height).
- **Deleted:** `screens/markers/` (the review, its Changes/Ignored tabs, the textbox pane, `IgnoredRow`, `EmptyState` → the empty state text moves into ReviewTab), `screens/direct/` (D1).
- Help texts (`domain/helpTexts.ts`): one Manuscript entry with Review and Outline parts; the mark help (S0) stays and is reached from Review's `?`.

Every file stays well under 1,000 lines; the two hooks under 400.

## 7. Files

| New | Changed | Deleted |
|---|---|---|
| `domain/manuscriptPages.ts`, `markerHunks.ts`, `outlineModel.ts`, `outlinePlan.ts`, `outlineLayout.ts`, `blockTag.ts` | `domain/edgeShift.ts`, `markerTypes.ts` (lasso fields out, edges array), `markerAssembly.ts` (edges), `backupPayload.ts` (pages), `buttonIds.ts` | `actions/editMarkers.ts` (split), `screens/markers/*`, `screens/direct/*` |
| `actions/markerPageAnalysis.ts`, `markerApply.ts`, `manuscriptApply.ts`, `outlineApply.ts` | `supernote/noteElements.ts` (`readPageContext`), `noteTextInsertion.ts` (userData), `actions/textboxScan.ts` (uses `readNotePages`) | lasso scope everywhere; `EditMarkerTextboxPreview` (unless reused) |
| `supernote/notePages.ts`, `sdkElements.ts`; `storage/blockStatusStore.ts` | `ui/PagedSection.tsx` (measure mode), `App.tsx`, `index.js`, `helpTexts.ts` | buttons 6270, 6230–6260; O7 policy exception |
| `screens/manuscript/*`, `ui/ChipRow.tsx` | docs: design overview, host facts, README, CHANGELOG, policy | |

## 8. Tests (Jest)

- `markerHunks`: context cut at word boundaries, change never cut, swap rendering, multi-line insert, two changes in one textbox (separate hunks), reading-order sort incl. insertions.
- `edgeShift`: 1/2/3 edges per kind, old `{start,end}` parse, swap pieces from three offsets, bounds.
- `manuscriptPages`: chip labels, counts, unread handling.
- `outlinePlan`: move before/after/end of page, heading with section, aside, delete, undo last / undo for key, range, blockers (pending, unread, loose handwriting, plugin decorations ignored), summary text.
- `outlineLayout`: stacking with original gaps, overflow to the next page, new page at the end, too-tall block, collision with a non-text element.
- `blockTag`: format/parse, foreign `userData` → null, length.
- Existing marker/pen-edit suites keep passing after S1 (pure refactor); lasso-scope tests are deleted with the scope.

## 9. Steps and device stops

Each step: `npm run check` green, its own commit, docs in the same commit, deleted code in the same commit.

0. **S0** Merge `feature/swap-space-marks` (with the mark help) — done, `989c6e8`.
1. **S1 Refactor, no behaviour change:** split `editMarkers.ts` into `markerCalibration.ts`, `markerPageAnalysis.ts` (the preview in named steps) and `markerApply.ts`; the SDK helpers into `sdkResult.ts` (`SdkResponse`, `sdkErrorText`) and `sdkElements.ts` (`recycleByUuid`). The lasso scope stays until S2. `readNotePages` comes with its first user (S3). Device test: the old review still works on one page.
2. **S2 New Review, current page:** `markerHunks`, edges array, `PagedSection` measure mode, `ManuscriptScreen` with Review tab only, 6280 → Manuscript, 6270 and the lasso scope removed, `screens/markers/` deleted. **Device stop 1.**
3. **S3 Whole note:** page states, strip, Read n pages, multi-page apply and backup. **Device stop 2** (P1).
4. **S4 Outline, read-only:** blocks, filters, block panel, status with tags and store. **Device stop 3** (P2).
5. **S5 Planned changes and rebuild:** plan, ← targets, blockers, layout, apply, set-aside page. **Device stop 4** (P3, timing on a 20-page note).
6. **S6 Toolbar and cleanup:** D1 (direct buttons and screen out), help, README, design overview, host facts, As built.

## 10. Decisions needed

- **D1** Remove the five direct lasso buttons (the panel keeps the actions with preview)? Proposed: yes.
- **D2** One tag family `tbt:b:` that the desk extends later? Proposed: yes.
- **D3** Set-aside page marked with a NOTE title ("Set aside")? Proposed: yes (findable in the table of contents).

## 11. Open points

- **P1** File-API writes to non-current pages of the open note: visible after save? (S3)
- **P2** `userData` survival when the user edits a textbox in NOTE; also after lasso move / cut-paste (shared with the desk Tests page). (S4)
- **P3** Recreating a title element on another page; fallback: a heading with a NOTE title moves only within its page, otherwise it is a blocker with a reason. (S5)
- **P4** Reading time for "Read n pages" on a long note (marker analysis per page); show progress per page, cancel between pages.

## As built

**S1 (2026-11-20):** as in §9. Device test good.

**S2 (2026-11-20), differences from the design:**
- **No `PagedSection` change.** Rows of different heights already page by their `rowHeight`; the list estimates each hunk row's height from its text length and the measured list width (a slightly generous character width), so no measured-rows mode was needed.
- **Hunks live in the preview** (`EditMarkerPreview.hunks`, built by the assembly from the ranges it shows), replacing `textboxes`. A hunk holds the whole text before and after its change; the list shows 6 words of it, the side bar 24 (`lastWords`, `firstWords`). A swap reads "A struck · B · A bold"; when it also moves punctuation or a capital, old text struck then the new order. New paragraphs sit right after the textbox above them.
- **Edges** are `number[]` (one delta per edge); stored pen-edit edges in the old `{start, end}` shape are read as `[start, end]`. A swap's meeting point moves the gap as one; each part keeps at least one character (`shiftSwapZones`).
- **Skip for later is gone** (no "Later", decided 2026-11-20): `PenEditEntry.review`, `setPenEditReview`, the `skipped` status and `skippedCount` were removed. Tagged text still being recognized stays for another pass; Drop takes away what isn't wanted.
- **Lasso scope removed everywhere:** `EditMarkerPreviewScope`, `getPreviewContext` (now `readCurrentPageContext`), the lasso filter in `loadPenEditContext`, the selection counts and messages in the preview, base, apply plan and backup, `hideLassoBox` after apply/drop. Button 6270 is unregistered; 6280 is "Manuscript".
- **Screens:** `screens/markers/` is gone; `screens/manuscript/` holds `ManuscriptScreen` (attention line, hunk list, side bar), `ChangeSide` (from `ChangeDetail`), `ManuscriptDetailsScreen` (calibration and diagnostics; the "read from" section went with the lasso scope), `useManuscriptReview`, `usePenRecognitionQueue`. Segment rendering is shared in `ui/Segments.tsx` (also used by `PagedText`). No tabs yet: the Outline tab comes with S4.
- Help: the review part of the mark help (`REVIEW_HELP`) describes Manuscript.
