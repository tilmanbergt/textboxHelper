# Supernote host facts

> **About this document.** How the Supernote and its plugin host behave where Ratta's SDK
> documentation (`sn-plugin-lib`, docs.supernote.com) says nothing, says it unclearly, or says
> something else - facts found on the device or by tracing a bug. Each entry says what the host
> does and where Textbox Helper deals with it. Present tense; when a firmware or library update
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
  In Textbox Helper: `src/domain/backupPaths.ts` builds the backup paths, tested in
  `__tests__/domain/backupPaths.test.ts`.
- `PluginManager.getPluginDirPath()` is typed `string | null | undefined`; a missing value stops
  the action before anything is written.

## 2. Permissions

- FILE:READ and FILE:WRITE are runtime permissions: they are declared in `PluginConfig.json`
  (`uses-permissions`) and asked for with `PluginManager.requestPermission` before the first file
  or note call (`src/supernote/permissions.ts`). Without them, note and file calls fail with host error
  codes 1500, 1501 or 1503.

## 3. Notes and elements

- **Headings are title elements** (type 100) that cover a textbox. Their style and the covered
  element live on `element.title` (`style`, `controlTrailNums`, plus `X`, `Y`, `width`, `height`,
  `page`), not on the element itself. Title style 0 removes a heading; 1-4 are the heading
  styles.

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
  can put one in `MyStyle/TextboxHelper/fonts/` under the same file name (851 Tegaki Zatsu 0.883
  from the author's site matches the built-in font). `TextboxMetricsModule.kt`
  tries the textbox's path, then `MyStyle/fonts/<name>`, then `MyStyle/TextboxHelper/fonts/<name>`
  (`src/domain/fontPaths.ts`); its `typefaceStatus` says which one loaded. Without a font,
  Android's default typeface lays the text out about 12 % narrower and with a different line
  height than the NOTE app, and every flow that measured that way shows a warning.
- The NOTE app wraps textbox text a little earlier than an Android `StaticLayout` of the same
  width. `supernote/textboxMetrics.ts` measures with a width reduced by 30 px
  (`widthAdjustment`), calibrated on the device.
- The NOTE app draws every explicit empty line in a textbox taller than a `StaticLayout` does.
  `estimateTextboxHeight` in `supernote/textboxMetrics.ts` adds an extra step per empty line
  (`getExtraLineStep`).
