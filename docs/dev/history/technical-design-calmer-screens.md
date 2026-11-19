# Technical design: Calmer screens

Status: **done** (2026-11-17); see §9 As built. Requirements (D1–D29, O1–O7, C1–C5, I1–I4) were decided in conversation and are kept in the claude.ai project document `claude/feature-calmer-screens.md`; the UI mockup is the design canvas "Textbox Tools Calmer Screens".

**Base:** `main` after the layers work (L1–L6, `b2b5c3b`) and the INBOX fix. The device folder is spelled `INBOX`. File names below are the post-layers ones (`technical-design-layers.md` §4.4). Branch `feature/calmer-screens`, merged `--no-ff` after the last device stop. Own release (minor version, "Changed" in the CHANGELOG plus the rename).

## 1. Requirements as decided (short)

- Every screen: header (title, context, Details/Rules, ?, Close), a body that never scrolls, a footer with the status line and one primary button that names the action. Sub-screens with ‹ Back and Done. Kept GTD's look and paging (‹ › only when there is more, "+N"). E-ink refresh on page and screen changes.
- Edit markers: changes list left (Changes / Ignored tabs), one textbox at a time right with removed words struck through and inserted words bold, all or nothing. Calibration and diagnostics move to Details. Warning when the font couldn't be read.
- Lasso actions: action list left incl. Split Paragraphs, unavailable ones greyed with a reason; After / Before right; one available action is preselected; Log All Textboxes moves to Details.
- Import: settings left, automatic preview of page 1 to scale right, a file list, Layout sub-screen. Export: automatic scan, list of what will be exported, Rules sub-screen.
- Review screens stay open after a change, the button turns into Close; direct (toolbar) actions keep closing after 0.7 s and keep having no preview (policy exception).
- Import settings, Export scope and rules, and the edit-marker calibration are remembered in a JSON file in the plugin folder.
- Display name "Textbox Tools". No `.md` import. Landscape must not break.

## 2. Current state (after layers)

- **`App.tsx`** (~760 lines) holds all screen state: one `viewMode` (`routing | tools | markers | direct | import | exportDocx`), the previews, busy flags, status and backup path for every screen, the button routing effect (with an eslint-disable, backlog), and the render switch.
- **Screens** in `src/screens/`: `TextboxToolsView.tsx`, `EditMarkerReviewView.tsx` (collapsible sections Recognition / Calibration / Help), `ImportTextFileView.tsx` (collapsible help), `ExportScreen.tsx` (977 lines, own state incl. the classification config and a `config` sub-view), `DirectActionDialog.tsx`. Each one is a `ScrollView`. One style sheet: `ui/pluginUiStyles.ts`.
- **Edit-marker preview** (`actions/editMarkers.ts`, types in `domain/markerTypes.ts`): `beforePreviewBlocks` (original text + ranges of the marked words) and `afterPreviewBlocks` (new text + ranges of inserted text) per affected textbox, `operations` (kind, `targetTextboxUuid`, `targetTextboxNumInPage`, `lineIndex`, `words`, `replacementText`), `ignoredMarkers` (summary, reason). Found on the way: the inserted ranges are computed *before* `normalizeTextAfterEdit` collapses spaces, so the bold highlight in today's "Changed" box can drift by a few characters after a deletion with double spaces. The new diff (§3.4) doesn't depend on them.
- **Calibration** lives in module state of `actions/editMarkers.ts`, for the plugin process lifetime; it becomes part of the settings file (§3.9).
- **Lasso preview** (`domain/textboxEditPlan.ts` `computeActionOutputs`): availability is "exactly 1 textbox" for split/clean/unwrap, "2 or more in one clear column" for join; `splitParagraphs` has no preview (direct action only). An action whose output equals the input is still "available".
- **Import preview** (`actions/textImport.ts`): reads the file and the current page's elements, builds the full plan (`pages[].chunks[]` with text, rect, fontSize, bold) but returns only counts and start/end text. `insertMode` ('auto' | current page | after current page) is a setting; the screen shows the effective mode.
- **Export**: `actions/textboxScan.ts` + `domain/exportClassification.ts`; style rules are tri-state (`StyleRequirement = 'any' | 'yes' | 'no'`) per class plus min/max size. Config and scope live in `ExportScreen` state, lost on close.
- **Nothing is persisted** except backups and exports.
- **Name**: `PluginConfig.json` `"name": "Textbox Helper"`; the permission message and some texts say "Textbox Helper"; the screens say "Textbox Tools".

