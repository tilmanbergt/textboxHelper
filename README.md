## Status

Textbox Helper is experimental and in beta. It directly modifies NOTE page elements. Please test it on copied notes before using it on important notebooks.

# Textbox Helper

`Textbox Helper` is a Supernote NOTE plugin focused on structured text editing inside notes.

It currently supports related workflows:

- textbox tools for splitting, joining, and cleaning NOTE textboxes
- edit markers for handwritten delete and replace operations with preview and apply flowsImport text file
- Export DOCX 
- Apply all edit markers from NOTE toolbar
- Import text file
The plugin is built as a React Native Supernote plugin with a small Android native text-measurement bridge.

## Main Features

- `Textbox Tools`
  - split one textbox into sentence-based textboxes
  - join selected textboxes in reading order
  - clean repeated spaces
  - remove line breaks
- `Apply Edit Markers`
  - recognize handwritten delete markers
  - recognize replace markers as a delete line plus two crossing modifier lines
  - support both freehand strokes and Supernote straight-line geometry
  - preview all changes before apply
- `Apply All Edit Markers`
  - run the same marker recognition on the full page from the NOTE toolbar
- `Import Text File`
    - import plain text into NOTE textboxes
    - split imported text into paragraph-based textboxes
- `Export DOCX`
    - scan textbox content from the current note
    - export recognized text structure into a DOCX file
## Installation

1. Download the latest `.snplg` file from GitHub Releases.
2. Copy it to the `MyStyle/` folder on your Supernote device.
3. On the device, open Settings → Apps → Plugins.
4. Install `Textbox Helper`.
5. Open a NOTE file and use the toolbar buttons.
6. 
## Project Structure

- [index.js](C:\Users\tilma\AndroidStudioProjects\NoteDraft\textboxHelper\index.js)
  Registers Supernote buttons and starts plugin routing.
- [App.tsx](C:\Users\tilma\AndroidStudioProjects\NoteDraft\textboxHelper\App.tsx)
  Main review UI for textbox actions and edit-marker actions.
- [src/pluginRouting.ts](C:\Users\tilma\AndroidStudioProjects\NoteDraft\textboxHelper\src\pluginRouting.ts)
  Central button IDs and bridge from Supernote button presses into React Native.
- [src/textboxActions.ts](C:\Users\tilma\AndroidStudioProjects\NoteDraft\textboxHelper\src\textboxActions.ts)
  Textbox split/join/clean/unwrap logic plus preview and execution flow.
- [src/editMarkerActions.ts](C:\Users\tilma\AndroidStudioProjects\NoteDraft\textboxHelper\src\editMarkerActions.ts)
  Handwritten marker recognition, replace-source resolution, preview generation, and apply logic.
- [src/shared/supernoteTextboxGeometry.ts](C:\Users\tilma\AndroidStudioProjects\NoteDraft\textboxHelper\src\shared\supernoteTextboxGeometry.ts)
  Shared page-space rectangle and reading-order helpers.
- [src/shared/supernoteTextboxLayout.ts](C:\Users\tilma\AndroidStudioProjects\NoteDraft\textboxHelper\src\shared\supernoteTextboxLayout.ts)
  Shared textbox measurement and height calculation logic.
- [src/shared/supernoteTextboxHitTesting.ts](C:\Users\tilma\AndroidStudioProjects\NoteDraft\textboxHelper\src\shared\supernoteTextboxHitTesting.ts)
  Shared mapping from measured text layout to page-space hit testing.
- [android/app/src/main/java/com/textboxhelper/TextboxMetricsModule.kt](C:\Users\tilma\AndroidStudioProjects\NoteDraft\textboxHelper\android\app\src\main\java\com\textboxhelper\TextboxMetricsModule.kt)
  Android native module used for accurate textbox text measurement.

More architectural detail lives in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Development

Install dependencies:

```sh
yarn install
```

Common commands:

```sh
yarn install
yarn start
yarn typecheck
yarn test
```

## Contributing

Contribution guidance lives in [CONTRIBUTING.md](C:\Users\tilma\AndroidStudioProjects\NoteDraft\textboxHelper\CONTRIBUTING.md).

Short version:

- keep Supernote-specific behavior explicit
- prefer small, reviewable PRs
- keep logs targeted and easy to remove later
- run `npm run typecheck` before opening a PR

## Publishing To GitHub

A practical release checklist is in [docs/GITHUB_RELEASE_CHECKLIST.md](C:\Users\tilma\AndroidStudioProjects\NoteDraft\textboxHelper\docs\GITHUB_RELEASE_CHECKLIST.md).

Before publishing publicly, make sure to:

- choose and add a license
- verify the README and screenshots are accurate
- remove or ignore local log files and large debug artifacts if they should not be part of the public repo
- confirm the plugin name, icon, and release instructions are ready for external users
