# Technical design: splitting the code into layers

Status: APPROVED (2026-11-15), with the `actions/` layer (§4.1) added after review. Drafted on
`1fbbe4d` ("Add working agreement") and brought up to date with 0.2.2 (`9338597`: Save
Diagnostics, font fallback), which is the base of L1. First step of Phase 2 (architecture) in the
internal backlog. Branch: `feature/layers`, merged into `main` with `--no-ff` once every step
below is done and device-tested.

## 1. Requirements as decided

- **Behaviour stays the same.** Every toolbar button, preview, backup file, clipboard summary,
  result message and change to a note is the same before and after. The single intended
  exception is named in §4.6. No CHANGELOG line, because nothing changes for users.
- **Layers as in Kept GTD, plus `actions/`**: `src/domain/` (pure), `src/supernote/` (SDK and
  native wrappers), `src/storage/` (file I/O: backups, imported files, exports), `src/actions/`
  (the flows behind the buttons), `src/ui/`, `src/screens/`, `src/utils/`. Kept GTD's
  `.eslintrc.js` layer rules are copied, with `actions/` added (§4.1), so ESLint enforces the
  import direction.
- **Every source file ends at 1,000 lines or less.** The three files that may "only shrink"
  today (`textboxActions.ts` 2,733, `editMarkerActions.ts` 2,199, `textboxStrikeAnalysis.ts`
  1,638 lines) disappear.
- **Pure logic that moves into `domain/` gets Jest tests**, starting with the golden tests
  Phase 3 asks for (splitting, join, cleanup, import parsing).
- **One `writeBackupFile`** instead of the two copies in `textboxActions.ts` and
  `editMarkerActions.ts`.

## 2. Current state (at 0.2.2, `9338597`)

About 12,800 lines of TS/TSX: `App.tsx`, `index.js`, and 27 files under `src/`. `npm run check`
is green with 16 Jest tests (`backupPaths`, `diagnosticLog`, `fontPaths`).

| File | Lines | What is mixed in it |
|---|---|---|
| `src/textboxActions.ts` | 2,733 | Sentence/paragraph splitting, whitespace cleanup, join boundaries (pure); collision and page-fit checks (pure, over SDK element types); SDK reads and writes; backup with RNFS and clipboard; and about 1,300 lines of unreachable "lab" code (§3). |
| `src/editMarkerActions.ts` | 2,199 | About 760 lines of pure stroke and text logic (stroke stats, replace-marker pairing, text mutation ranges, highlight ranges, replacement lines, messages); SDK reads of strokes; the calibration state and the diagnostics trace; preview and apply; the second backup copy. |
| `src/textboxStrikeAnalysis.ts` | 1,638 | A live pen-up listener that analyzes strokes and edits textboxes directly. Nothing imports it (§3). |
| `src/textboxImportActions.ts` | 641 | Import settings and types, preview text, insert-mode decisions and page plans (pure, ≈ 210 lines); file read, note context and the import flow. |
| `src/export/scanTextBoxes.ts` | 411 | Role classification and style signatures (pure); page scan through the SDK. |
| `src/shared/` | 1,521 | "Mostly pure": `fontPaths.ts` and `diagnosticLog.ts` are pure; the others import `type Rect` from `sn-plugin-lib`; `supernoteTextboxLayout.ts` calls the native module; the pagination files call the native measurement through `estimateTextboxHeight`; `textboxImportParsing.ts` imports its settings types from `../textboxImportActions` (upwards); `supernoteNoteTextInsertion.ts` is an SDK writer. |

Repeated code: `assertApiSuccess` exists five times, plus twice as `expectApiResult` in
`src/export/`; `recycleElements` five times, `isNormalTextElement`, `roundRect`,
`saveCurrentNote…` and `sortTextElements` two to three times each, and `intersectionRect` twice
next to the exported one in `shared/supernoteTextboxGeometry.ts`.

## 3. Dead code found on the way

Two blocks of code are compiled into the plugin but can't be reached from any button:

