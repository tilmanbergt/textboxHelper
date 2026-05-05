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

### Apply All Edit Markers

- Run marker recognition on the full current page from the NOTE toolbar
- Apply recognized marker operations after preview

### Import Text File

- Import plain text into NOTE textboxes
- Split imported text into paragraph-based textboxes

### Export DOCX

- Scan textbox content from the current note
- Export recognized textbox content into a DOCX file

## Installation

1. Download the latest `.snplg` file from GitHub Releases.
2. Copy the `.snplg` file to the `MyStyle/` folder on your Supernote device.
3. On the device, open Settings → Apps → Plugins.
4. Install `Textbox Helper`.
5. Open a NOTE file and use the plugin toolbar buttons.

## Project Structure

- [index.js](index.js)  
  Registers Supernote buttons and starts plugin routing.

- [App.tsx](App.tsx)  
  Main review UI for textbox actions, edit-marker actions, import, and export.

- [src/pluginRouting.ts](src/pluginRouting.ts)  
  Central button IDs and bridge from Supernote button presses into React Native.

- [src/textboxActions.ts](src/textboxActions.ts)  
  Textbox split, join, clean, and unwrap logic, plus preview and execution flow.

- [src/editMarkerActions.ts](src/editMarkerActions.ts)  
  Handwritten marker recognition, replace-source resolution, preview generation, and apply logic.

- [src/textboxImportActions.ts](src/textboxImportActions.ts)  
  Text-file import preview and execution.

- [src/export](src/export)  
  DOCX export UI, note context reading, textbox scanning, and DOCX generation.

- [src/ui](src/ui)  
  Reusable UI components for plugin screens and dialogs.

- [src/shared/supernoteTextboxGeometry.ts](src/shared/supernoteTextboxGeometry.ts)  
  Shared page-space rectangle and reading-order helpers.

- [src/shared/supernoteTextboxLayout.ts](src/shared/supernoteTextboxLayout.ts)  
  Shared textbox measurement and height calculation logic.

- [src/shared/supernoteTextboxHitTesting.ts](src/shared/supernoteTextboxHitTesting.ts)  
  Shared mapping from measured text layout to page-space hit testing.

- [android/app/src/main/java/com/textboxhelper/TextboxMetricsModule.kt](android/app/src/main/java/com/textboxhelper/TextboxMetricsModule.kt)  
  Android native module used for accurate textbox text measurement.

More architectural detail lives in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Development

Install dependencies:

```sh
yarn install