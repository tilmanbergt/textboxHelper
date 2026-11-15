# Textbox Helper

Textbox Helper is an experimental Supernote NOTE plugin for structured text editing inside notes.

It targets the Android-based Supernote plugin runtime only. It does not support iOS.

## Status

Textbox Helper is experimental and in beta.

The plugin directly modifies NOTE page elements. Please test it on copied notes before using it on important notebooks.

## Main Features

### Textbox Tools

- Split one textbox into sentence-based textboxes
- Join selected textboxes in reading order
- Clean repeated spaces
- Remove manual line breaks

### Edit Markers

- Recognize handwritten delete markers
- Recognize replace markers as a delete line plus two crossing modifier lines
- Support both freehand strokes and Supernote straight-line geometry
- Preview all changes before applying them
- Save diagnostics of a marker preview to the EXPORT folder (Recognition Details → Save Diagnostics), for bug reports

### Apply All Edit Markers

- Run marker recognition on the full current page from the NOTE toolbar
- Apply recognized marker operations after preview

### Import Text File

- Import plain text into NOTE textboxes, from a `.txt` file in the Supernote's `INBOX` folder
- Split imported text into paragraph-based textboxes

### Export DOCX

- Scan textbox content from the current note
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

## Installation

1. Download the latest `.snplg` file from GitHub Releases.
2. Copy the `.snplg` file to the `MyStyle/` folder on your Supernote device.
3. On the device, open Settings → Apps → Plugins.
4. Install `Textbox Helper`.
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