- **`src/textboxStrikeAnalysis.ts`** (1,638 lines). `initTextboxStrikeAnalysis()` registers a
  pen-up listener that changes textboxes without a preview or backup. No file imports the module,
  so it never runs; `docs/dev/README.md` describes it wrongly as "the stroke analysis behind the
  marker recognition" (that analysis lives in `editMarkerActions.ts`). Bringing it back would
  break the product principle "preview, backup, then change".
- **The textbox "lab" in `src/textboxActions.ts`**: `generateTextboxLabVariants`,
  `generateTextboxLabEdgeVariants`, `moveLatestTextboxLabVariants`,
  `exportWholeNoteTextboxScan`, `exportCurrentPageTextboxScan`, `logCurrentPageTextboxes` and the
  42 helpers, constants and types only they use. None of the six exports is imported anywhere.
  Removing them was tried on a copy: `textboxActions.ts` drops to about 1,440 lines, `tsc` stays
  green, ESLint then reports only four unused imports.

Both are removed in step L1, except `writeJsonExportFile`: "Save Diagnostics" in the edit-marker
review (added in parallel, commit "Add Save Diagnostics to the edit marker review") reuses it
to write its JSON trace into EXPORT, so it stays and moves to `storage/exportFile.ts` in L3.
**"Log All Textboxes" stays**: it is a visible action in the Textbox
Tools panel (`ACTION_ORDER` in `TextboxToolsView.tsx`) and goes through `performTextboxAction`,
not through the lab code. Whether it stays visible for users is a backlog question, not part of
this change. The marker calibration in the edit-marker review (offset X, width adjustment) is
also visible and stays.

## 4. Design

### 4.1 Layers and import rules

An action has three parts, and each gets its own place:

- **what changes** - the plan, computed from texts and rectangles: `domain/` (pure, tested);
- **reading and changing the note** - SDK calls: `supernote/`;
- **files** - the backup, the imported text file, the DOCX: `storage/`.

`actions/` holds the flows that tie them together: read the page, build the preview, and on
confirmation write the backup and apply the plan. An action that needs no file (a future one that
only rearranges textboxes, say) simply doesn't import `storage/`. Kept GTD has no `actions/`
layer because its flows mostly write data files, so they live in its `storage/`; here most flows
change notes, and a file is the exception.

`.eslintrc.js` gets Kept GTD's `overrides` block (the `no-void` rule is already there; `curly` and
the `src/generated/` ignore are not taken over, they don't apply here), with `**/actions/**`
added to the forbidden list of every layer below it and one new block for `src/actions/**`:

| Layer | May import | Must not import |
|---|---|---|
| `domain/` | `domain/` only | React, React Native, `sn-plugin-lib` (also not `import type`), every other layer |
| `utils/` | `domain/` | `storage/`, `supernote/`, `actions/`, `ui/`, `screens/` |
| `supernote/` | `domain/`, `utils/`, the SDK, React Native | `storage/`, `actions/`, `ui/`, `screens/` |
| `storage/` | `domain/`, `utils/`, `supernote/` (plugin and export folders), RNFS, `docx`, React Native (clipboard) | `actions/`, `ui/`, `screens/` |
| `actions/` | `domain/`, `utils/`, `supernote/`, `storage/` | `ui/`, `screens/` |
| `ui/` | everything below | `screens/` |
| `screens/` and `App.tsx` | everything | - |

`index.js` and `App.tsx` stay in the repository root, as in Kept GTD. `utils/` stays empty in
this change; it gets `log.ts` in the logging step (§7).

### 4.2 Domain types instead of SDK types

`domain/` can't import `sn-plugin-lib`, not even as a type. It gets its own small types in
`domain/textboxModel.ts`, each a **structural subset** of the SDK type, so SDK values pass into
domain functions without conversion:

- `Rect` (`left, top, right, bottom`) and `Point` (`x, y`): the same fields as the SDK's.
- `TextboxData`: the fields of `TextBox` the logic reads (`textContentFull`, `textRect`,
  `fontSize`, `fontPath`, `textAlign`, `textBold`, `textItalics`, `textFrameWidthType`,
  `textFrameStyle`, `textEditable`).
