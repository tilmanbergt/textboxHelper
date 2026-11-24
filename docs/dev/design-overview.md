# Textbox Tools - design overview

> **About this document.** How the plugin is built and why: the flow from a button press to a
> changed note, the layers, the features and where they live. Living document:
> present tense, no history, no plans. Update it in the same change that moves a responsibility
> or adds a module. The binding rules are in `DEVELOPMENT-POLICY.md` §3.

The plugin is organized around the Supernote plugin workflow - a button press, a preview, a
confirmed change to the open note - rather than around a generic editor architecture.

## 1. From button press to changed note

1. A toolbar button press enters through `index.js`, where every button is registered: the
   lasso toolbar (the Textbox Tools panel and the pen-text tag) and the NOTE toolbar (Manuscript, import a text file, export DOCX). The
   button ids are in `src/domain/buttonIds.ts`.
2. `src/supernote/pluginRouting.ts` receives the press and forwards it into React Native as an
   event; a press that arrives before the app listens is kept as pending and picked up at start.
3. `App.tsx` makes sure the file permissions are granted, then routes the button to a screen: the
   Textbox Tools panel, the Manuscript card, the import view or the
   export screen.
4. The action flow in `src/actions/` builds a **preview**: it reads the lassoed or page elements
   through `src/supernote/`, lets `src/domain/` compute what would change, and the screen shows it.
5. After the user confirms, the flow writes a **backup** of the affected text
   (`src/storage/backupFile.ts`: a JSON file in the plugin folder plus a summary on the clipboard),
   then changes the page elements through `src/supernote/` and saves the note. The result message
   names the backup file. Only the 3 newest backups of the last 14 days are kept.

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

`App.tsx` owns permissions and button routing (Textbox Tools on the lasso, Manuscript in NOTE);
it opens one screen per button, keyed by the press,
so a screen opened again starts fresh. The button listener subscribes once and calls the latest
router through a ref. Screens are built on `ui/ScreenFrame.tsx` and own their state in a hook next
to them: `screens/manuscript/` (the Manuscript card: `ReviewTab` with its page strip and side bar `ChangeSide`, the Outline in `outline/`, the Files tab in `files/` and Settings in `settings/`; the page states are `domain/manuscriptPages.ts`; the outline is `domain/outlineModel.ts` (what a block is: a file's divider, a heading by its `#`s — `domain/headingText.ts` — or a paragraph; statuses in `storage/blockStatusStore.ts`, block tags `domain/blockTag.ts`), what its panes show `domain/outlineContents.ts` (the Contents, each entry's own paragraphs, the filter, the moves offered), planned moves, levels, set-asides and deletes `domain/outlinePlan.ts`, their new places `domain/outlineLayout.ts`, and `actions/outlineApply.ts` checks and writes them; the tab (`outline/OutlineTab.tsx`) renders `outline/useOutline.ts` (data and plan) through `outline/useOutlineView.ts` (filter or Set aside view, open entry, panel subject, Move to and Move back) in `ContentsColumn`, `ParagraphList` and `DetailsPanel` (its actions from `domain/outlineActions.ts`), with the shared light controls `ui/TextChoices.tsx`, `ui/ActionBar.tsx`, `ui/TextLink.tsx`, `ui/EmptyState.tsx` and the symbols in `ui/glyphs.ts`; what was read is kept in memory by `actions/manuscriptCache.ts` with a page fingerprint, `domain/pageFingerprint.ts`, and checked again in the background by `usePageChecks.ts`; timings are `utils/perf.ts`, saved by `actions/timingsExport.ts`), `screens/tools/` (the lasso screen,
its Details with "Log All Textboxes"),
`screens/import/` (Import with the page drawing) and `screens/export/` (Export), both opened as
sub-screens from the Manuscript card's Files tab. Every sub-screen (Settings, Import, Export) is
local state of its screen, whose hooks stay mounted underneath, so going back keeps the preview;
after an import the card starts over (a new key), so everything is read from the changed note. A
note without textboxes opens on Files (`actions/noteContent.ts`).

