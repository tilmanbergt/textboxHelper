# Technical design: release readiness — rename to Manuscript, Report a problem, Getting started, cheat sheet (2026-11-22, built 2026-11-25)

> Historical document: requirements, design and as built. The current state is in the living
> documents (`docs/dev/design-overview.md`, `supernote-host-facts.md`, README, PRIVACY).

## 1. Decisions (Tilman, 2026-11-22)

- **Rename to "Manuscript"** everywhere a user or a file name sees it, folders included. The pluginID (`wkx45auazdre2crs`) and pluginKey (`textboxHelper`) stay — a new ID installs as a second plugin — and so does the plugin folder the host gives (`PluginManager.getPluginDirPath()`). The GitHub repo is renamed by Tilman.
- **Report a problem:** one export for bug reports, also for development. No persistent log. Errors are kept for the session only.
- **Catch screen crashes** if simple: yes.
- **Version** visible.
- **Devices:** developed on the A5 X; other devices are beta, said so in README, release notes and Getting started. No device detection.
- **Getting started:** in the help (always there), and shown once on the first start: the core marks, the toolbar entries with what they do, first things to do (import, cheat sheet, help).
- **Cheat sheet:** a picture of the editing marks (core marks, slash, exact delete/replace) put on the **current page** as an image; no toolbar entries on it. Offered on the first start and in Getting started. Where the host places it is checked on the device.
- **Backups:** not now; on the backlog to discuss whether a restore is needed.
- **Toolbar:** no change.

## 2. Scope and steps

| Step | Content |
|---|---|
| R1 | Rename (§3) |
| R2 | Report a problem, session errors, screen error boundary, version (§4) |
| R3 | Getting started in the help, first start (§5) |
| R4 | Cheat sheet picture and "Put on this page" (§6) |
| R5 | Docs: README (beta devices, known limits), CHANGELOG, help text, policy/host facts (§7) |

## 3. Rename (R1)

| Where | From | To |
|---|---|---|
| `PluginConfig.json` `name`, `desc` | "Textbox Tools", "Tools for importing, editing, and exporting Supernote textboxes." | "Manuscript", "Work on a typed text by pen: mark edits by hand, review, apply; import and export." |
| Screen and help titles, status texts, README title, `docs/` | "Textbox Tools" as the product | "Manuscript" |
| Font folder (`domain/fontPaths.ts`, texts, README, host facts) | `MyStyle/TextboxHelper/fonts` | `MyStyle/Manuscript/fonts` |
| EXPORT file names | `textboxhelper-*` | `manuscript-*` |
| Backup and log labels | `textboxHelper` | `Manuscript` |
| `kind` in JSON exports | `textboxhelper-timings` | `manuscript-timings` |

**Stays:** pluginID, pluginKey, button ids, the plugin folder and the files in it, `package.json` name, the native module name. The lasso button "Textbox Tools" keeps its name: it is the split/join/clean-up part of Manuscript. **No migration code:** fonts are moved once by hand; the release notes say it. **Check:** a test keeps the old names out of the source.

## 4. Report a problem (R2)

- **The file** `EXPORT/manuscript-report-<time>.json` (`domain/problemReport.ts`, pure builder; `actions/problemReport.ts`): plugin build, device, the note (file name only, page count, current page, page size, linked-file mode and count), settings, the marker diagnostics, the timings, the session's errors, and the current page's text only when "Include the text of this page" is ticked; otherwise previews are emptied.
- Save Diagnostics and Save timings go; Settings → Diagnostics has Report a problem with the checkbox. Clear (timings) stays.
- **Session errors** (`utils/errorLog.ts`): a ring of the last 50 in memory, no file.
- **Screen crashes** (`ui/ErrorBoundary.tsx`) around the body in `ui/ScreenFrame.tsx`: "Something went wrong on this screen." · Report a problem · Close.
- **Version** in the help and in the first line of Settings → Diagnostics.

## 5. Getting started (R3)

The help gets a first section **Getting started** before "Marks at a glance": what Manuscript does, the buttons, the core marks (delete, replace, insert), first things to do (import, cheat sheet), good to know (backups, A5 X and beta devices, Report a problem). `settings.json` gains `onboarding: {seen}`; while it is false the Manuscript card opens with the help on Getting started and a footer "This is shown once. It's always under ? › Getting started."; closing it sets `seen: true`.