- `PageElementData`: `uuid`, `numInPage`, `layerNum`, `type`, `textBox?`, and the geometry and
  stroke-kind fields the obstacle and marker checks read.

Functions that return or clone an element are generic (`<T extends PageElementData>(e: T): T`),
so the caller gets its SDK type back. `supernote/domainTypeChecks.ts` holds compile-time
assignments (`const rect: DomainRect = {} as SdkRect;` and so on) so `tsc` fails the day the SDK
and the domain types drift apart.

### 4.3 Measurement is passed into domain code

Pagination calls the native measurement today (`estimateHeightForRect` →
`estimateTextboxHeight` → `NativeModules.TextboxMetrics`). In `domain/` the pagination functions
take it as a parameter instead: `TextboxPaginationOptions` and `TextboxBlockPaginationOptions`
get a field `measureHeight: (text, width, fontSize, fontPath?) => Promise<number>`, and
`actions/textImport.ts` passes `estimateTextboxHeight` from `supernote/textboxMetrics.ts`. The
calls happen in the same order with the same arguments, so the result is the same; Jest tests
pass a fake measurement. `analyzeDeleteMarker` (edit markers) also measures, but it stays in
`actions/` for now; making it pure needs a measurement step before the analysis and is a later
change (§7).

`shared/supernoteTextboxLayout.ts` is split along the same line:

- `domain/textboxLayout.ts`: the calibration type and default, the native result types, the
  fallback estimate (`estimateTextboxHeightFallback`), the requested width, the explicit-empty-line
  extra and the final height from a layout height.
- `supernote/textboxMetrics.ts`: the native module binding, the font options and the collection of
  unreadable fonts (`resetFontWarnings`, `getFontWarning`), `measureTextLayout`,
  `measureDetailedTextLayout`, `estimateTextboxHeight`, `buildResizedTextboxRect` - unchanged in
  behaviour, including the `[TextboxHeightDebug]` log line (§7). Kept GTD's contract (never
  throws, `source: 'native' | 'fallback'`) is a later step.

### 4.4 Target modules

Line counts are estimates from a function-by-function classification of the current files.

**`src/domain/`**

| Module | From | Contents | ≈ lines |
|---|---|---|---|
| `textboxModel.ts` | new | `Rect`, `Point`, `TextboxData`, `PageElementData` (§4.2) | 70 |
| `geometry.ts` | `shared/supernoteTextboxGeometry.ts` | rectangle math, overlap, reading order; plus the copies of `rectsOverlap`, `intersectionRect`, `roundRect` from the feature files where they are identical | 140 |
| `textboxLayout.ts` | `shared/supernoteTextboxLayout.ts` | §4.3 | 150 |
| `hitTesting.ts` | `shared/supernoteTextboxHitTesting.ts` | unchanged | 130 |
| `paginationCore.ts`, `textPagination.ts`, `blockPagination.ts` | the three `shared/` pagination files | with `measureHeight` passed in (§4.3) | 450 |
| `buttonIds.ts` | `pluginRouting.ts` | the button id constants | 20 |
| `textboxActionKinds.ts` | `textboxActions.ts`, `ui/TextboxToolsView.tsx` | `TextboxActionKind`, `ACTION_ORDER`, `ACTION_LABELS` (one label per action, policy §4) | 40 |
| `textSplitting.ts` | `textboxActions.ts` | whitespace cleanup, remove line breaks, join boundary, word and sentence counts, sentence splitting (abbreviations, boundaries, tiny fragments), paragraph splitting | 260 |
| `textboxEditPlan.ts` | `textboxActions.ts` | availability, action outputs, action preview, joined text, insert building, obstacle rectangles, page fit, collision check, "Log All Textboxes" texts | 450 |
| `backupPayload.ts` | both action files | one `BackupPayload` type (`action: TextboxActionKind \| 'edit-markers'`, marker counts optional), payload building from text elements, the clipboard summary | 110 |
| `backupPaths.ts` | `shared/backupPaths.ts` | unchanged | 20 |
| `fontPaths.ts` | `shared/fontPaths.ts` | unchanged (fallback font paths, font warning texts) | 60 |
| `diagnosticLog.ts` | `shared/diagnosticLog.ts` | unchanged (bounded in-memory trace for "Save Diagnostics") | 60 |
| `markerTypes.ts` | `editMarkerActions.ts` | the exported preview and plan types and the internal candidate types | 230 |
| `markerStrokes.ts` | `editMarkerActions.ts` | stroke stats, bounds, recognize rectangles, stroke kind checks, vertical strokes, replace-modifier pairing, word candidates (calibration passed in instead of read from module state) | 380 |
| `markerText.ts` | `editMarkerActions.ts` | text mutation ranges, word deletions, text normalization, highlight ranges, replacement lines, snippets, selection and summary messages, log summaries | 450 |
| `importSettings.ts` | `textboxImportActions.ts` | settings types and defaults, import folders and paths, preview text, insert mode, page plan | 280 |
| `importParsing.ts` | `shared/textboxImportParsing.ts` | unchanged; imports its types from `importSettings.ts` instead of upwards | 160 |
| `exportConfig.ts` | `export/exportConfig.ts` | unchanged | 130 |
| `exportClassification.ts` | `export/scanTextBoxes.ts` | role rules, classification, style signatures, reading order, included items and counts | 220 |

