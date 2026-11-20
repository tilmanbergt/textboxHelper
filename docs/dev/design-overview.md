# Textbox Tools - design overview

> **About this document.** How the plugin is built and why: the flow from a button press to a
> changed note, the layers, the features and where they live. Living document:
> present tense, no history, no plans. Update it in the same change that moves a responsibility
> or adds a module. The binding rules are in `DEVELOPMENT-POLICY.md` §3.

The plugin is organized around the Supernote plugin workflow - a button press, a preview, a
confirmed change to the open note - rather than around a generic editor architecture.

## 1. From button press to changed note

1. A toolbar button press enters through `index.js`, where every button is registered: the
   lasso toolbar (split, join, clean, remove line breaks, the pen-text tag, the Textbox Tools
   panel) and the NOTE toolbar (Manuscript, import a text file, export DOCX). The
   button ids are in `src/domain/buttonIds.ts`.
2. `src/supernote/pluginRouting.ts` receives the press and forwards it into React Native as an
   event; a press that arrives before the app listens is kept as pending and picked up at start.
3. `App.tsx` makes sure the file permissions are granted, then routes the button to a screen: the
   Textbox Tools panel, the direct-action dialog, the Manuscript card, the import view or the
   export screen.
4. The action flow in `src/actions/` builds a **preview**: it reads the lassoed or page elements
   through `src/supernote/`, lets `src/domain/` compute what would change, and the screen shows it.
5. After the user confirms, the flow writes a **backup** of the affected text
   (`src/storage/backupFile.ts`: a JSON file in the plugin folder plus a summary on the clipboard),
   then changes the page elements through `src/supernote/` and saves the note. The result message
   names the backup file.

## 2. Layers

The code under `src/` is split into layers; ESLint (`.eslintrc.js`) enforces which layer may
import which (`DEVELOPMENT-POLICY.md` §3).

| Layer | Holds | Imports |
|---|---|---|
| `domain/` | Pure logic and its types: text splitting, edit plans, marker recognition math, pagination, import planning, export classification, backup payloads. No React Native, no SDK, no I/O. | `domain/` only |
| `utils/` | Cross-cutting helpers: the edit-marker diagnostics trace (`editMarkerLog.ts`). | `domain/` |
| `supernote/` | Everything that talks to the device: `sn-plugin-lib` calls (`noteElements.ts`, `noteTextInsertion.ts`, `markerStrokeRead.ts`, `exportNoteContext.ts`), the native measurement (`textboxMetrics.ts`), routing and permissions. | `domain/`, `utils/` |
| `storage/` | File I/O: backups (`backupFile.ts`), JSON into EXPORT (`exportFile.ts`), the import text file (`importFile.ts`), DOCX (`docxExport.ts`), pen edits (`penEditStore.ts`). | the three above |
| `actions/` | The flows behind the buttons: preview, backup, change. | everything above |
| `ui/` | Shared building blocks of the screens: `ScreenFrame`, `PillButton`, `Segmented`, `Checkbox`, `CountTabs`, paging (`pagination.ts`, `PagedSection`, `PagedText`), `HelpOverlay`, `MarkHelp` (the edit-marker help with pictures, technical-design-mark-help.md), `NumberField`, `theme.ts` (technical-design-calmer-screens.md). | everything above |
| `screens/` | One file per screen or dialog. | everything |

An action has three parts: what changes (`domain/`), reading and changing the note
(`supernote/`) and files (`storage/`). `actions/` ties them together; an action that needs no
file doesn't import `storage/`.

`domain/textboxModel.ts` holds the page shapes the pure logic works with (`Rect`, `TextboxData`,
`PageElementData`, the element type constants). They are structural subsets of the SDK types, so
SDK values pass into domain functions unchanged; `supernote/domainTypeChecks.ts` makes the type
check fail if the SDK types drift away from them.

## 3. Features

### Screens and `App.tsx`