**One page layout** (`domain/pageLayout.ts`): margins (by default room for handwriting on the
right and at the bottom), heading levels that start a new page, the gap between blocks; kept in
`settings.layout` and edited in Settings → Layout. The import plans into its `textArea` and breaks
before every linked file's divider and the chosen headings (`blockPagination.ts` `breakBefore`);
the Outline's Apply stacks within the same area and breaks the same way (`outlineLayout.ts`
`LayoutBlock.startsPage`). **Clean up layout** (`domain/cleanupLayout.ts`, `actions/cleanupApply.ts`)
is a planned Outline change that lays the whole note or one linked file out again: full width, the
style of each block's kind and level (the import's role styles), blocks too tall for the area cut
into pieces (tags keep `s`/`i` with `p`), pieces cut before joined first; for one file pages are
inserted or removed before the next file (`supernote/noteTextInsertion.ts` `insertNotePages`,
`removeNotePages`); handwriting stays where it is.

What the plugin remembers between sessions - the import settings, the page layout, the export
scope and rules, the edit-marker calibration, the Outline's heading settings - is `domain/settingsModel.ts`, stored by `storage/settingsFile.ts`
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
lines) swaps two parts. The fine marks work letter by letter: a strike with two verticals marks
exact places (`domain/exactBounds.ts`), a slash one letter (`domain/slashMark.ts`), an arc under
or over a gap closes it, two arcs close a gap at a line end or join two paragraphs
(`domain/closeUpMark.ts`, `domain/paragraphJoin.ts`), and a ∧ or V with a filled circle between its
legs puts in the punctuation drawn in it (`domain/punctMark.ts` reads it, `domain/punctText.ts`
places it by its type; what the plugin can't read waits for the user's pick in the review).
Freehand strokes and the Supernote straight-line tool are both recognized.
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
on the page show which text belongs to which mark (a circle the user drew at the mark holds the
number). A snippet without a mark can be given one later (Select mark), or go in as a new paragraph
where its handwriting starts (Insert right here, `domain/insertHere.ts`). The tagged strokes and a picture are stored in the plugin folder (`pen-edits/`);
the review recognizes them while it is open and the user can edit the text in place.

**Housekeeping** (`domain/housekeeping.ts`, `storage/housekeepingStore.ts`,
`actions/housekeeping.ts`) keeps the plugin folder small: once per JS context, a few seconds after
the Manuscript card shows its first list, it removes pen edits applied or dropped more than 3 days
ago (entry and folder; `doneAt` says when), pen-edit folders without an entry and broken indexes
older than 3 days, and lasso pictures left in `pen-edits/tmp/` for more than a day. Backups are
pruned after every backup write. Unlinking a file removes its two text copies; exports remove
their temporary file after the copy into EXPORT. Settings → Diagnostics → Storage shows the plugin
folder's size and runs it on demand (Clean up now).

Every stage of a marker preview is also recorded in memory (`utils/editMarkerLog.ts`); "Save
Diagnostics" (Manuscript → Settings → Diagnostics) writes that trace, with the stroke's raw sample points next to
the points recognition used, as JSON to the EXPORT folder - only when the user taps it.

### Text import (`actions/textImport.ts`)

Import of a UTF-8 text file from any folder, chosen with the Supernote file selector
(`supernote/fileSelector.ts`, `.txt` only, opening in the note's folder, else the last file's, else `INBOX`), into textboxes:
paragraphs split by blank lines (by default), markdown headings detected and set in larger bold
text, the text paginated over the current page and new pages as needed. Settings and paths are
in `domain/importSettings.ts`, parsing in `domain/importParsing.ts`, the page plan in
`domain/importPlan.ts`, the pagination in `domain/*Pagination.ts` (the height measurement is
passed in, so it is tested without the device). The preview carries the first planned pages, which
the Import screen draws to scale; it runs by itself 500 ms after a settings change.

**Linked import** (`technical-design-source-link.md`): in the Paragraph boxes layout with "Link to
file", `domain/sourceBlocks.ts` splits the file into frontmatter, headings, paragraphs, lists and
protected blocks (code, math, tables, quotes, HTML, comments, embeds, rules), each with its span in
the original text. Every block becomes one textbox (protected ones a framed placeholder) with a
block tag (`domain/blockTag.ts`: source, block, piece, placeholder). The file's record - path,
original text, blocks - is written first to `<plugin folder>/sources/<id>.json`
(`storage/sourceStore.ts`). `domain/sourceExport.ts` regenerates the file from the note's
textboxes and the original.

