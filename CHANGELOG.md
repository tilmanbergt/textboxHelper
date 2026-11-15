# Changelog

All notable changes to Textbox Helper are listed here, newest first.

## [Unreleased]

### Added

- Edit Marker Review: "Save Diagnostics" (under Recognition Details) saves how each marker was read and why it was ignored as a JSON file in the EXPORT folder, to attach to a bug report. It contains short previews of the textboxes' text.

## [0.2.1] - 2026-11-15

### Fixed

- Split, Join, Clean Spaces, Remove Line Breaks and Apply Edit Markers work again on current firmware. They stopped with "not allowed to access other plugin's private dir", because the backup written before each change used a wrong folder path.
- The Split Paragraphs dialog shows its title again.

## [0.2.0]

First version tracked in this changelog.