## 6. Cheat sheet (R4)

A picture of the editing marks (delete, replace, insert, change letters, one letter, the "+ text" line), drawn by a script, bundled, written to a file and inserted with `PluginNoteAPI.insertImage(path)` into the current page. A picture is never an edit mark. No backup (nothing of the user's text changes); the note is saved after inserting. **Device check first:** whether insertImage works from the plugin view, where it lands, whether it moves, erases and survives saving. If it fails: the PNG goes to EXPORT, to place with the picture tool.

## 7. Docs (R5)

README (title, A5 X tested and other devices beta, known limits, Report a problem in Support, "formerly Textbox Tools"), CHANGELOG, host facts (insertImage, font folder), policy (font folder; bug reports ask for the report), issue form.

## 8. Tests

`problemReport.test.ts`, `errorRing.test.ts`, `markHelpPages.test.ts` (Getting started first, fits the box), `settingsModel.test.ts` (`onboarding`), the rename guard, `MarkHelp` opens on Getting started, `ErrorBoundary` renders its card, a picture element is no mark.

## 9. Device test

1. Plugin list shows "Manuscript" with the new description; the toolbar entries work as before.
2. First start: the card opens with Getting started; closing and reopening → not again; "?" → Getting started.
3. "Put cheat sheet on this page": where it lands, move, erase, reopen; Manuscript ignores it.
4. Settings → Diagnostics shows the version line; Report a problem with and without text.
5. A font in the old folder is no longer read; moved to `MyStyle/Manuscript/fonts` → read.

## 10. As built (2026-11-25)

Built on `feature/release-readiness` from `main` `0b812bf` (after mark-dialogue and comments-images), commits R1 `5336a57`, R2 `447263f` (+ `02137b3`), R3 `41fab48`, R4 `bb2e33f`, R5. Differences from the design:

- **R1:** The write probe file is `.manuscript-probe.txt`. The rename guard is `__tests__/productName.test.ts`: no `TextboxHelper` / `textboxhelper` / `textbox-tools` anywhere in `src/`, `App.tsx`, `index.js`; "Textbox Tools" only in the files that name the lasso panel (and `domain/markHelp.ts`, where Getting started names that button). Docs, PRIVACY, SECURITY and CONTRIBUTING say "Manuscript (formerly Textbox Tools)".
- **R2 errors:** instead of a `reportError()` at each call site and a hook in `userMessage()` (which is in `domain/` and can't keep state), `installErrorCapture()` in `index.js` wraps `console.error` and `console.warn`: every caught error the plugin logs is in the ring without touching ~95 call sites. Entries keep the `[Module]` prefix, message (≤ 500 characters) and stack (≤ 1,500); a crash's component stack comes first, so the screen's name survives the cut.
- **R2 report:** without the text, previews are replaced by their length ("[15 characters]") rather than emptied, so a report still shows whether a textbox had text; keys ending in `path` keep only the file name, also in the settings. Device fields come from `Platform.constants` (Model, Manufacturer/Brand, Release, Fingerprint) and `Dimensions`. The version line in Diagnostics: "Manuscript <label> · build N · <device> · Android …". `actions/timingsExport.ts` is gone.
- **R3:** the help's title in Manuscript is "Help". Getting started has five blocks; the core marks are overview rows (tap → their picture page); "Put cheat sheet on this page" sits under "First things to do". The footer of every Getting started page shows "Manuscript <label>" (the help's version line); on the first start it says the help is shown once. Only the Manuscript card opens it by itself.
- **R4:** the picture is drawn by `scripts/cheatsheet.mjs` (`npm run cheatsheet`) from the marks' icons into `docs/user/images/cheatsheet/` (1200 × 816, greyscale, committed, with a hash; `--check` in `npm run check`), in its own folder so the marks' manifest stays as it is. It is written to `<plugin folder>/manuscript-cheatsheet.png` before `insertImage` (a folder the host can read). The fallback copies it to `EXPORT/manuscript-cheatsheet.png`. The device check of `insertImage` was not done before building; the commit's Device test asks for it, and the fallback covers a failure.
- **R5:** README "Known limits" says landscape is untested (not "not supported"); the help pictures already page for a low box.