## 3. Design

### 3.1 UI foundation (`src/ui/`, `src/utils/`)

Taken from Kept GTD where it has the piece, trimmed of Kept-only dependencies (perf tracing, `useLayoutClass`, generated docs):

| Module | From | Contents |
|---|---|---|
| `ui/theme.ts` | Kept `ui/theme.ts` | `FONT`, `SPACING`, `RADII`, `COLORS` (white, black, `#dddddd` lines, `#555`/`#767676` secondary text). Light only (the device has no dark mode in the plugin). |
| `ui/ScreenFrame.tsx` | new, after Kept's `WizardFrame` | props `title`, `context?`, `back?: {label, onPress}`, `headerActions?: {label, onPress}[]` (Details / Rules / ?), `onClose`, `status`, `primary: {label, onPress, disabled?, busy?, busyLabel?}`, `children`. Root `flex: 1`; body `flex: 1` (bounded, so paged children can measure); header and footer fixed height. Calls `requestEinkRefresh()` when `screenKey` changes. |
| `ui/PillButton.tsx`, `ui/Segmented.tsx`, `ui/Checkbox.tsx`, `ui/CountTabs.tsx` | Kept `PillButton`, `MiniTabs` (simplified); `Segmented`, `Checkbox` new | `Segmented` also in a small variant for the rules table (Any / Yes / No). `CountTabs` hides a non-fixed tab with count 0. |
| `ui/pagination.ts`, `ui/useMeasuredHeight.ts`, `ui/PagedSection.tsx` | Kept, verbatim except imports | height-driven paging of rows, header with ‹ › and "+N", self-measuring in a bounded flex column. |
| `ui/PagedText.tsx` | new (§3.2) | long styled text in a fixed box, paged by lines. |
| `ui/HelpOverlay.tsx` | new, simple | covers the body; the screen's help text (from `domain/helpTexts.ts`) in a `PagedText`; Close. No markdown, no links. |
| `utils/screenRefresh.ts` | Kept | debounced `invalidatePluginView()` after two animation frames; logging through `console` with the `[TextboxTools]` prefix until `utils/log.ts` exists. |

`ui/pluginUiStyles.ts` is deleted at the end. **Rule against scrolling:** ESLint `no-restricted-imports` for `ScrollView` (and `FlatList`, `SectionList`) from `react-native` in `src/` and `App.tsx`, with the message "Page instead of scrolling (ui/PagedSection, ui/PagedText)". DEVELOPMENT-POLICY §4 gets the rule.

Sizes are in dp as everywhere in RN. Kept's values are used unchanged (FONT 22/17/15); the canvas is drawn at device pixels, about 1.6× these.

### 3.2 `PagedText`

Input: `segments: {text: string; style?: 'removed' | 'inserted' | 'heading' | 'muted'}[]`, optional `jumpToChar` (shows the page holding that character), `resetKey`.

1. A hidden copy (`position: absolute`, `opacity: 0`, same width and font as the visible box) renders all segments as nested `<Text>` and reports `onTextLayout` → `lines[]` (each with `y`, `height` and `text`).
2. Line start offsets come from summing `lines[i].text.length`. Pages are greedy: as many lines as fit the measured box height (`useMeasuredHeight`).
3. The visible box renders only the current page: the segments cut to `[pageStart, pageEnd)`.
4. Header row of the box: ‹ › when there is more, "+N lines" hidden like `PagedSection`'s "+N".

Pure parts in `domain/textPages.ts` (unit-tested): line offsets → page ranges, cutting segments to a range, the page that holds a character. **Device risk:** `onTextLayout` must report lines on the host's RN version; checked in stage 1 with a test screen. Fallback if not: pages by paragraph, a too-long paragraph clipped with `numberOfLines` and "…", noted in As built.

