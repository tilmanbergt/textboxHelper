# Manuscript - developer notes

> **About this document.** How to build and check the plugin, a tour of the code, and the list of
> developer documents. Living document: present tense, kept true in every change that moves a
> file, adds a script or adds a document.

## Building

Requirements: Node 18 or newer, Java 17 and the Android SDK (Android Studio), Windows PowerShell.

```powershell
npm ci                     # install exactly what package-lock.json says (also writes src/generated/ and the help pictures)
npm run check              # build info, help pictures, script tests, type check, ESLint, Jest
./buildPlugin.ps1          # build the plugin, labelled for package.json's nextVersion (0.3.0-alpha+a1b2c3d)
./buildPlugin.ps1 -Stage beta   # the same, labelled 0.3.0-beta+a1b2c3d
```

The build stamps the version into `src/generated/buildInfo.ts` and `build/build-info.json`
(`scripts/version.mjs`), bundles the JavaScript, compiles the native module with Gradle and writes
`build\outputs\manuscript.snplg` plus a copy named after the label,
`manuscript-0.3.0-alpha+a1b2c3d.snplg`. `PluginConfig.json` in the repository root keeps the
released version, pluginID and permissions; the packaged copy gets the label's versionName
(`0.3.0-alpha`) and a new versionCode. Labels and releases: `RELEASING.md`. Install the `.snplg`
on the Supernote by copying it to `MyStyle/` and installing it in Settings → Apps → Plugins, over
the existing plugin.

`buildPlugin.sh` (Linux/macOS) builds the same package without the label.

npm is the package manager; there is no `yarn.lock`.

## Checking your changes

`npm run check` runs, in this order, and stops at the first failure:

1. `npm run gen` - writes `src/generated/buildInfo.ts` (`scripts/version.mjs`) and bundles the
   help pictures into `src/ui/generated/` (`scripts/gen-mark-images.mjs`);
2. `node scripts/marks.mjs --check` - every help picture is drawn from the current spec;
3. `npm run test:scripts` - tests of the scripts (`test-marks.mjs`, `test-versioning.mjs`,
   `test-ci-build.mjs`, `test-test-notes.mjs`);
4. `tsc --noEmit` - zero errors;
5. `eslint .` - zero errors and zero warnings;
6. `jest --passWithNoTests` - every test in `__tests__/` passes.

The single steps are also available as `npm run typecheck`, `npm run lint` and `npm test`.

## Help pictures

The edit-marker help shows a picture of every mark: the marked textbox, then the text after
Apply, and a small icon of the mark for the overview. They are drawn, not hand-made:

- `docs/user/marks/marks.mjs` is the spec: sample text, the pen marks by word position, the text
  after Apply. The words next to each picture are in `src/domain/markHelp.ts`, same id.
- `npm run marks` draws the entries that changed into `docs/user/images/marks/` (PNG, greyscale,
  committed) and `manifest.json`; `npm run marks -- --all` draws all.
- `npm install` / `npm ci` (postinstall) and `npm run check` write
  `src/ui/generated/markImages.ts` (data URIs, not committed), which `ui/MarkHelp.tsx` shows.

To change a picture: edit the spec (or `scripts/lib/markDrawing.mjs` for every picture), run
`npm run marks`, look at the PNGs, commit them with the spec.

The cheat sheet (`docs/user/images/cheatsheet/cheatsheet.png`, put on a page from Getting
started) is drawn by `npm run cheatsheet`: the examples in `docs/user/marks/cheatsheet.mjs` (same
entry format as the marks, drawn by `drawMarkExample` in `markDrawing.mjs`), laid out by
`scripts/cheatsheet.mjs`; `npm run check` fails when it is older than the examples, the script or
the drawing.
`gen-mark-images.mjs` bundles it as `CHEAT_SHEET`.

## Code tour

