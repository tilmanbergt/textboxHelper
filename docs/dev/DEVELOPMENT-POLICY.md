# Manuscript development policy

> **About this document.** The one document that says what has to be true after every change and
> before every release. It applies to everyone who changes the code - in practice mostly Claude,
> working with Tilman - and is checked point by point at the end of every feature, bugfix and
> release. Like every living document (§5) it states the rules as they apply now; change it in the
> same change that shows a rule is wrong or missing (§10).

If a change can't follow a rule here, say so explicitly in the change (commit message, design doc
or code comment) and why. Silent exceptions are not allowed.

## 1. How work is done

1. **Features: requirements, then design, then implementation.**
   - Requirements are clarified in conversation first: questions, edge cases, decisions.
   - Then a technical design in `docs/dev/history/technical-design-<topic>.md`: requirements as
     decided, current state, design, files, test plan (what Jest covers, what the device test
     covers), open points.
   - Implementation starts only after the design is approved. The design doc gets an
     **"As built"** section when it's done.
2. **Bugs: exact failure, then root cause, then fix.** Pin down the exact failure (steps, device,
   version, message or log), find the root cause in the code, write a Jest test that fails for it
   where the cause is testable, then fix it. No fixes based on guesses. If diagnosis needs more
   data, add logging first.
3. **Small, verified steps.** Every step ends with the checks in §6 passing.
4. **Ideas that come up on the way** go to the internal backlog (the claude.ai project document
   `claude/next-improvements.md`), not into the current change.

## 2. Product principles

- **Your text is never lost.** Every action that changes a note shows a preview first and asks
  for confirmation. Before the first change to a page, the affected text is written to a backup file
  in the plugin folder and summarized on the clipboard. If the backup fails, nothing is changed.
- **Built on Supernote features.** The plugin works with the NOTE app's own textboxes, pages,
  lasso and toolbar, and with plain files (text import, DOCX export) - no data of its own that
  only the plugin can read.
- **Calm and made for e-ink.** Few, clear screens; no notifications; nothing changes without the
  user asking for it.
- **Offline.** The plugin uses no network. Its only permissions are file read and write.
- **Heuristics are explained.** Marker recognition, text measurement and splitting rely on
  heuristics and calibration values. Each one says in a comment why it works this way, and a
  change to one is tested on the device.

## 3. Architecture rules

The architecture as built is described in `design-overview.md`. These rules are binding:

- **Layers.** Code under `src/` lives in one layer: `domain/` (pure logic), `utils/`,
  `supernote/` (SDK and native calls), `storage/` (file I/O), `actions/` (the flows behind the
  buttons), `ui/`, `screens/` (`design-overview.md` §2). A layer imports only from the layers
  below it; ESLint enforces this, and the rule is never switched off.
- **Pure logic is separate.** Logic that needs no device lives in `src/domain/` without React
  Native, `sn-plugin-lib` or file access - not even `import type` from the SDK; the domain types
  in `domain/textboxModel.ts` stand in for SDK types. New pure logic goes there, with Jest tests
  in `__tests__/domain/`. Something the logic needs from the device (a text measurement) is
  passed in as a parameter.
- **Reuse the shared textbox core** (`domain/geometry.ts`, `hitTesting.ts`, `textboxLayout.ts`,
  the pagination) instead of adding local helpers. Textbox height has one source of truth:
  `supernote/textboxMetrics.ts` with the native `TextboxMetrics` module. SDK calls go through
  `src/supernote/` (`noteElements.ts`, `sdkResult.ts`) rather than being repeated in flows.
