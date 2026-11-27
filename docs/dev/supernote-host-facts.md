# Supernote host facts

> **About this document.** How the Supernote and its plugin host behave where Ratta's SDK
> documentation (`sn-plugin-lib`, docs.supernote.com) says nothing, says it unclearly, or says
> something else - facts found on the device or by tracing a bug. Each entry says what the host
> does and where Manuscript deals with it. Present tense; when a firmware or library update
> changes a fact, update the entry.

Library: `sn-plugin-lib` 0.2.3.

## 1. Files and folders

- **Paths use `/` only.** The device runs Android: a backslash is an ordinary character in a file
  name, not a folder separator. A path like `<pluginDir>\backups\file.json` names a file or
  folder *next to* the plugin folder, not inside it.
- **A plugin may write only inside its own private folder** under
  `/data/user/0/com.ratta.supernote.pluginhost/files/plugins/<pluginID>/`. A write anywhere else
  in `plugins/` fails with "Plugin [<pluginID>] is not allowed to access other plugin's private
  dir: <path>" - this includes a `\`-joined path that only looks like it is inside.
  In Manuscript: `src/domain/backupPaths.ts` builds the backup paths, tested in
  `__tests__/domain/backupPaths.test.ts`.
- `PluginManager.getPluginDirPath()` is typed `string | null | undefined`; a missing value stops
  the action before anything is written.
- **Settings** live in the plugin folder too: `<pluginDir>/settings.json`
  (`storage/settingsFile.ts`). A missing plugin folder means the settings stay in memory for the
  session.
- **The file selector** `RattaFileSelector.selectFile` (sn-plugin-lib) opens the Supernote's own
  file selector: `suffixList` limits the file types, `needSelectFolder` + `limitPath` open it in
  a folder and keep the user there. It answers with an array of absolute paths, or null/empty
  when cancelled. `limitPath` is optional. Import uses it for `.txt` files from any folder,
  opening in the current note's folder (`supernote/fileSelector.ts`); the returned path is checked
  again (`chosenTextFilePath`). Opening in INBOX, `.txt` only, is confirmed on the device; which
  folders it offers without `limitPath` is not.
- **Linked files** keep their record in `<pluginDir>/sources/`. Whether a plugin may write next to
  a linked file outside its own folder (INBOX, Document, a synced folder) is checked on the device
  with Manuscript → Files → Check write access, which tries the host's `FileUtils.copyFile`
  first and a direct write second.

## 2. Permissions

- FILE:READ and FILE:WRITE are runtime permissions: they are declared in `PluginConfig.json`
  (`uses-permissions`) and asked for with `PluginManager.requestPermission` before the first file
  or note call (`src/supernote/permissions.ts`). Without them, note and file calls fail with host error
  codes 1500, 1501 or 1503.
- **Permission answers:** `hasPermission` answers 1 (granted) or 0; `requestPermission` answers
  1 ("Allow this time only"), 2 ("Always allow"), 0 ("Don't allow") or -1 when the dialog is
  closed without a choice. Only 1 and 2 are grants (`domain/permissionResult.ts`); counting -1 as
  one lets the plugin start and the host then refuses the first file call.
- **INTERNET** is a runtime permission too, declared in `PluginConfig.json` and asked with the same
  calls. Manuscript asks it only right before Import from URL's first download of a session, with
  `hasPermission` bounded by 8 s and the dialog by 120 s, as Kept GTD does
  (`ensureInternetPermission`). Plain HTTP to a phone on the local network works from inside the
  plugin host (another plugin, NoteDraft, fetches from one).

## 3. Notes and elements

- **Headings are title elements** (type 100) that cover a textbox. Their style and the covered
  element live on `element.title` (`style`, `controlTrailNums`, plus `X`, `Y`, `width`, `height`,
  `page`), not on the element itself. Title style 0 removes a heading; 1-4 are the heading
  styles.
- **Plugins can write titles** the way Kept GTD does: an element of type 100 from
  `createElement`, its `title` set to the covered textbox's rectangle, its number in
  `controlTrailNums` and a style, inserted with `PluginFileAPI.insertElements`
  (`supernote/noteTitles.ts`). The titles over linked files' names carry the plugin's tag in
  `userData`. `controlTrailNums` from `getTitles` don't always name the page's element numbers, so
  the plugin matches a title to its textbox by their rectangles. Whether NOTE keeps a title's
  `userData` through saves and edits is checked on the device.
