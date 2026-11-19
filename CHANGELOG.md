# Changelog

All notable changes to Textbox Tools are listed here, newest first.

## [Unreleased]

### Added

- A new lasso toolbar button, "Insertion or Replacement": lasso handwritten new text and tap it to tag the text, without converting it to text first. The mark drawn just before the text decides what it is: a replace mark makes it a replacement, a caret an insertion. Only a mark drawn right before the text counts; strokes that already belong to tagged text (its handwriting or its mark) are never taken. The tap is quick and opens no screen: a circled number appears left of the text, and the same number at its mark. A replace mark can now also be the delete line plus a small circle drawn right after its end; the number goes into that circle. The tagged handwriting and mark are found again even after you move them with the lasso.
- The edit-marker review recognizes tagged text while you read, one at a time, the selected change first; until then a grey placeholder stands in the text. A picture of the handwriting shows below its text; tap the text to fix it right there with the Supernote keyboard's handwriting input. Skip for later and Recognize again are next to it. Apply changes everything that is ready, puts insertions in as new paragraphs, and removes the used marks and tagged handwriting; the rest stays for a later pass. Recognized text and your choices are kept, so the review can be closed and opened again.
- The circle of a replace mark may also sit just above the line, anywhere along the struck words.
- The picture of tagged handwriting is the one taken when tagging; if none was kept, the handwriting is drawn from its stored strokes.
- Tagging is faster: the circles and numbers are prepared at once, the search for the replace mark stops as soon as it has found it, and the plugin's own files are read and written while the Supernote works on the page instead of afterwards. A short pause after the lasso closes keeps the Supernote's note app from crashing when the tag follows too quickly.
- Words are now placed where the Supernote actually draws them (about 15 px right of the textbox edge), so carets and delete markers pick the word you meant, also short words at a line's start or end.
- Paragraph marks: a < or > between two lines, or a step mark (under the line, straight up, on above the next word) at a word gap, breaks the paragraph there; followed by tagged text, the text becomes a paragraph of its own there. Each part becomes its own textbox; paragraphs below move down. V and ∧ insert words.
- Insertions go where a caret points: draw a V or ∧ on the line, or a < or > beside it (one stroke or two lines meeting at the tip), write the new text right after, lasso it and tap Insertion or Replacement. The text goes in between words (spaces added), inside a word, or as a new paragraph when the caret is in the space between two paragraphs. The caret's number sits between the ends of its legs. Paragraphs that would be covered by longer text or a new paragraph move down.
- Select mark: when no mark is found just before tagged text, the card offers "Select mark now" — draw the mark (or lasso the one you drew) and tap Insertion or Replacement again within 5 minutes; the text never needs to be rewritten. The review's Ignored tab offers Select mark too, and the review opens again at that change once the mark is found. A mark selected this way may be a delete line alone.
- Drop: a change you don't want, or an unused mark or tagged text under Ignored, can be taken off the page without applying it, one at a time or all ignored at once. Drop asks first; for tagged text you choose to keep your handwriting (only the numbers and the mark go) or to erase it too (a backup is written first). Strokes away from any textbox are never offered, so your own handwriting stays.
- Fine-tune every change by one character: below the selected change, Start and End (or Place for an insertion or paragraph break) show the characters around its edges; ‹ › move them, and a line shows how the text will read. A comma right after a crossed-out word now stays unless the line reaches it.
- "Check place" marks an insertion whose caret's tip was between two lines or inside a word, with the reason.

### Changed

- The plugin is now called Textbox Tools everywhere (plugin list, screens, permission request). Its identity is unchanged: updates install over the previous version, and the folders in MyStyle keep their names.
- Textbox Tools (the lasso screen) is new and never scrolls: the actions on the left, After and Before of the chosen action on the right, paged. Split Paragraphs is now on this screen too. An action that doesn't fit the selection is greyed with the reason ("needs exactly 1 textbox", "nothing to clean"); when only one action fits, it is already chosen. The button names the action ("Apply Join Text Boxes"); after it the screen shows the result and the backup's file name. "Log All Textboxes" moved to Details.
- Import Text File has a new screen: "Choose ›" opens the Supernote file selector in INBOX (only `.txt` files, folders inside INBOX work too) instead of a typed file name. The preview updates by itself after every change and draws the planned pages to scale; font size and margins moved to "Layout". The help is behind "?".
- Export DOCX scans by itself when it opens and after every change, and lists the textboxes that will be exported instead of the count tiles. The classification rules moved to "Rules", with Any / Yes / No for bold, italic and border.
- The plugin remembers the import settings, the export pages and rules, and the edit-marker calibration between sessions (`settings.json` in the plugin folder).
- The lasso toolbar actions show their progress in a small, calmer card; Cancel works until the first change.
- Edit Markers has a new, calmer review screen that never scrolls. The changes are listed on the left (with an "Ignored" tab for markers that couldn't be used); the right side shows one changed textbox at a time with the removed words struck through and replacements in bold. Tap a change to see it in its textbox. After Apply the screen stays open with the result and the backup's file name. Calibration and Save Diagnostics moved to "Details"; the marker help is behind "?". A font warning shows in the status line when word positions were measured in a standard font.

### Fixed

- Imported textboxes are now written in NOTE's system font and sized for it, so their line spacing no longer changes when you edit one, and the last line is no longer cut off. Edit markers in textboxes without a font are measured in the same font, so the right words are struck.

- Import Text File looks for the file in the Supernote's INBOX folder under the folder's exact name. It used "Inbox", and opening a file there could fail with "Permission denied".

### Removed

- Replacement text in a typed line starting with # is no longer read: tag the handwritten new words with Insertion or Replacement. A replace mark without tagged text shows under Ignored with how to give it some.
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
