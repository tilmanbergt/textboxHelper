# Manuscript - notes for agents and reviewers

Manuscript (formerly Textbox Tools) is a Supernote NOTE plugin (React Native + `sn-plugin-lib`, one native Kotlin
module). The rules for every change are in `docs/dev/DEVELOPMENT-POLICY.md`; this file doesn't
repeat them: it says what a code review looks for.

## Review guidelines

**P0 - must not merge.** Each rule: the invariant, what to flag, what to do instead.

- **Preview before every change to a note.** Flag a split, join, cleanup, marker, import or other
  action that changes page elements without showing what will change first. Instead: build the
  plan, show it, apply only after the user confirms. The lasso toolbar's direct actions are the
  one documented exception (DEVELOPMENT-POLICY §2).
- **Backup before the page is touched.** Flag a destructive action whose backup
  (`writeBackupFile`) is written after the first change to the page, or whose failure doesn't
  stop the action. Instead: read, back up, then change; a failed backup stops with a message
  that says nothing was changed.
- **Device paths use `/` only and stay in allowed places.** Flag a path joined with `\`, and a
  write outside the plugin folder (`PluginManager.getPluginDirPath()`), the app's document
  folder (`RNFS.DocumentDirectoryPath`) or the EXPORT folder (`FileUtils.getExportPath()`).
  Instead: build paths with a helper like `src/domain/backupPaths.ts`.
- **The pluginID never changes.** Flag any change to `pluginID` or `pluginKey` in
  `PluginConfig.json`.
- **Network only in the one download.** The plugin uses the network only in Import from URL's
  Download: one GET of the typed address, in `src/supernote/httpFetch.ts`. Flag any other
  `fetch`, socket, `XMLHttpRequest`, network library or call into `httpFetch` from anywhere but
  `actions/urlImport.ts`; flag a request that sends device data (note text, ids, a body, cookies),
  keeps a connection open, retries or polls, or asks INTERNET anywhere but right before that
  download. Instead: keep it to that one call.

**P1 - fix before merging, or say why not.**

- New pure logic without a Jest test, or a bug fix without a test that fails for the bug.
- A user-visible change without a line under `## [Unreleased]` in `CHANGELOG.md`.
- A new permission or a new place where data is written without updating the README (and
  PRIVACY.md once it exists).
- A caught error that is neither logged nor shown to the user.
- A new or changed heuristic (marker recognition, text measurement, splitting) without a comment
  that explains why it works this way.

**Don't flag** - these are checked already or not worth a comment:

- what `npm run check` enforces: tsc, ESLint, Jest;
- formatting, style and naming preferences;
- documents in `docs/dev/history/`: they are historical by design.