`App.tsx` owns permissions and button routing; it opens one screen per button, keyed by the press,
so a screen opened again starts fresh. The button listener subscribes once and calls the latest
router through a ref. Screens are built on `ui/ScreenFrame.tsx` and own their state in a hook next
to them: `screens/manuscript/` (the Manuscript card: `ReviewTab` with its page strip and side bar `ChangeSide`, `OutlineTab`, and Details; the page states are `domain/manuscriptPages.ts`, the outline `domain/outlineModel.ts` with statuses in `storage/blockStatusStore.ts` and block tags `domain/blockTag.ts`), `screens/tools/` (the lasso screen,
its Details with "Log All Textboxes"), `screens/direct/` (the toolbar actions' progress card),
`screens/import/` (Import with its Layout sub-screen and the page drawing), `screens/export/`
(Export with its Rules sub-screen). Every sub-screen (Details, Layout, Rules) is local state of its
screen, whose hook stays mounted underneath, so going back keeps the preview.

What the plugin remembers between sessions - the import settings, the export scope and rules,
the edit-marker calibration - is `domain/settingsModel.ts`, stored by `storage/settingsFile.ts`
as `settings.json` in the plugin folder: read once at start (before the first screen), written
1 s after the last change, read field by field so a bad value never resets the rest.
`src/domain/textboxActionKinds.ts` holds one label and one progress text per action kind
(`ACTION_LABELS`, `ACTION_PROGRESS_LABELS`) and the lasso screen's order (`ACTION_ORDER`).

### Textbox actions (`actions/textboxEdits.ts`)

Direct textbox editing: split by sentence, split by paragraph, join in reading order, clean
repeated spaces, remove manual line breaks, and "Log All Textboxes". The flow finds the textboxes
in the lasso, `domain/textSplitting.ts` computes the new texts, `domain/textboxEditPlan.ts` the
preview of every action at once (with the reason an action can't be chosen), the new textboxes
and the checks that the result fits the page without colliding with other elements; the new textboxes are sized through the native measurement.

### Edit markers (`actions/markerPageAnalysis.ts`, `actions/markerApply.ts`, `actions/editMarkerAnalysis.ts`, `actions/shapeMarks.ts`)

Handwritten edit markers on textboxes: a delete marker is a line through words; a replace marker
is a delete line plus a small loop (or two crossing lines); a < or >, or a step mark with a second
upright (_||‾), breaks a paragraph; a ∧ or V with a cross inserts a space; the swap mark (a line
above one part and below the next, joined by a vertical, in one stroke or in three pieces across
lines) swaps two parts. Freehand strokes and the Supernote straight-line tool are both recognized.
`supernote/markerStrokeRead.ts` reads the strokes; `actions/markerMeasure.ts` measures each
textbox once per review and locks textboxes whose font can't be read (their marks are ignored);
`actions/shapeMarks.ts` reads the marks known by their shape first (`domain/paragraphMarks.ts`,
`domain/spaceMark.ts`, `domain/swapMark.ts`), and their strokes never reach the delete analysis;
`actions/editMarkerAnalysis.ts` maps one marker to words through the hit-testing core and the
native measurement (with each letter's edge, `domain/textOffsets.ts`);
`actions/markerPageAnalysis.ts` pairs replace marks with their tagged text, places insertions and
builds the preview of the current page in named steps; `actions/markerApply.ts`
applies the plan; `actions/markerCalibration.ts` keeps the calibration and saves the diagnostics. The pure parts are in
`domain/markerStrokes.ts`, `domain/markerText.ts`, `domain/markerTypes.ts`,
`domain/markerAssembly.ts`, `domain/swapText.ts` (a swap makes the changes inside its parts
first) and `domain/edgeShift.ts` (one to three edges per change). The analysis runs once; the
preview is assembled from it, the tagged texts and the user's edge nudges (one character at a
time), so the review updates without measuring again. It lists every change as a hunk in reading
order (`domain/markerHunks.ts`): the changed text with the removed ranges struck through and new
text in bold (`domain/markerDiff.ts`), and the rest of its textbox as context, built from the same
ranges the apply step uses, so the review shows exactly what will change.
`actions/editMarkerDrop.ts` takes changes off the page without applying them.

**Pen edits** (`actions/penEditTag.ts`, `actions/penEditReview.ts`, `storage/penEditStore.ts`,
`domain/penEdit*.ts`): the "Insertion or Replacement" lasso button tags handwritten new text. The
mark written just before it (a replace mark or a caret) decides what it is; badges with a number
on the page show which text belongs to which mark. A snippet without a mark can be given one later
(Select mark). The tagged strokes and a picture are stored in the plugin folder (`pen-edits/`);
the review recognizes them while it is open and the user can edit the text in place.

Every stage of a marker preview is also recorded in memory (`utils/editMarkerLog.ts`); "Save
Diagnostics" (review → Details) writes that trace, with the stroke's raw sample points next to
the points recognition used, as JSON to the EXPORT folder - only when the user taps it.

### Text import (`actions/textImport.ts`)

Import of a UTF-8 text file from `INBOX` (the folder's exact name on the device), chosen with the
Supernote file selector (`supernote/fileSelector.ts`, limited to INBOX and `.txt`), into textboxes:
paragraphs split by blank lines (by default), markdown headings detected and set in larger bold
text, the text paginated over the current page and new pages as needed. Settings and paths are
in `domain/importSettings.ts`, parsing in `domain/importParsing.ts`, the page plan in
`domain/importPlan.ts`, the pagination in `domain/*Pagination.ts` (the height measurement is
passed in, so it is tested without the device). The preview carries the first planned pages, which
the Import screen draws to scale; it runs by itself 500 ms after a settings change.

### DOCX export (`actions/textboxScan.ts`, `storage/docxExport.ts`)

Reads the note context, scans the textboxes of the current page, the whole note or a page range,
classifies them (heading, paragraph, comment, meta) by configurable rules
(`domain/exportConfig.ts`, `domain/exportClassification.ts`), and writes a DOCX file (library
`docx`) to the EXPORT folder through a temporary file. The Export screen scans by itself on open
and 500 ms after the scope, page range or rules change.

## 4. Native measurement (`TextboxMetricsModule.kt`)

`TextboxMetrics` exposes Android `StaticLayout` measurements to JavaScript (`measureTextLayout`,
`measureTextLayoutDetailed`): line count, height, line widths and positions for a text, width,
font size and optional font file. Textbox heights, wrapping and hit testing are much more reliable
with the native layout than with a JavaScript estimate; the calibration against the NOTE app's own
rendering is described in `supernote-host-facts.md` §4. `src/supernote/textboxMetrics.ts` is the
single source of truth for textbox height; its pure half (calibration, fallback estimate, empty
lines) is `src/domain/textboxLayout.ts`. The module measures in the textbox's own font. A font
the plugin can't open in the NOTE app's folder is loaded from a readable copy (`MyStyle/fonts`,
then `MyStyle/TextboxHelper/fonts`, `src/domain/fontPaths.ts`); `typefaceStatus` in every result
says which font was used. When no copy is found, the measurement remembers the font, and the
marker preview, the textbox actions and the import append a warning to their message
(`resetFontWarnings`/`getFontWarning` in `textboxMetrics.ts`).

## 5. Why it is built this way

- **Preview, backup, then change** keeps the user's text safe even when a heuristic is wrong: the
  user sees the change first, and the backup holds the original text if something unexpected
  happens anyway.
- **One shared textbox core** (`domain/geometry.ts`, `hitTesting.ts`, `textboxLayout.ts`, the
  pagination, and `supernote/textboxMetrics.ts`) keeps sizing and hit testing consistent across
  splitting, joining, markers and import; a fix in the core fixes every feature.
- **Layers** keep the logic testable: everything in `domain/` runs in Jest without a device, and
  the SDK is reached only through `supernote/`.
- **Native measurement** because the NOTE app renders with Android's text stack; measuring with the
  same stack, plus a small calibration, predicts its wrapping closely.
