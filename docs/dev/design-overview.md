# Textbox Helper - design overview

> **About this document.** How the plugin is built and why: the flow from a button press to a
> changed note, the modules and their responsibilities, the shared textbox core. Living document:
> present tense, no history, no plans. Update it in the same change that moves a responsibility
> or adds a module. The binding rules are in `DEVELOPMENT-POLICY.md` §3.

The plugin is organized around the Supernote plugin workflow - a button press, a preview, a
confirmed change to the open note - rather than around a generic editor architecture.

## 1. From button press to changed note

1. A toolbar button press enters through `index.js`, where every button is registered: the
   lasso toolbar (split, join, clean, remove line breaks, apply edit markers, the Textbox Tools
   panel) and the NOTE toolbar (apply all edit markers, import a text file, export DOCX).
2. `src/pluginRouting.ts` receives the press and forwards it into React Native as an event; a
   press that arrives before the app listens is kept as pending and picked up at start.
3. `App.tsx` makes sure the file permissions are granted, then routes the button to a view: the
   Textbox Tools panel, the direct-action dialog, the edit-marker review, the import view or the
   export screen.
4. The feature module builds a **preview**: it reads the lassoed or page elements, computes what
   would change and shows it.
5. After the user confirms, the module writes a **backup** of the affected text (a JSON file in the
   plugin folder plus a summary on the clipboard), then changes the page elements through
   `sn-plugin-lib` and saves the note. The result message names the backup file.

## 2. Modules

### `App.tsx` and `src/ui/`

`App.tsx` owns the user flow: permissions, routing, previews, progress, cancellation, status and
result messages. `src/ui/` holds the views and dialogs (`TextboxToolsView`, `DirectActionDialog`,
`EditMarkerReviewView`, `ImportTextFileView`) and their styles; `ACTION_LABELS` there is the one
label per action kind.

### `src/textboxActions.ts`

Direct textbox editing: split by sentence, split by paragraph, join in reading order, clean
repeated spaces, remove manual line breaks. It finds the textboxes in the lasso, computes the new
texts, sizes the new textboxes through the shared layout core, checks that the result fits the
page without colliding with other elements, writes the backup and applies the change.

### `src/editMarkerActions.ts` and `src/textboxStrikeAnalysis.ts`

Handwritten edit markers on textboxes: a delete marker is a line through words; a replace marker
is a delete line plus two crossing modifier lines, with the replacement taken from typed text.
Freehand strokes and the Supernote straight-line tool are both recognized.
`textboxStrikeAnalysis.ts` analyzes the strokes; `editMarkerActions.ts` maps them to words
through the hit-testing core, resolves replacement sources, builds the preview and applies the
plan - for the lasso selection or the whole page.

### `src/textboxImportActions.ts`

Import of a UTF-8 text file from `Inbox` or `MyStyle/TextboxHelper/inbox` into textboxes:
paragraphs split by blank lines (by default), markdown headings detected and set in larger bold text, the text
paginated over the current page and new pages as needed.

### `src/export/`

DOCX export: reads the note context, scans the textboxes of the current page, the whole note or a
page range, classifies them (heading, paragraph, comment, meta) by configurable rules, and writes
a DOCX file (library `docx`) to the EXPORT folder through a temporary file.

## 3. The shared textbox core (`src/shared/`)

Reusable textbox logic, mostly free of React Native and the SDK so it can be tested with Jest:

- `supernoteTextboxGeometry.ts`: rectangle math, overlap, point-in-rect, reading order.
- `supernoteTextboxLayout.ts`: textbox measurement - the native measurement bridge, its
  calibration, a fallback estimate and the final textbox height. It is the single source of truth
  for textbox height.
- `supernoteTextboxHitTesting.ts`: page-space word boxes from measured text, line bands, word and
  approximate character lookup by page coordinate.
- `supernoteTextboxPaginationCore.ts`, `supernoteTextboxBlockPagination.ts`,
  `supernoteTextPagination.ts`: splitting text and blocks over pages.
- `textboxImportParsing.ts`: parsing imported text into blocks.
- `backupPaths.ts`: the backup folder and file paths inside the plugin folder.
- `supernoteNoteTextInsertion.ts`: inserting textboxes and pages into a note (uses the SDK).

## 4. Native measurement (`TextboxMetricsModule.kt`)

`TextboxMetrics` exposes Android `StaticLayout` measurements to JavaScript (`measureTextLayout`,
`measureTextLayoutDetailed`): line count, height, line widths and positions for a text, width,
font size and optional font file. Textbox heights, wrapping and hit testing are much more reliable
with the native layout than with a JavaScript estimate; the calibration against the NOTE app's own
rendering is described in `supernote-host-facts.md` §4.

## 5. Why it is built this way

- **Preview, backup, then change** keeps the user's text safe even when a heuristic is wrong: the
  user sees the change first, and the backup holds the original text if something unexpected
  happens anyway.
- **One shared textbox core** keeps sizing and hit testing consistent across splitting, joining,
  markers and import; a fix in the core fixes every feature.
- **Native measurement** because the NOTE app renders with Android's text stack; measuring with the
  same stack, plus a small calibration, predicts its wrapping closely.