- **Device paths** are joined with `/` only. The plugin writes only to its own folder
  (`PluginManager.getPluginDirPath()`: backups, `settings.json`, `pen-edits/`), the app's document folder
  (`RNFS.DocumentDirectoryPath`: temporary files) and the EXPORT folder
  (`FileUtils.getExportPath()`: DOCX and JSON exports). It reads text files from any folder (chosen
  with the Supernote file selector) and writes a linked file back where it is - only after the
  user's Apply or Update, and only when the file didn't change outside since the plugin last read
  or wrote it; a copy next to it or into EXPORT on Save as copy / Save to EXPORT; and a probe file
  `.textbox-tools-probe.txt` there only on Check write access (`technical-design-source-link.md`).
  In a folder bound to a note as ordered, it writes the folder's `index.txt` (a list of
  `[[links]]`, the plugin's own file) on import and Update, and lists the folder's `.txt` files
  (`technical-design-linked-files.md`); it never deletes or renames a user's file.
  It reads font files from `/system/fonts`, `MyStyle/fonts` and
  `MyStyle/Manuscript/fonts`. A new place needs a line in the README and in
  `supernote-host-facts.md` if the host restricts it.
- **Host calls are checked.** Every `sn-plugin-lib` call's result is checked for success; a
  failure becomes an error with a message the user can understand.
- **The pluginID never changes** (`PluginConfig.json`: `wkx45auazdre2crs`).
- **File size.** Files stay at or below 1,000 lines; split by responsibility.

## 4. UI and logging rules

- **Target:** the Supernote NOTE app, developed and tested on the A5 X. Grayscale only: color never carries meaning.
- **No scrolling.** Every screen is a bounded flex column in `src/ui/ScreenFrame.tsx` (header,
  body, footer with the status line and one primary button). Long lists page with
  `ui/PagedSection.tsx`, long text with `ui/PagedText.tsx`; arrows show only when there is more.
  ESLint forbids `ScrollView`, `FlatList` and `SectionList`. Styles come from `ui/theme.ts`;
  meaning is carried by weight, underline and strikethrough, never by colour.
- **Destructive actions** go through a review screen whose primary button names the change
  ("Apply 4 changes", "Apply Join Text Boxes"); the result message names the backup file. A review
  screen stays open after the change with the result, its primary button turning into Close.
- **Labels** are short, English and the same everywhere (toolbar button, dialog title, status
  text). `src/domain/textboxActionKinds.ts` holds one label and one progress text per action kind.
- **Logging:** log lines start with the module in brackets, e.g. `[EditMarkerActions] stage`.
  Every caught error is either shown to the user or logged, with enough context to find the
  cause. Logs never contain more of the user's text than the diagnosis needs; prefer counts and
  ids. Every `console.error` and `console.warn` also goes into the session's errors
  (`utils/errorLog.ts`, newest 50, memory only), which **Report a problem** writes to its file:
  bug reports ask for that file. A screen crash is caught by the error boundary in `ScreenFrame`.

## 5. Documentation in the same change

A change is not done while the docs describe the old behavior.

- **Code comments** say what the code does and why, as it is now: constraints, invariants,
  non-obvious behavior, a reference to the design doc section. No dates, no "used to",
  "previously", "no longer", no change history - history lives in git and in the design
  documents.
- **CHANGELOG.md**: every user-visible change gets a line under `## [Unreleased]` (Added, Changed,
  Fixed, Removed), written for users. This text becomes the GitHub release notes.
- **README.md**: update "Main Features" when a feature is added, removed or changed. "Edit marks
  at a glance" mirrors the help's overview (`MARK_HELP` in `src/domain/markHelp.ts`, the icons in
  `docs/user/images/marks/`); `__tests__/readmeMarks.test.ts` fails when a mark, its name or its line
  differs.
- **Developer docs** come in two kinds (list in `docs/dev/README.md`):
  - **Living documents** live directly in `docs/dev/` and describe the current state in present
    tense: no history, no open questions, no plans. Each starts with a short "About this
    document" note. Update the affected one in the same change.
  - **Historical documents** (`technical-design-*.md`, device test records) live in
    `docs/dev/history/`. They are written for one feature or release, get their "As built"
    section, and are then left alone.
- **Host facts**: when the Supernote or its plugin host behaves in a way the SDK docs don't say,
  add it to `supernote-host-facts.md` in the same change.