### 3.3 Screens and App

One folder per screen, each file well under 1,000 lines:

- `screens/markers/` `EditMarkerReviewScreen.tsx`, `MarkerDetailsScreen.tsx`, `useEditMarkerReview.ts` (preview, scope, busy, apply, calibration and diagnostics calls; today's `App.tsx` callbacks moved).
- `screens/tools/` `TextboxToolsScreen.tsx`, `ToolsDetailsScreen.tsx` (Log All Textboxes), `useTextboxTools.ts`.
- `screens/direct/DirectActionDialog.tsx` + `useDirectAction.ts`.
- `screens/import/` `ImportScreen.tsx`, `ImportLayoutScreen.tsx`, `PagePreview.tsx`, `useImportPreview.ts`.
- `screens/export/` `ExportScreen.tsx`, `ExportRulesScreen.tsx`, `useExportScan.ts`.

`App.tsx` keeps permission check, button routing and `screen: 'routing' | 'tools' | 'markers' | 'direct' | 'import' | 'export'` plus a `button` key, so a screen remounts (fresh state) when its button is pressed again. Sub-screens (Details, Layout, Rules, Help) are local state of their screen; the screen's hook stays mounted underneath, so going back keeps the preview. The routing effect subscribes once and calls the latest `routeButton` through a ref (removes the eslint-disable; backlog item). Target: `App.tsx` ≤ 200 lines.

Status line: each screen hook owns `status: {text, kind: 'info' | 'error'}`; errors are shown as text (no colour) and logged with the cause. `domain/userMessage.ts`: `userMessage(error, fallback)` returns the error's own message when it is a plain sentence from our code (an `Error` we threw), otherwise the fallback; the raw `String(error)` goes to the log only (C3).

### 3.4 Edit markers

**Pure diff** `domain/markerDiff.ts`: `buildDiffSegments(originalText, ranges: TextMutationRange[])` → `{text, style?}[]`: unchanged text, the removed range (`'removed'`), and for a replace the replacement right after it (`'inserted'`). Built on the original text and the same unique, sorted ranges `applyTextMutationRangesDetailed` uses (`getUniqueTextMutationRanges` moves to `domain/markerText.ts` if it isn't there after L4), so it can't drift. Whitespace cleanup after the edit is not shown (it only collapses spaces). Tests: delete in the middle, at start and end, two deletes in one line, replace, overlapping duplicates, empty replacement.

**Preview type** (`domain/markerTypes.ts`): `EditMarkerPreview` gains `textboxes: {uuid, numInPage, segments, operationIds}[]` in reading order and `fontWarning: string | null`. `beforePreviewBlocks`/`afterPreviewBlocks`/`beforeBlocks`/`afterBlocks` are removed if nothing else reads them (checked in the step; the backup payload is built from the apply plan, not from them). `scope` is already known to the caller.

**Font warning (I1):** the preview runs the same font check the apply step uses today (the 0.2.2 warning from `domain/fontPaths.ts` / `supernote/textboxMetrics.ts` `typefaceStatus`) for the affected textboxes and fills `fontWarning` ("Measured with the system font: word positions may be off."). Shown as the status line on open, before any apply.

**Screen:** header context `Page 3` / `Lasso selection` + `· 4 changes · 1 ignored` (plural helper `domain/plural.ts`). Left: `CountTabs` Changes / Ignored, `PagedSection` rows (`Delete` / `Replace`, the words or "old → new", `Textbox 12 · line 6` with line = `lineIndex + 1`). Right: `PagedText` of the selected textbox; header "Textbox 12 · 3 changes", ‹ › between textboxes ("+1 textbox"). Tapping a change selects its textbox and `jumpToChar` = start of its first range. Empty state (D15): the help text's "How to mark" part in the body. Primary `Apply 4 changes`; while busy `Applying…`; after success the status shows the result and the backup file name and the primary is `Close` (O1: no auto-close here any more). Details: scope line, calibration controls (same functions as today; every change and Reset also saves it, §3.9), Save Diagnostics (status shows the file name).

### 3.5 Lasso actions

**Availability with reasons** (`domain/textboxEditPlan.ts`): `computeActionOutputs` additionally returns `reasons: Partial<Record<TextboxActionKind, string>>` and a `splitParagraphsBlocks` preview (the paragraph split from `domain/textSplitting.ts`). Reasons: `"needs exactly 1 textbox"`, `"needs 2 or more textboxes"`, `"textboxes are not in one column"` (the `ensureClearlyOrderedColumn` failure), and `"nothing to change"` when the output equals the input (clean, unwrap, split and split-paragraphs into one block). An action with a reason is shown greyed and can't be chosen on this screen. `availableActions` keeps its meaning for the direct actions, so the toolbar behaviour doesn't change.

`ACTION_ORDER` (screen list) = split, splitParagraphs, join, clean, unwrap; `log` leaves the list and appears only in Details. `domain/textboxActionKinds.ts` gets one table per action: `label`, `progressLabel`, `applyLabel` ("Apply Join") (C2, merges `ACTION_PROGRESS_LABELS` from `App.tsx`).

**Screen:** context "2 textboxes selected". Left: the five actions (`PillButton`-style rows), selected one bold with border. Right: `CountTabs` After / Before, the blocks in a `PagedSection` (one row per block, blocks separated by a thin line instead of "----"), "2 textboxes → 1". Exactly one available action → preselected (O6). After success: status with the result and backup name, primary `Close`.

### 3.6 Direct-action dialog

Same frame look in a small centred card (title = action label, progress text, Cancel while `canCancel`, Close). Behaviour unchanged: closes 0.7 s after success; Cancel before changes. DEVELOPMENT-POLICY §2 gets the exception (O7): "Toolbar actions on a lasso selection apply without a preview: the tap on the selection is the explicit act. The backup is written first as for every change."

### 3.7 Import

- **Settings** come from the settings file (§3.9); every change writes it (debounced 1 s).
- **File selection** `supernote/fileSelector.ts` `chooseImportFile()`: `RattaFileSelector.selectFile({selectType: 1, suffixList: ['txt'], maxNum: 1, title: 'Choose a text file', rightButtonText: 'Choose', needSelectFolder: '/storage/emulated/0/INBOX', limitPath: '/storage/emulated/0/INBOX'})`, wrapped in `withTimeout`; `null`/empty = cancelled (nothing changes). The returned absolute path must start with the Inbox folder (checked in `domain/importSettings.ts`, tested); it is stored as the path relative to Inbox, so files in subfolders of Inbox work. `sourceFolder` and the `MyStyle/TextboxHelper/inbox` folder go; a stored `myStyle` value or a missing file falls back to "No file chosen". The left column shows the file name and "Inbox/…" plus "Choose ›"; there is no typed file name.
- **Automatic preview** `useImportPreview`: runs on open and 500 ms after the last settings change; a sequence number drops results of older runs. The SDK page read happens on every run, as in today's preview; measured on the device in stage 4 (if it is slow, the page elements are read once per screen visit and reused, a small change in `actions/textImport.ts`).
- **Preview data**: `TextboxImportPreview` gains `pageSize` and `pages: {chunks: {text, rect, fontSize, bold}[]}[]` (the first 3 planned pages; counts stay for all). `PagePreview.tsx` draws one page scaled to the column: a bordered box with the page's aspect ratio, each chunk absolutely positioned at `rect × scale`, its text at `fontSize × scale` (min 8 dp), clipped to its rect. ‹ › between the planned pages, "+N pages" when more than 3 exist. Header context from `effectiveInsertMode`: "into page 3" / "on new pages after page 3".
- **Errors** (no file, empty file, margins leave no room) show in the preview area with `userMessage`, not only in the status.
- **Layout sub-screen**: paragraph font size and the four margins, Reset to defaults (D23). Heading sizes stay on the main screen (D20), shown only with # on.
- **Help** (?): today's formatting help text, moved to `domain/helpTexts.ts`.
- After a successful import: status with the result, primary `Close`.

### 3.8 Export

- `ExportScreen.tsx` is split into the screen, `ExportRulesScreen.tsx` and `useExportScan.ts` (scan state, auto-scan, export) (C5).
- **Automatic scan** on open and 500 ms after scope, range, comments or rules change; a sequence number drops stale results. Page range scans start only when both fields hold valid numbers.
- **Header context**: the note file's name without folder and extension (from `exportNoteContext.filePath`) and "page 3 of 3".
- **List**: `getIncludedScanItems` rows in a `PagedSection`: class (small caps), first line of the text, `p. N`. Summary line from `getIncludedRoleCounts` (only non-zero classes). "Excluded styles" and the safety limit appear as one status line only when they apply.
- **Rules sub-screen**: the title-area option and a table class × min size, max size, bold, italic, border; the three style columns use the small `Segmented` Any / Yes / No (tri-state, as `StyleRequirement` is). Reset to defaults. Invalid numbers show inline in the row and keep the last valid rules for scanning (today's `parseEditableConfig` behaviour).
- Primary `Export DOCX`; status after export names the file in EXPORT.

### 3.9 Settings file

- `domain/settingsModel.ts` (pure): `PluginSettings = {version: 1, import: TextboxImportSettings, export: {scope, includeComments, rules: ExportClassificationConfig}, markers: {calibration: EditMarkerCalibration}}`. `parseSettings(json)` fills every missing or invalid field from the defaults (field by field, so one bad value doesn't reset the rest) and ignores unknown keys; `serializeSettings`. Page range is not stored (it belongs to one note).
- `storage/settingsFile.ts`: `<pluginDir>/settings.json` (path through `domain/backupPaths.ts`-style helper, `/` only). `loadSettings()` once at start (a missing or unreadable file → defaults, logged); the loaded calibration is handed to `setEditMarkerCalibration` before the first preview; `saveSettings()` debounced 1 s, a failed write logged and shown once in the status ("Settings could not be saved").
- Host facts §1 and README (where data is written) get the new file.

### 3.10 Rename to "Textbox Tools"

`PluginConfig.json` `name`; the permission message; README title and text; `docs/dev/*` where they name the plugin; log prefix stays per module. **Not renamed:** `pluginID`, `pluginKey` (`textboxHelper`), the folders `MyStyle/TextboxHelper/...` (users' files live there), the repo. CHANGELOG "Changed: the plugin is now called Textbox Tools".

## 4. Edge cases

- Marker review: a textbox with changes on several of its pages → tapping each change jumps to its page; one textbox taller than the box and with no changes doesn't occur (only affected textboxes are listed).
- Marker review with only ignored markers: Changes tab shows the empty state, Ignored is selected; primary disabled ("Apply 0 changes" is not shown; label "Nothing to apply").
- Lasso screen opened with no textbox selected: the left list is greyed with "select textboxes with the lasso"; Details still offers Log All Textboxes (it reads the whole page).
- Import file deleted or renamed after it was chosen: preview area shows "File not found" and "Choose ›".
- File selector cancelled: nothing changes. Selector returns a path outside Inbox (if `limitPath` isn't enforced): refused with "Choose a file in Inbox".
- Import settings file from a future version (higher `version`): read field by field as today, unknown keys ignored, not rewritten until a setting changes.
- Export of a whole long note: the scan shows "Scanning page n of m…" in the list area if the scan reports progress; otherwise "Scanning…".
- Landscape (1872 wide, 1404 high): columns keep their widths, paged areas get fewer rows; nothing overlaps (device check).
- Manta (1920 × 2560): same dp layout, more rows per page.

## 5. Files

New: `ui/theme.ts`, `ui/ScreenFrame.tsx`, `ui/PillButton.tsx`, `ui/Segmented.tsx`, `ui/Checkbox.tsx`, `ui/CountTabs.tsx`, `ui/pagination.ts`, `ui/useMeasuredHeight.ts`, `ui/PagedSection.tsx`, `ui/PagedText.tsx`, `ui/HelpOverlay.tsx`, `utils/screenRefresh.ts`, `supernote/fileSelector.ts`, `domain/textPages.ts`, `domain/markerDiff.ts`, `domain/plural.ts`, `domain/userMessage.ts`, `domain/helpTexts.ts`, `domain/settingsModel.ts`, `storage/settingsFile.ts`, the `screens/*/` files of §3.3.

Changed: `App.tsx`, `domain/markerTypes.ts`, `actions/editMarkers.ts` (preview fields, font check), `domain/textboxEditPlan.ts` (reasons, split-paragraphs preview), `domain/textboxActionKinds.ts` (label table, order), `actions/textboxEdits.ts` (passes reasons), `actions/textImport.ts` (pages in the preview), `supernote/permissions.ts` (text), `PluginConfig.json`, `.eslintrc.js` (no ScrollView), README, CHANGELOG, `docs/dev/DEVELOPMENT-POLICY.md` (§2 exception, §4 paging rule and name), `docs/dev/design-overview.md` (screens, UI foundation, settings file), `docs/dev/supernote-host-facts.md` (settings file, `onTextLayout` finding).

Deleted: `ui/pluginUiStyles.ts`, `screens/TextboxToolsView.tsx`, `screens/EditMarkerReviewView.tsx`, `screens/ImportTextFileView.tsx`, `screens/ExportScreen.tsx`, `screens/DirectActionDialog.tsx` (replaced by the folders).

## 6. Tests

**Jest (unit):** `markerDiff` (cases in §3.4), `textPages` (offsets, greedy pages, cutting styled segments, page of a character), `plural`, `userMessage`, `settingsModel` (defaults, partial and invalid files, unknown keys, round trip), availability reasons and the split-paragraphs preview in `textboxEditPlan`, import preview page data (chunk scaling helper), export summary text. **Component tests** where cheap with `react-test-renderer`: `PagedSection` arrows only when there is more; `ScreenFrame` primary disabled/busy label.

**Device checklist** (A5 X; Manta or Nomad and landscape once at the end), on a copy of a note:
1. Stage 1: `PagedText` test screen: lines reported, pages break at line ends, ‹ › and "+N"; e-ink refresh on page change.
2. Edit markers: page button and lasso button; Changes/Ignored; jump to change; strikethrough and bold readable; Apply; result and Close; Details calibration and Save Diagnostics; font warning with a ".data" font.
3. Lasso actions: each action incl. Split Paragraphs; greyed reasons; one-action preselect; Apply; Log in Details. Direct toolbar actions unchanged.
4. Import: Choose › opens the Supernote selector in Inbox, only `.txt` visible, can't leave Inbox, cancel keeps the file, a file in an Inbox subfolder works; preview updates after a change (time it); page drawing matches the imported result; errors in the preview area; settings survive closing the plugin.
5. Export: auto-scan on open and on scope change; list paging; rules tri-state; settings survive; DOCX content unchanged against a 0.2.x export of the same note.
6. Name "Textbox Tools" in the plugin list and permission text; no screen scrolls; landscape and a second device.

## 7. Steps and device stops

Each step ends with `npm run check` green and its own commit; help texts, CHANGELOG and docs change in the step that changes the behaviour.

1. **S1 Foundation:** theme, `ScreenFrame`, buttons, `Segmented`, `Checkbox`, `CountTabs`, paging (Kept), `PagedText` + `domain/textPages.ts`, `HelpOverlay`, `screenRefresh`, ESLint rule (still allowing the old screens via a per-file disable that each later step removes). Device stop 1 with a temporary test screen behind Details of the lasso screen (removed in S3).
2. **S2 Edit markers:** `markerDiff`, preview fields, font warning, new screen + Details, `App.tsx` routing for markers. Device stop 2.
3. **S3 Lasso and direct:** reasons, split-paragraphs preview, label table, new screen + Details, direct dialog look, policy exception. Device stop 3 (together with stop 2 if both are ready).
4. **S4 Settings file and Import:** `settingsModel`, `settingsFile`, file list, preview pages, new screens. Device stop 4.
5. **S5 Export:** split, auto-scan, list, rules. 
6. **S6 Rename and cleanup:** name, permission text, delete `pluginUiStyles.ts` and the old screens, remove the per-file ESLint disables, `App.tsx` ≤ 200 lines, docs (design overview, host facts, README), As built. Device stop 5 (full checklist incl. landscape and a second device), then merge and release.

## 8. Open points

- **T1** `onTextLayout` on the host (§3.2): confirmed in S1, fallback defined.
- **T2** Import preview speed with the page read on every change (§3.7): measured in S4.
- **T3** Does `scanTextBoxes` report progress for a whole note? If not, "Scanning…" only (no change to the scan in this feature).
- **T5** The file selector (`selectFile` with `limitPath`) on the device: does it hide other file types and keep the user inside Inbox? Checked in S4; host facts get the result.
- **T4** Calibration is remembered between sessions (decided 2026-11-16, §3.9). Calibration values out of a sane range (|X| or Width > 200 px) fall back to the defaults when read.

## 9. As built

Built in four commits on `feature/calmer-screens` (S1, S2, S3, S4+S5 together) plus a fix commit
after the device test and the S6 commit. 82 → 113 Jest tests. `App.tsx` 764 → 150 lines; the
largest screen file has about 300 lines. No `ScrollView` is left; ESLint forbids it.

Deviations from the design:

- **Order.** S4 and S5 were one commit. `ui/pluginUiStyles.ts` and the old screens were deleted in
  the step that replaced them, so S6 had no screens left to remove; the per-file ESLint exceptions
  went with the files.
- **S1 test screen.** The temporary paging test screen sat behind a "Paging test" button on the
  old lasso screen (there was no Details yet) and was removed in S3 as planned. It was not tested
  on the device; S2 and S3 were tested together instead. `onTextLayout` reports lines on the
  device (T1), so `PagedText` pages by lines; the fallback was never needed.
- **Direct actions** are `screens/direct/DirectActionScreen.tsx` (one component with its effect),
  not a dialog plus a hook.
- **Lasso screen preview.** One read of the lasso builds every action's result
  (`afterBlocksByAction`), so switching actions doesn't read the lasso again. Before/After are
  shown as one paged text with a muted "Textbox n" line per block, not as a `PagedSection`.
- **Settings write failures** are logged, not shown in the status line (§3.9 said "shown once").
  The settings stay in memory for the session.
- **Import file selection** uses the Supernote file selector (decided during the design, §3.7);
  there is no file list of our own. Confirmed on the device: opens in INBOX, only `.txt`, can't
  leave INBOX (T5). The second import folder and the typed file name are gone; no file is chosen
  by default.
- **Import preview drawing.** The first build used a fixed line height and the full textbox
  width, so the last line of most textboxes was cut off. Fixed by laying out the text like the
  measurement (Android's natural line height, width minus the calibration's width adjustment)
  and clipping only at the page edge. Preview speed with the page read on every change is fine
  (T2).
- **Progress redraw.** Status changes during an import came without a touch and weren't drawn.
  `ScreenFrame` now requests an e-ink refresh when the status text or the primary label changes.
- **Import stopping after its first page** happened once on the device and not on the retry with
  the same file and note. Cause unknown; every `insertNotePage`/`insertElements` result is now
  logged (`[NoteTextInsertion]`) and a failed insert names the textbox and page.
- **Export** keeps "Export DOCX" as its primary button after an export (the note isn't changed,
  so there is nothing to close over); the status names the file. The scan reports no progress, so
  the list says "Scanning…" (T3).
- **Rules screen.** The small Any / Yes / No switches were too narrow and showed "…"; their
  columns are wider and their padding smaller.
- **Calibration** is remembered between sessions (T4); values beyond ±200 px read as defaults.
- **Permission request** text is English and names the plugin; the timeout from Kept GTD is
  still open (backlog).
- **Rename (S6).** Display name "Textbox Tools" in `PluginConfig.json`, the permission text,
  README, CHANGELOG, CLAUDE/AGENTS/CONTRIBUTING and `docs/dev/`. Unchanged: `pluginID`,
  `pluginKey` (`textboxHelper`), the repository, the `.snplg` file name, `MyStyle/TextboxHelper/`.

Device checks still open at the merge: landscape, a second device (Manta or Nomad), and the
exported DOCX compared with a 0.2.x export.