**`src/supernote/`**

| Module | From | Contents | ≈ lines |
|---|---|---|---|
| `sdkResult.ts` | five copies | `assertApiSuccess`, `assertBooleanSuccess`, `tryApiResult`, `withTimeout` | 60 |
| `domainTypeChecks.ts` | new | §4.2 | 20 |
| `noteElements.ts` | the action files | current note path, page, page size, page elements, lasso elements, `recycleElements`, save note, modify/delete/insert elements, `insertText`, `modifyLassoText`, delete lasso elements, hide the lasso box | 300 |
| `markerStrokeRead.ts` | `editMarkerActions.ts` | reading stroke points and recognition data from an element (`readAccessorRange` and the reading part of `loadMarkerStrokeStats`) | 120 |
| `textboxMetrics.ts` | `shared/supernoteTextboxLayout.ts` | §4.3 | 160 |
| `noteTextInsertion.ts` | `shared/supernoteNoteTextInsertion.ts` | unchanged | 200 |
| `pluginRouting.ts` | `src/pluginRouting.ts` | listener and pending button, ids from `domain/buttonIds.ts` | 30 |
| `permissions.ts` | `src/permissions.ts` | unchanged (Kept GTD's `pluginPermissions.ts` and English texts are a later step) | 40 |
| `exportNoteContext.ts` | `export/exportNoteContext.ts` | unchanged | 50 |

**`src/storage/`** - files.

| Module | From | Contents | ≈ lines |
|---|---|---|---|
| `backupFile.ts` | both action files | the one `writeBackupFile(payload)`: plugin folder, `mkdir`, JSON file, clipboard summary; same paths and texts as today | 50 |
| `exportFile.ts` | `textboxActions.ts` | `writeJsonExportFile` (JSON into EXPORT through a temporary file), used by "Save Diagnostics" | 30 |
| `importFile.ts` | `textboxImportActions.ts` | reading the UTF-8 text file (`readUtf8TextFile`) | 20 |
| `docxExport.ts` | `export/exportScannedDocx.ts` | unchanged | 130 |

**`src/actions/`** - the flows behind the buttons; the names say what the flow does.

| Module | From | Contents | ≈ lines |
|---|---|---|---|
| `textboxEdits.ts` | `textboxActions.ts` | page and lasso context, split/paragraph/join inserts, `getTextboxActionPreview`, `performTextboxAction` with the font warning, "Log All Textboxes" | 500 |
| `editMarkers.ts` | `editMarkerActions.ts` | calibration state, the diagnostics trace and `saveEditMarkerDiagnostics`, preview context, raw stroke-point logging, `analyzeDeleteMarker`, `getEditMarkerPreview`, `applyEditMarkerPreview` | 800 |
| `textImport.ts` | `textboxImportActions.ts` | note context, import plan, preview, import | 240 |
| `textboxScan.ts` | `export/scanTextBoxes.ts` | pages to scan, page scan through the SDK (read only, no `storage/`) | 170 |

**`src/ui/`** keeps `pluginUiStyles.ts`. **`src/screens/`** gets the views, with their names
unchanged: `TextboxToolsView.tsx`, `DirectActionDialog.tsx`, `EditMarkerReviewView.tsx`,
`ImportTextFileView.tsx`, `ExportScreen.tsx` (977 lines; breaking it apart is a later step).

`src/shared/`, `src/export/` and the four top-level feature files are gone afterwards.

### 4.5 Rules for moving code

- **Code and comments move unchanged.** The only edits are imports, `export` keywords,
  parameters that replace module state or a direct SDK call (§4.2, §4.3, calibration), and the
  removal of exact duplicates. A throwaway script (not committed) compares every moved function
  body with the original after whitespace normalization; its result goes into As built.
- **A duplicate is merged only if it is identical.** Copies that differ (for example the two
  clipboard summaries, whose headers differ) become one function with a parameter that produces
  both texts exactly.
- **Comments that describe a file's place** ("This module owns…") are rewritten for the new
  module; comments with history or dates are not introduced.
- Each step keeps `npm run check` green (zero warnings) and is its own commit.

### 4.6 The one intended behaviour difference

The two `expectApiResult` copies in `src/export/` fall back to their default message with `??`,
the other copies with `||`. With one `assertApiSuccess`, an SDK error with an **empty** message
shows the fallback message ("Could not …") in the export too, instead of an empty error. This is
only visible if the host returns an empty error message.

## 5. Steps

Each step is one commit on `feature/layers`, green, with a "Device test:" block.

- **L1 - Remove dead code.** Delete `textboxStrikeAnalysis.ts` and the lab code (§3), and the
  then unused imports. Update the code tour in `docs/dev/README.md`. Device test: every toolbar
  button opens and "Log All Textboxes" still works.
- **L2 - Layer skeleton and simple moves.** Layer rules in `.eslintrc.js`; `domain/textboxModel.ts`
  and `supernote/domainTypeChecks.ts`; move the `shared/` files, `exportConfig.ts`,
  `pluginRouting.ts`, `permissions.ts`, `exportNoteContext.ts`, `exportScannedDocx.ts` and the
  views to their layers (`git mv` where the file moves whole, so history follows); split
  `supernoteTextboxLayout.ts` (§4.3) and pass `measureHeight` into pagination; `sdkResult.ts`.
  The three big feature files only get new import paths here. Tests: `backupPaths`,
  `diagnosticLog` and `fontPaths` move to `__tests__/domain/`; new tests for `geometry`,
  `textboxLayout` (fallback estimate, empty-line extra), `importParsing` (golden), pagination with
  a fake `measureHeight`.
- **L3 - Text actions.** `textboxActions.ts` → `domain/textSplitting.ts`,
  `domain/textboxEditPlan.ts`, `domain/textboxActionKinds.ts`, `domain/backupPayload.ts`,
  `supernote/noteElements.ts`, `storage/backupFile.ts`, `storage/exportFile.ts`,
  `actions/textboxEdits.ts`. Golden tests:
  sentence split (abbreviations, numbers, quotes, tiny fragments), paragraph split, cleanup,
  remove line breaks, join boundaries; edit plan (availability, page fit, collision); clipboard
  summary.
- **L4 - Edit markers.** `editMarkerActions.ts` → `domain/markerTypes.ts`,
  `domain/markerStrokes.ts`, `domain/markerText.ts`, `supernote/markerStrokeRead.ts`,
  `actions/editMarkers.ts`, using `storage/backupFile.ts`. Tests: stroke stats, replace-modifier
  pairing, text mutation ranges and word deletion, highlight merge, replacement-line parsing,
  edit-marker clipboard summary (byte-identical to today's header).
- **L5 - Import and export scan.** `textboxImportActions.ts` → `domain/importSettings.ts`,
  `storage/importFile.ts`, `actions/textImport.ts`; `scanTextBoxes.ts` →
  `domain/exportClassification.ts`, `actions/textboxScan.ts`. Tests: insert-mode decisions, page
  plan, export classification rules.
- **L6 - Documents and As built.** `DEVELOPMENT-POLICY.md` §3 (layer rules instead of "`src/shared/`
  is pure"; the "may only shrink" list goes away) and §4 (`ACTION_LABELS` location);
  `design-overview.md` §2 and §3; code tour in `docs/dev/README.md`; `CLAUDE.md` short version;
  `AGENTS.md` (`backupPaths` path); As built in this document.

Documents are updated in L1 and L6 rather than in every step: the moves in L2-L5 would otherwise
rewrite the same tables four times. The branch is only merged after L6, so `main` never has
documents that describe a half-moved structure. (Exception to policy §5, stated here.)

## 6. Tests and checks

- **Off the device**: `npm run check` after every step. The verbatim-move check (§4.5) for L2-L5.
  New Jest tests under `__tests__/domain/`, one file per domain module touched; the Jest
  configuration stays as it is (the two-project setup comes with the scenario tests in Phase 3).
- **On the device**, on a copy of a note, after L1 (short, see above) and after L5 (full, before
  the merge):
  1. Lasso one textbox with several sentences → Split Sentences → preview → apply → the same
     boxes as with 0.2.1; the result names a backup file; the clipboard holds the summary.
  2. Split Paragraphs, Join (three boxes in a column), Clean Spaces, Remove Line Breaks, each
     with preview and apply.
  3. Textbox Tools panel → Log All Textboxes → clipboard summary.
  4. Edit markers: a delete line through two words, a replace marker with a typed replacement,
     once with the lasso, once with "apply all" on the page; change the calibration offset in
     the review and see the preview move.
  5. Import a text file with headings and blank lines into a page that needs a second page.
  6. Export DOCX: current page, whole note, page range.
  7. Backups: the files in the plugin's backup folder have the same names and JSON fields as
     before.

## 7. Out of scope (stay on the backlog)

- `utils/log.ts` with a prefix and replacing the 40 `console.*` calls (20 after L1), including the
  `[TextboxHeightDebug]` line that logs up to 120 characters of the user's text.
- Kept GTD's measurement contract for `supernote/textboxMetrics.ts`.
- Kept GTD's `pluginPermissions.ts` (timeout) and English permission texts.
- Breaking `App.tsx` and `ExportScreen.tsx` into one file per screen; the button-routing effect.
- Making `analyzeDeleteMarker` pure (measure first, then analyze).
- A limit for old backups; the code-health script (file length, no dates in comments).
- Whether "Log All Textboxes" stays visible for users.

## 8. Decisions (approved 2026-11-15)

1. **The dead code (§3) is removed**, not put behind a debug switch. Condition: code needed to
   validate the edit-marker behaviour stays. Checked: none of the removed code is part of the
   marker path or its diagnostics. The marker path keeps its own log stages
   (`markerSourceResolved`, `markerTextboxMatching`, `markerLineCalibration`,
   `markerWordSelection`, `replaceSourceResolution`, `replaceResolutionMatched/Mismatch`,
   `markerRejected`, `previewContext`, calibration changes), the stroke, line and word log
   summaries, and the calibration controls in the review; all of them stay, and they are what
   Phase 3's stroke fixtures will be recorded from. `textboxStrikeAnalysis.ts` was a separate,
   earlier approach (live pen-up analysis); its one diagnostic the marker path lacks,
   `strokeCoordinateComparison`, compares EMR and pixel coordinates, which sn-plugin-lib 0.2.x
   no longer uses. The lab code validated textbox height measurement, not markers; its one
   helper the new "Save Diagnostics" uses, `writeJsonExportFile`, stays (§3). Both remain
   readable in git at `1fbbe4d`.
2. **A separate `actions/` layer** for the flows; `storage/` holds only file I/O (§4.1).
3. **Own domain types (§4.2)**, so an SDK update shows up as a compile error in one place.
4. **The empty-message fallback (§4.6)** is accepted as the only behaviour difference.