| Path | What lives there |
|---|---|
| `index.js` | Registers the toolbar buttons (lasso toolbar and NOTE toolbar) and starts routing. If a button doesn't appear where expected, start here. |
| `App.tsx` | The plugin window: asks for file permissions, routes each button press to a view, runs previews and actions, shows status and results. |
| `src/actions/` | The flows behind the buttons: `textboxEdits.ts` (split, join, clean, remove line breaks, Log All Textboxes), `markerPageAnalysis.ts`, `markerApply.ts`, `markerCalibration.ts`, `markerMeasure.ts` and `editMarkerDrop.ts` (handwritten edit markers; what the marks are and where they act is `src/domain/marks/`), `penEditTag.ts`, `noteTag.ts`, `sidemarkWrite.ts` and `penEditReview.ts` (tagged handwritten text, comments and images), `textImport.ts` (text file into textboxes), `textboxScan.ts` (scan for the DOCX export). |
| `src/domain/` | Pure logic, tested with Jest: text splitting, edit plans, marker strokes and text changes, the two passes of the edit marks (`marks/`: what the strokes are, where they act), geometry, hit testing, pagination, import parsing and planning, export classification, backup payloads, button ids and action labels, the domain types (`textboxModel.ts`). |
| `src/supernote/` | Device access: SDK calls (`noteElements.ts`, `noteTextInsertion.ts`, `markerStrokeRead.ts`, `exportNoteContext.ts`, `sdkResult.ts` with `SdkResponse` and `sdkErrorText`, `sdkElements.ts`), native text measurement (`textboxMetrics.ts`), button routing, permissions. If a host call fails, start here. |
| `src/storage/` | Files: backups, JSON into EXPORT, the import text file, DOCX. |
| `src/utils/` | The edit-marker diagnostics trace. |
| `src/screens/` | The views and dialogs of the plugin window. |
| `src/ui/` | Shared building blocks of the screens: `ScreenFrame`, buttons, tabs, paging (`PagedSection`, `PagedText`), the help (`HelpOverlay`, `MarkHelp`), `theme.ts`; `generated/` holds the bundled help pictures (not committed). |
| `__tests__/domain/`, `__tests__/ui/` | Jest tests, one file per domain module or group; `ui/` for the help screen and its pictures. |
| `__tests__/marks/` | The edit marks' tests, in the shape of the two passes: pass 1 (`pass1.read`, `pass1.sameJudge`, `pass1.lookBack`; cases in `pass1.cases.ts`), pass 2 (`pass2.place`), both together on a page (`pass12.resolve`); builders that draw marks and lay out textboxes (`build.ts`), and the golden record of the review (`golden.test.ts`): pages served by a fake host (`golden/host.ts`, `golden/pages.ts`) and the changes and ignored marks today's review gives for each (`golden/*.json`). Helpers there are no test files: Jest runs only `*.test.ts(x)`. |
| `scripts/` | `marks.mjs`, `gen-mark-images.mjs`, `test-marks.mjs`: drawing, bundling and checking the help pictures. `version.mjs` and `lib/versioning.mjs` (tested by `test-versioning.mjs`): build labels, build info and the release helpers. `ci-build.mjs`, `lib/ciBuild.mjs` (`test-ci-build.mjs`): steps of the GitHub builds. `test-notes.mjs`, `lib/testNotes.mjs` (`test-test-notes.mjs`): TESTING.md. `release.ps1`: the release (`RELEASING.md` §5). `cheatsheet.mjs` (`npm run cheatsheet`): draws the cheat sheet of the editing marks from `docs/user/marks/cheatsheet.mjs` to `docs/user/images/cheatsheet/` (committed; `--check` in `npm run check`). |
| `.github/workflows/` | `check.yml`: checks and a test build on every push. `beta.yml`: a beta pre-release by button. |
| `src/generated/` | `buildInfo.ts`: version, label and commit of the build (written by `scripts/version.mjs`, not committed). |
| `docs/user/marks/`, `docs/user/images/marks/` | The help pictures' spec and the drawn PNGs. |
| `android/.../com/textboxhelper/TextboxMetricsModule.kt` | Native module: Android `StaticLayout` text measurement for textbox sizes and hit testing. |

## Documents

**Living documents** describe the current state and are kept true in every change. They contain
no history and no open work:

- `DEVELOPMENT-POLICY.md`: the rules and checklists for every change and release. **Start here.**
- `design-overview.md`: how the plugin is built, and why.
- `supernote-host-facts.md`: how the Supernote and its plugin host behave where the SDK
  documentation is silent or unclear.
- `RELEASING.md`: git, commits, builds, betas and releases.
- `GITHUB-GUIDE.md`: which GitHub button or workflow to use when.
- this `README.md`.

In the repository root: `CLAUDE.md` (short instructions for Claude), `AGENTS.md` (code review
guidelines), `CONTRIBUTING.md`, `CHANGELOG.md`, `PRIVACY.md`, `SECURITY.md`; `.github/` holds the
workflows, the issue forms and the pull request template.

**Historical documents** live in `docs/dev/history/`: technical designs (`technical-design-*.md`,
requirements, design, as built) and device test records. They are written once and not updated
afterwards; if one disagrees with a living document, the living document is right.

Open work - ideas, bugs, technical debt - is not kept in the repository but in the internal
backlog (the claude.ai project document `claude/next-improvements.md`).
