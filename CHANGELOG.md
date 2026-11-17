# Changelog

All notable changes to Textbox Tools are listed here, newest first.

## [Unreleased]

### Changed

- The plugin is now called Textbox Tools everywhere (plugin list, screens, permission request). Its identity is unchanged: updates install over the previous version, and the folders in MyStyle keep their names.
- Textbox Tools (the lasso screen) is new and never scrolls: the actions on the left, After and Before of the chosen action on the right, paged. Split Paragraphs is now on this screen too. An action that doesn't fit the selection is greyed with the reason ("needs exactly 1 textbox", "nothing to clean"); when only one action fits, it is already chosen. The button names the action ("Apply Join Text Boxes"); after it the screen shows the result and the backup's file name. "Log All Textboxes" moved to Details.
- Import Text File has a new screen: "Choose ›" opens the Supernote file selector in INBOX (only `.txt` files, folders inside INBOX work too) instead of a typed file name. The preview updates by itself after every change and draws the planned pages to scale; font size and margins moved to "Layout". The help is behind "?".
- Export DOCX scans by itself when it opens and after every change, and lists the textboxes that will be exported instead of the count tiles. The classification rules moved to "Rules", with Any / Yes / No for bold, italic and border.
- The plugin remembers the import settings, the export pages and rules, and the edit-marker calibration between sessions (`settings.json` in the plugin folder).
- The lasso toolbar actions show their progress in a small, calmer card; Cancel works until the first change.
- Edit Markers has a new, calmer review screen that never scrolls. The changes are listed on the left (with an "Ignored" tab for markers that couldn't be used); the right side shows one changed textbox at a time with the removed words struck through and replacements in bold. Tap a change to see it in its textbox. After Apply the screen stays open with the result and the backup's file name. Calibration and Save Diagnostics moved to "Details"; the marker help is behind "?". A font warning shows in the status line when word positions were measured in a standard font.

### Fixed

- Import Text File looks for the file in the Supernote's INBOX folder under the folder's exact name. It used "Inbox", and opening a file there could fail with "Permission denied".

### Removed

- The second import folder `MyStyle/TextboxHelper/inbox`: text files are imported from INBOX only.

## [0.2.2] - 2026-11-15

### Fixed

- Edit markers find the right words again in textboxes with a font you installed yourself. Under the current firmware plugins can't read the NOTE app's font folder, so the text was measured in a standard font: word positions drifted and many markers were ignored or hit the wrong words. The plugin now reads your fonts from MyStyle/fonts. Split, Join and Import size their textboxes with the right font too.
- For the fonts that come with the Supernote (for example 851tegakizatsu), the plugin has no readable copy. Edit marker review, Split, Join, Clean Spaces, Remove Line Breaks and Import now say so in a warning instead of silently measuring with a standard font. Copy the font file to MyStyle/TextboxHelper/fonts to fix it.

### Added

- Edit Marker Review: "Save Diagnostics" (under Recognition Details) saves how each marker was read and why it was ignored as a JSON file in the EXPORT folder, to attach to a bug report. It contains short previews of the textboxes' text.

## [0.2.1] - 2026-11-15

### Fixed

- Split, Join, Clean Spaces, Remove Line Breaks and Apply Edit Markers work again on current firmware. They stopped with "not allowed to access other plugin's private dir", because the backup written before each change used a wrong folder path.
- The Split Paragraphs dialog shows its title again.

## [0.2.0]

First version tracked in this changelog.
