# Textbox Tools

Textbox Tools is an experimental Supernote NOTE plugin for structured text editing inside notes.

It targets the Android-based Supernote plugin runtime only. It does not support iOS.

## Status

Textbox Tools is experimental and in beta.

The plugin directly modifies NOTE page elements. Please test it on copied notes before using it on important notebooks.

## Main Features

### Textbox Tools

- Split one textbox into sentence-based or paragraph-based textboxes
- Join selected textboxes in reading order
- Clean repeated spaces
- Remove manual line breaks
- See every action's result before applying it; actions that don't fit the selection say why

### Edit Markers

- Recognize handwritten delete markers
- Recognize replace markers as a delete line plus a small loop (or two crossing lines), with the new text tagged right after
- Support both freehand strokes and Supernote straight-line geometry
- Review all changes before applying them: removed words struck through, replacements in bold, one textbox at a time
- Calibrate the text measurement and save diagnostics of a marker preview to the EXPORT folder (Details), for bug reports

### Replacement and Insertion

- Tag handwritten new text with one lasso button, "Insertion or Replacement", instead of converting it to text first
- The mark drawn just before the text decides: a replace mark makes it a replacement, a caret an insertion; a small number at both shows which belong together
- No mark found? Select mark: draw or lasso the mark and tap the button again; the text never needs to be written again
- An insertion is written right after a caret (a V on the line or a ∧ under it): between words, inside a word, or between paragraphs; paragraphs below move down to make room
- Manuscript recognizes the tagged text while you read, shows a picture of the handwriting, and lets you fix the text in place with the Supernote keyboard's handwriting input
- Fine-tune any change by one character (a comma, a space, a letter; a swap's three edges), and drop a change or an unused mark, keeping or erasing your handwriting
- The handwriting and its picture are kept in the plugin folder (`pen-edits/`)

### Manuscript

- The NOTE toolbar button "Manuscript" reads every edit mark on the current page
- Every change in reading order, the changed text in full with a few words around it; the selected change on the right with its text, its edges and Drop
- "Needs attention" above the list: tagged text without a mark, marks that couldn't be used, with the reason
- The whole note: a page strip with each page's count of changes; tap a page, or read them all
- Apply every ready change of the pages read after the preview; one backup of those pages is written first
- Outline: every textbox of the note as a block in reading order, with its pending edits and a status (open, review, final) you set; filter by status, pending edits or planned changes
- Move a block with ←, set it aside (to a new page at the end of the note) or delete it; the changes are planned first, each can be undone, and "Apply n changes" rebuilds the pages from the first change with one backup. A block with pending edits stays in place until its edits are applied

### Import Text File

- Import plain text into NOTE textboxes, from a `.txt` file in any folder (for example `INBOX`), chosen with the Supernote file selector
- Split imported text into paragraph-based textboxes
- Link the import to its file: one textbox per heading, paragraph or list; frontmatter, code, tables, callouts and other blocks are kept exactly as they are and shown as framed placeholders
- See the planned pages drawn to scale before importing; the preview updates by itself

### Export DOCX

- See which textboxes of the page, the note or a page range will be exported, as a list that updates by itself
- Export recognized textbox content into a DOCX file

## Fonts

Edit markers, Split, Join and Import measure text in the textbox's font, so they know where each
word sits. The system font and fonts you installed yourself (in `MyStyle/fonts`) work as they are.

The fonts that come with the Supernote, such as 851tegakizatsu, sit in a folder plugins can't
read. For those, put a copy of the font file in `MyStyle/TextboxHelper/fonts`, named exactly like
the font, for example `MyStyle/TextboxHelper/fonts/851tegakizatsu.ttf`. 851 Tegaki Zatsu is a
free font by 8:51:22 pm (http://pm85122.onamae.jp/); rename the downloaded
`851tegaki_zatsu_normal_0883.ttf`.

Without a readable font, the plugin shows a warning, because word positions and textbox sizes may
be wrong.

## Settings

The plugin remembers the import settings, the export pages and rules, and the edit-marker
calibration in `settings.json` in its own plugin folder. Tagged replacements and insertions are
kept in `pen-edits/` in the same folder, the Outline's block statuses in `block-status.json`, and
what a linked import came from (the file's path and its original text) in `sources/`.

## Installation

1. Download the latest `.snplg` file from GitHub Releases.
2. Copy the `.snplg` file to the `MyStyle/` folder on your Supernote device.
3. On the device, open Settings → Apps → Plugins.
4. Install `Textbox Tools`.
5. Open a NOTE file and use the plugin toolbar buttons.

## Project Structure

A tour of the code, build instructions and the developer documents are in
[docs/dev/README.md](docs/dev/README.md). How the plugin is built:
[docs/dev/design-overview.md](docs/dev/design-overview.md). Rules for every change:
[docs/dev/DEVELOPMENT-POLICY.md](docs/dev/DEVELOPMENT-POLICY.md).

## Development

The project uses npm (`package-lock.json`).

Install dependencies:

```sh
npm ci
```

Check your changes (type check, ESLint with zero warnings, Jest):

```sh
npm run check
```

Build the plugin package on Windows:

```powershell
./buildPlugin.ps1
```

The build writes the `.snplg` file to `build/outputs/`.

## License

MIT, see [LICENSE](LICENSE).