- **Pictures:** `PluginNoteAPI.insertImage(path)` puts a PNG (or JPG) into the open page; the
  host checks that the file exists, and where the picture lands is its choice (the middle of the page)
  (`supernote/noteImage.ts`, the cheat sheet). The file is written to the plugin's own folder
  first. A picture is an element of type 200; marks are only strokes and straight lines, so a
  picture is never read as one. It works with the plugin view open; the picture lands in the
  middle of the page and the user moves, resizes and erases it like any picture (device, A5 X).
  If inserting fails, the cheat sheet goes to EXPORT instead.
- **Folder listing:** a bound folder is listed with `RNFS.readDir` (`storage/folderFiles.ts`);
  whether that works in every folder the file selector offers (Document, the sync folder) is
  checked on the device.

- **Element uuids are not identities.** The same untouched textbox comes back with a different
  `uuid` from one read to the next, and the lasso's elements have other uuids than the page's.
  They are handles of the SDK's element cache (`recycleElement`). What stays with an element is
  its `userData`: pen edits write it onto their badges and numbers and onto the user's tagged
  strokes, and find them by it.
- **Element numbers change.** Inserting elements and saving can renumber a page (a tag's number
  textbox got a lower `numInPage` than strokes written before it), and NOTE replaces a textbox the
  user edits (it comes back with a new number). A number is only valid until the next insert,
  edit or save; nothing stores one.

## 4. Text measurement

- **Textbox fonts** are reported as a file path in `textBox.fontPath`, in one of three places:
  the system font in `/system/fonts/` (for example `DroidSansFallbackFull.ttf`), fonts the user
  installed in `/storage/emulated/0/MyStyle/fonts/` (for example
  `TilmanHandwriting1-Regular.ttf`) - both load directly - and the fonts Ratta ships in the NOTE
  app's folder `/storage/emulated/0/.data/fonts/` (for example `851tegakizatsu.ttf`).
- **Plugins may not open files in `/storage/emulated/0/.data/`.** `File.exists()` and
  `canRead()` report true, but `Typeface.createFromFile` fails with "Font not found" and a
  `FileInputStream` with "Permission denied". `FileUtils.copyFile` of `sn-plugin-lib` is plain Java
  in the same process and fails the same way; no SDK call returns a textbox's font.
- **The fonts Ratta ships** (such as 851tegakizatsu) have no copy that plugins can read; the user
  can put one in `MyStyle/Manuscript/fonts/` under the same file name (851 Tegaki Zatsu 0.883
  from the author's site matches the built-in font). `TextboxMetricsModule.kt`
  tries the textbox's path, then `MyStyle/fonts/<name>`, then `MyStyle/Manuscript/fonts/<name>`
  (`src/domain/fontPaths.ts`); its `typefaceStatus` says which one loaded. Without a font,
  Android's default typeface lays the text out about 12 % narrower and with a different line
  height than the NOTE app, and every flow that measured that way shows a warning.
- **"System font" is `/system/fonts/DroidSansFallbackFull.ttf`.** A textbox the user sets to the
  system font (or edits) gets this `fontPath` and about 48 px per line at size 36. A textbox
  written without a `fontPath` (older imports) is drawn in a narrower font with tighter lines,
  until the user edits it. New textboxes from the plugin get the system font's path, and a
  textbox without one is measured in it (`NOTE_SYSTEM_FONT_PATH`).
- The NOTE app wraps textbox text a little earlier than an Android `StaticLayout` of the same
  width. `supernote/textboxMetrics.ts` measures with a width reduced by 30 px
  (`widthAdjustment`), calibrated on the device.
- The NOTE app draws every explicit empty line in a textbox taller than a `StaticLayout` does.
  `estimateTextboxHeight` in `supernote/textboxMetrics.ts` adds an extra step per empty line
  (`getExtraLineStep`).
- **Don't change the page right after closing the lasso.** `setLassoBoxState` (closing the
  lasso) makes NOTE reload and redraw the page layer, about 0.3 s on the A5 X2. A
  `modifyPageElements` sent within that time crashed NOTE natively twice (`stoi: no conversion`
  on its main thread, a SIGSEGV in its binder thread); NOTE closes and the DOC app comes to the
  front. The pen-edit tag waits until 0.9 s after closing the lasso (`LASSO_SETTLE_MS`).
- **Text is drawn inside a margin of the textbox.** NOTE starts a textbox's text about 15–18 px
  right of `textRect.left` (36 px font, A5 X2), and the line width is about 30 px less than the
  rect. Measurements place words from `textLeftX` = left + X offset + width adjustment / 2.