- **Open work lives in one place**: ideas, bugs, technical debt and housekeeping go to the
  internal backlog (`claude/next-improvements.md` in the claude.ai project), never into the
  repository's documents.

## 6. Checks and tests

- **`npm run check`** writes the build info, checks the help pictures, runs the script tests,
  then the type check, ESLint and Jest. It passes with zero errors and zero warnings after every
  step and before every commit.
- **CI** (`.github/workflows/check.yml`) runs `npm run check` on every push to a branch and on
  every pull request, then builds the `.snplg` of the push (`RELEASING.md` §4). A red run is fixed
  before anything else on that branch; a red `main` can't be released.
- **Jest tests** live in `__tests__/`. New pure logic gets tests, including edge cases; a fixed bug
  gets a test that would have caught it, where its cause is testable without the device.
- **On the device**, for every change that touches UI, notes, files or device APIs: take the CI
  build of the push (or build with `./buildPlugin.ps1`), install it over the previous build, test the changed flow and the actions
  next to it. Test on a copy of a note, never on an important one.
- A change is only reported as done when the checks passed - and the report says what was
  verified off-device and what still needs a device test.

## 7. Definition of done - checklist for every change

- [ ] Requirements/design agreed (features) or root cause found (bugs) - §1
- [ ] Fits the product principles - §2
- [ ] Architecture rules kept - §3
- [ ] UI and logging rules kept - §4
- [ ] CHANGELOG `[Unreleased]`, README, dev docs, host facts updated as needed - §5
- [ ] `npm run check` passes with zero warnings; new logic has tests - §6
- [ ] Device test done, or explicitly listed as still open - §6
- [ ] Every commit with an effect on the device ends its message with a **"Device test:" block**
      (numbered steps, expected results after `->`), or `Device test: none - <reason>`
      (format: `RELEASING.md` §3)
- [ ] Ideas found on the way are on the backlog, not half-built - §1
- [ ] Step-by-step guide for Tilman given - §9

## 8. Release checklist

The release steps themselves are in `RELEASING.md` §5 (`scripts/release.ps1`). Before a release:

- [ ] Everything since the last release meets §7; no open "still needs device test" items, or
      they are consciously accepted and named.
- [ ] **Version**: patch = fixes only; minor = new features or changed behavior (SemVer 0.x).
- [ ] **CHANGELOG** `[Unreleased]` read once more as a user: complete and correct. It becomes the
      release notes.
- [ ] **README** feature list still true.
- [ ] **Logging**: no debug-only noise left in hot paths; no more user text logged than needed.
- [ ] CI is green on `main` for the commit to release (checks and build); `release.ps1` checks it
      and runs `npm run check` once more on the release commit.
- [ ] For a minor release: a beta was tested (`RELEASING.md` §4 "Betas"), or consciously skipped.
- [ ] Device check (`RELEASING.md` §6): install **over the previous release**, every toolbar
      entry opens, the changed flows work, the plugin list shows the new version.
- [ ] After publishing: the release page has the text and the `.snplg`; the next version is set.

## 9. Step-by-step guide after every change

Merges, installs and releases run on Tilman's side. A cloud session commits and pushes its own
feature branch; CI then checks and builds every push (`RELEASING.md` §4). At the end of every
change, build or release, Claude gives a short, numbered, copy-paste-ready guide (PowerShell,
repository root): where we are (branch, what was verified, what still needs the device), where
the build is (the CI run's artifact, or a local `./buildPlugin.ps1`) and what to test, whether
the branch is ready to merge, and whether a release is advisable now. When Claude can't push, the
commits come as files in `build/` (ignored by git): a message with a body (and so every "Device
test:" block) to commit with `git commit -F build\<file>`.

## 10. Keeping this policy alive

- When a rule turns out wrong or a new kind of mistake happens, update this document in the same
  change that fixes it, so it doesn't happen twice.
- `CLAUDE.md` in the repository root points here; keep it short and in sync.