**Linked files** (`technical-design-linked-files.md`): a note can hold several linked files. Each
starts with a divider - a textbox with the file's name (tag `k: 'f'`) under a NOTE title of ours
(tag `k: 't'`), so the files show in the note's table of contents. `domain/fileSegments.ts` gives
every file the textboxes from its divider to the next (a note linked before dividers existed keeps
its old reading by pages); `sourceExport.ts` regenerates each file from its segment. A note's
files and mode are kept in `sources/note-<key>.json` (`domain/noteLinks.ts`); a note that has
linked files gets more only linked and after its last page ("Add a file to this note").
`actions/titleSync.ts` `syncTitles` puts our NOTE titles right on given pages — over every
divider and every heading of the levels set in Settings → Outline (`domain/noteTitlesPlan.ts` plans
it, tag `k:'t'` with the file or the level; `supernote/noteTitles.ts` writes them) — after an
import, an Outline apply and on Restore titles; titles the user made are never touched. Manuscript reads the note's files with their states
(`actions/linkedFiles.ts`, `domain/fileState.ts`: in sync, changed here, changed in Obsidian, …,
through the Outline's scan and cache) in the background (`screens/manuscript/useLinkedFiles.ts`)
and writes every file that changed here after an Apply ("Also update") or from "Update": a fresh
scan, one question about deleted protected blocks for all files, the check that a file didn't
change outside (fingerprint in its record), then `storage/sourceFile.ts` writes through the
host's copy or directly and reads it back. A file that can't be written is named; the others are
written.

**The aside area** (`domain/noteRegions.ts`, the one place that knows where it starts): the end of
the note from the aside divider on — a textbox "Set aside" tagged `k:'a'` with a NOTE title of
ours. Position decides: nothing below the divider is in any file (`fileSegments.ts` cuts the last
file there; a file's blocks found there count as set aside in `sourceExport.ts`), nothing there is
exported (`exportClassification.ts` `textPartOf`), and a textbox moved above it by hand is text
again. Notes set aside before the divider existed are read by their `a` tags until an Outline
apply gives them a divider. In the Outline the divider is a block of its own kind that starts a
section like a file's and never moves or goes; `outlinePlan.ts` gives every planned block its
part by its planned place, `outlineContents.ts` makes the area the last top entry with the
headings typed in it, and Show › Set aside (`OutlineFilter` `'aside'`) shows only it — the other
choices only the text. Which actions a block gets there (Move back instead of Set aside) is
`domain/outlineActions.ts`. `outlineLayout.ts` `layoutNote` lays the text and the area out apart:
text that grows gets pages inserted before the area; `actions/asideArea.ts` writes a new divider
(from the Outline's apply and from Clean up) and tells the import where the text ends, so an added
file goes before the area.

**Folder mode:** "Whole folder" on the Import screen binds the chosen file's folder
(`screens/import/FolderSetupScreen.tsx`: which files, ordered or not). The note record then holds
the folder (`LinkedFolder`: path, ordered, files left out, the index as last written).
`actions/folderLink.ts` reads the folder for the setup, its state on the card (new files, files
left out, `index.txt` in sync / to be written / changed in Obsidian) and writes `index.txt`, a
plain `[[name]]` list in the note's order, after the files on Update. New files are added from
the Files tab on a new page after the text's last page, before the aside area (`textImport.ts` `addLinkedFiles`, linking in
`actions/importLinking.ts`). In the Outline a file's divider is a block of its own kind: it moves
with its whole file (`outlinePlan.ts` `sectionOf` ranks a divider above `#`, `##`, `###`) and is
never set aside or deleted alone.

**Headings keep their `#`s.** On the page the text decides a heading's level: the import writes
`## Methods` into the textbox, the write-back writes an edited block's text as it is, and the DOCX
export takes Heading 1–3 from the `#`s (`domain/headingText.ts`). Records made before keep a
heading's level when its textbox has no `#`s (`sourceExport.ts`, legacy branch; the Outline reads
it through `buildOutline`'s `recordLevel`).

### DOCX export (`actions/textboxScan.ts`, `storage/docxExport.ts`)

Reads the note context, scans the textboxes of the current page, the whole note or a page range,
classifies them (heading, paragraph, comment, meta) by configurable rules
(`domain/exportConfig.ts`, `domain/exportClassification.ts`; the aside area is left out), and writes a DOCX file (library
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
