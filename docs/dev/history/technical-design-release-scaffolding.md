# Technical design: release scaffolding on GitHub (2026-11-25)

> Historical document: requirements, design and as built. The current workflow is in
> `docs/dev/RELEASING.md` and `docs/dev/GITHUB-GUIDE.md`.

Read against
`main` `22e58e8` (tilmanbergt/manuscript) and modelled on Kept GTD (`tilmanbergt/kept-gtd`:
`.github/`, `scripts/release.ps1`, `scripts/ci-build.mjs`, `scripts/lib/versioning.mjs`,
`scripts/test-notes.mjs`, `docs/dev/GITHUB-GUIDE.md`, `RELEASING.md`). Where Manuscript does the
same thing, it uses the same command, button and file name as Kept GTD, so the two feel alike.

## 1. Decisions (Tilman, 2026-11-25)

- **The name "Manuscript" is free** (InkHub, Supernote community). Of the "Release readiness — to
  discuss" items only the release scaffolding is taken in now. Backups, the persistent log and the
  feature freeze stay on the backlog.
- **Version labels and CI builds as in Kept GTD**, with `nextVersion` = `0.3.0`.
- **`nextVersion` is set locally only** (`npm run next-version -- x.y.z`, then commit). No
  next-version workflow, so no deploy key and no branch protection.
- **TESTING.md, simple version:** the "Device test:" blocks of the commits plus the new CHANGELOG
  lines. No feature areas, no scenario catalog.
- **The repo is renamed to `manuscript`** (done, 2026-11-25). Private vulnerability reporting is
  on. `feature/layers` is deleted.
- **Discussions stay off.** The issue form points questions to a normal issue.
- **Cloud sessions push their branch directly to GitHub.** This branch is
  `feature/release-scaffolding`, from `main`.
- **Order:** scaffolding → merge into `main` → merge `main` into `feature/mark-dialogue` and
  `feature/comments-images` (they get CI builds for their device tests) → merge those → R1 (rename
  in the code, `claude/technical-design-release-readiness.md`).

Chosen here (change them if you see it differently):

- **D1 Release type.** Betas are GitHub pre-releases (`v0.3.0-beta.1`). The final `0.3.0` is a
  normal release, the first non-pre-release. The betas are the "few testers first" step.
  `release.ps1 -Prerelease` stays available, in case a release should still be marked
  experimental.
- **D2 Names.** Assets are `manuscript-<label>.snplg`, release titles "Manuscript 0.3.0" and
  "Manuscript 0.3.0 beta 1", CI artifacts `manuscript-<label>`. They are named after the product,
  not after `package.json` (`textboxhelper` stays internal, per R1) or after the local folder.
- **D3 versionCode** = minutes since 2026-01-01 UTC, always above the last one (as in Kept GTD).
  Today's `"3"` is far below, so every new build is higher and installs over 0.2.2.
- **D4 Build info in the app.** The build writes `src/generated/buildInfo.ts` (label, version,
  commit, stage). In this change only the timings export uses it, instead of
  `PluginConfig.json` `versionName`. "Version visible" in Settings and the help (R2) builds on it
  later.
- **D5 No Codex review, no coverage ratchet, no in-app update check, no CHANGELOG in the app.**

## 2. What comes over from Kept GTD, and what doesn't

| Kept GTD | Manuscript |
|---|---|
| `.github/workflows/check.yml`: job `check` (coverage, quality report), job `build` | Job `check` runs `npm run check` (no coverage). Job `build` is the same: Windows, artifact for 30 days, TESTING.md |
| `.github/workflows/beta.yml` | The same, title "Manuscript x.y.z beta n" |
| `.github/workflows/next-version.yml` | **Not taken** (local only) |
| `scripts/lib/versioning.mjs` | Taken without `selectChangelogForApp`, `renderChangelogTs` and the help/user-docs parts |
| `scripts/gen-bundled-content.mjs` | Becomes `scripts/version.mjs` (Manuscript bundles no help or changelog). Same flags: `--build --stage`, `--patch-config`, `--set-next`, `--set-version`, `--stamp-changelog`, `--release-notes`, `--check-release` |
| `scripts/ci-build.mjs`, `scripts/lib/ciBuild.mjs` | Taken (`next-beta`, `verify [--beta]`, `notes`), names changed |
| `scripts/test-notes.mjs`, `scripts/lib/testNotes.mjs` | Simple version: `parseCommitMessage`, `changelogAdded`, `lastReleaseTag`, `renderTestNotes` without areas and scenarios |
| `scripts/release.ps1` | Taken. The quick tier and coverage become `npm run check`; no coverage copy into `history/` |
| `buildPlugin.ps1` `-Stage`, step 1b (stamp), step 6b (patch config), labelled copy | Taken into textboxHelper's `buildPlugin.ps1`. `-Check` is left out |
| Issue templates, `config.yml`, PR template | Adapted (§6) |
| `PRIVACY.md`, `SECURITY.md`, `CONTRIBUTING.md` | Written for Manuscript (§6). CONTRIBUTING exists and is aligned |
| `docs/dev/GITHUB-GUIDE.md`, `RELEASING.md` | GITHUB-GUIDE is new. RELEASING is rewritten |

## 3. Version labels (S1)

### 3.1 package.json

```json
"version": "0.2.2",
"nextVersion": "0.3.0",
"scripts": {
  "gen": "node scripts/version.mjs && node scripts/gen-mark-images.mjs",
  "postinstall": "node scripts/version.mjs && node scripts/gen-mark-images.mjs",
  "next-version": "node scripts/version.mjs --set-next",
  "test-notes": "node scripts/test-notes.mjs --out build/TESTING.md",
  "test:scripts": "node scripts/test-marks.mjs && node scripts/test-versioning.mjs && node scripts/test-ci-build.mjs && node scripts/test-test-notes.mjs",
  "check": "npm run gen && node scripts/marks.mjs --check && npm run test:scripts && tsc --noEmit && eslint . --max-warnings 0 && jest --passWithNoTests"
}
```

### 3.2 `scripts/version.mjs`

- No flag (also run by `postinstall` and `gen`): writes `src/generated/buildInfo.ts` for tsc and
  Jest (`versionCode: 0`, label from git), and only rewrites it when something other than the
  date changed.
- `--build [--stage alpha|beta]`: also computes the versionCode (`build/last-version-code.txt`)
  and writes `build/build-info.json`. Prints e.g. `Manuscript 0.3.0-alpha+a1b2c3d  build 474512`.
  It warns when there's no `nextVersion` above `version`, and when `PluginConfig.json`
  `versionName` differs from `package.json` `version`.
- `--patch-config <file>`: writes `versionName` (`0.3.0-alpha`, `0.3.0-beta` or `0.3.0`) and
  `versionCode` into the **packaged copy** `build/generated/PluginConfig.json`. The committed
  `PluginConfig.json` keeps the released version.
- `--set-next <x.y.z>` (refused unless it is above `version`), `--set-version <x.y.z>`
  (`package.json`, `package-lock.json` root, `PluginConfig.json` `versionName`),
  `--stamp-changelog <x.y.z> <date>`, `--release-notes <x.y.z> <file>`,
  `--check-release <x.y.z>`: the release script's helpers, as in Kept GTD.

**Labels** (`versioning.mjs` `buildLabel`, unchanged): `0.3.0-alpha+a1b2c3d` (test build),
`0.3.0-beta+a1b2c3d` (`-Stage beta`), `0.3.0` (the release commit, tagged `v0.3.0`, clean tree).
`.dirty` at the end means uncommitted changes. Without a `nextVersion`: `0.2.2+dev.a1b2c3d`.
The plugin list shows the versionName (`0.3.0-alpha`).

### 3.3 `buildPlugin.ps1`

- `param([ValidateSet('alpha','beta')][string]$Stage = 'alpha')`.
- Step 1b, before bundling: `node scripts/version.mjs --build --stage $Stage`, so the bundle
  carries `buildInfo.ts`. Stop if it fails.
- Step 6b, after copying `PluginConfig.json` to `build/generated/`: `--patch-config`.
- Output: `build/outputs/manuscript.snplg` (it used to be named after the folder,
  `textboxHelper.snplg`) plus a copy `manuscript-<label>.snplg`. A constant
  `$OutputName = 'manuscript'` near the top. Older `textboxHelper*.snplg` files are left alone.
- The rest (bundling, Gradle for react-native-fs, reactPackages) is unchanged. The ASCII-only rule
  for PowerShell 5.1 applies.

### 3.4 App

- `src/generated/` is in `.gitignore`. ESLint and `tsconfig` treat it like `src/ui/generated/`.
- `actions/timingsExport.ts`: `plugin: BUILD_INFO.label` instead of `pluginConfig.versionName`.

## 4. GitHub Actions (S2, S3)

### 4.1 `.github/workflows/check.yml` (S2)

On a push to any branch (`branches: ['**']`, so tags start no run) and on pull requests.

- **Job `check`** (ubuntu-latest, 20 min): checkout, Node 22 with npm cache, `npm ci --no-audit
  --no-fund`, `npm run check`.
- **Job `build`** (`needs: check`, pushes only, windows-latest, 45 min, `concurrency:
  build-<ref>`, cancel-in-progress): checkout with `fetch-depth: 0`, Node 22, Temurin JDK 17 with
  Gradle cache, `npm ci`, `./buildPlugin.ps1` (Windows PowerShell), `node scripts/ci-build.mjs
  verify`, `node scripts/test-notes.mjs --out build/outputs/TESTING.md --branch <ref_name> --before
  <event.before> --label <label>` (`continue-on-error`), stop the Gradle daemon, upload the
  artifact `manuscript-<label>` (the `.snplg` + TESTING.md, 30 days).
- Action versions as in Kept GTD (`checkout@v7`, `setup-node@v7`, `setup-java@v6`,
  `upload-artifact@v7`).
- Same signing key: CI and local builds install over each other, because `android/app/debug.keystore`
  is committed and the pluginID is the same.

`ci-build.mjs verify` fails the run when `build/build-info.json` is missing, the labelled `.snplg`
is missing, or the package has no native modules (`build/generated/app.npk` /
`nativeCodePackage`). Manuscript needs these for react-native-fs. Without them,
`buildPlugin.ps1` still writes a package when Gradle failed. A dirty label is a warning in CI
(an error for betas).

### 4.2 TESTING.md, simple version

`scripts/test-notes.mjs` + `scripts/lib/testNotes.mjs`:

- **Base:** on `main` the last release tag (`vX.Y.Z`, betas skipped); on any other branch the
  merge base with `origin/main`. Fallback: the last 20 commits.
- **Content:** title with the label and branch; the commits since the base, newest first, merge
  commits skipped. Each commit shows its subject and its "Device test:" block. The commits of the
  newest push (`--before`) are marked **NEW**. A commit without a block is flagged ⚠, and
  "Device test: none - …" is shown as one line. After that, the lines added to CHANGELOG
  `[Unreleased]` since the base.
- In Actions the same text also goes to the job summary ("… - what to test"). It never fails: on
  an error it writes a short TESTING.md saying why.

### 4.3 `.github/workflows/beta.yml` (S3)

By hand: Actions → beta → Run workflow (branch `main`). `concurrency: beta`.

- **Job `check`:** only from `main`, then `npm run check`.
- **Job `beta`** (windows, `contents: write`): `ci-build.mjs next-beta` (tag `v0.3.0-beta.n`,
  one above the highest existing), `./buildPlugin.ps1 -Stage beta`, `verify --beta` (dirty, not
  beta, or a release commit → error), TESTING.md since the last release,
  `ci-build.mjs notes` (a note for testers + CHANGELOG `[Unreleased]`; an empty `[Unreleased]` is
  an error), then `gh release create <tag> <snplg> TESTING.md --prerelease --target <sha>
  --title "Manuscript 0.3.0 beta n" --notes-file …`.

Tester note: "Beta n of Manuscript 0.3.0 for testing, built from a1b2c3d. Install the `.snplg`
over your current version; your notes and settings are kept. Developed on the A5 X; other devices
are beta. Please report problems on GitHub with the file from Report a problem." (The last part
only once R2 is in; until then: "with the version from the plugin list".)

## 5. Releases (S4)

`scripts/release.ps1`, ported from Kept GTD:

```powershell
./scripts/release.ps1 -DryRun          # releases nextVersion, changes nothing
./scripts/release.ps1                  # or -Bump patch for a hotfix, -Version x.y.z, -Prerelease
```

1. **Checks:** on `main`, clean tree, pushed, the tag doesn't exist yet, `gh` logged in. CI
   (`check.yml`, both jobs) is green for HEAD (`gh run list`); without `gh` it says so and asks.
2. **Version and changelog:** `--set-version`, `--stamp-changelog` (`## [0.3.0] — <date>`, a new
   empty `[Unreleased]`), release notes to `build/release-notes-0.3.0.md` (plus the install line).
3. **Checks:** `npm run check` on exactly what is committed. Red → stop and print the undo
   commands.
4. **Commit and tag:** `Release 0.3.0` with "Device test: see RELEASING.md §6", annotated tag
   `v0.3.0`.
5. **Build:** `./buildPlugin.ps1` → `build/outputs/manuscript-0.3.0.snplg` (label without
   alpha, because HEAD is the tag).
6. **Device check pause** (`RELEASING.md` §6). `N` → print the undo commands, nothing pushed.
7. **Publish:** `git push origin main --follow-tags`, `gh release create v0.3.0 <snplg> --title
   "Manuscript 0.3.0" --notes-file …` (`--prerelease` only with `-Prerelease`).

After a release: `npm run next-version -- 0.4.0`, commit "Set next version 0.4.0", push.

## 6. Repository files (S5)

- **`.github/ISSUE_TEMPLATE/bug_report.yml`:** Manuscript version (the plugin list, e.g.
  `0.3.0-alpha`; later Settings), device (A5 X, A6 X, A5 X2 Manta, A6 X2 Nomad, Other), firmware,
  steps, expected, what happened (photos welcome), "Report a problem" file (`EXPORT/manuscript-
  report-….json`; look through it first, the page text is only in it if you ticked it). Until R2,
  this field says "if your version has it". Labels `bug`.
- **`feature_request.yml`:** problem, how today, idea (sketches welcome). Short principles: pen
  first, calm on e-ink, your text stays in your notes and files.
- **`config.yml`:** `blank_issues_enabled: false`. No contact links, because Discussions are off.
  The forms say questions are welcome as an issue.
- **`.github/pull_request_template.md`** (replaces `PULL_REQUEST_TEMPLATE.md`): related issue;
  what changes; design (`docs/dev/history/…`); "Touches" (note content / textboxes, file format of
  the plugin folder, deletes or backups, logs and exports, settings, permissions); how it was
  tested (device + firmware, steps); checklist (`npm run check`, CHANGELOG, domain without RN or
  SDK imports).
- **`PRIVACY.md`:** local plugin, no account, no server, no telemetry, **no network permission**
  (`PluginConfig.json`: FILE:READ, FILE:WRITE only). What it reads and writes, checked against the
  code when it's written: the open note (textboxes, pages it adds, the set-aside divider), the
  plugin's own folder (`settings.json`, `pen-edits/` with handwriting pictures and strokes,
  backups before changes, `block-status.json`, link records of linked files), INBOX (import),
  linked files or folders you choose, EXPORT (DOCX, diagnostics/timings, later Report a problem),
  `MyStyle/TextboxHelper/fonts` (only read; R1 changes it to `MyStyle/Manuscript/fonts`).
  Housekeeping (what is removed when), and what a report contains.
- **`SECURITY.md`:** as Kept GTD's: latest release (and the current beta), private reporting
  through the Security tab, an answer within a week, what Manuscript touches (short, links
  PRIVACY).
- **`CONTRIBUTING.md`:** aligned with Kept GTD's (bug form, ideas, issue first for code, policy
  links, CHANGELOG line, MIT).
- **`README.md`:** install from Releases (betas are pre-releases), support section (issues,
  PRIVACY, SECURITY), the repo URL.
- **`docs/dev/GITHUB-GUIDE.md`:** "which flow when", as in Kept GTD, with Manuscript's flows:
  start a branch (cloud session pushes), test the newest push (Actions → run → summary → artifact),
  look at a branch's changes (PR), bring `main` into a branch, small change in the browser editor
  (`.`), merge (PR → Create a merge commit), beta, set the next version (local), release (local
  script), bug reports and labels. No deploy-key setup.
- **`docs/dev/RELEASING.md`:** rewritten like Kept GTD's: setup (gh, noreply), branches, commits
  ("Device test:" blocks feed TESTING.md), test builds (local and from GitHub), betas, releases,
  device check §6, after a release. Uses the new file names (`manuscript-<label>.snplg`).
- **`DEVELOPMENT-POLICY.md`:** §6 CI runs `npm run check` on every push. §8 release checklist
  points to `release.ps1` and the device check. §9 "after every change": push the branch, the CI
  build is what gets device-tested. `CLAUDE.md` / `AGENTS.md`: cloud sessions push their branch.
- **CHANGELOG `[Unreleased]`:** "Test builds show what they are in the plugin list (e.g.
  0.3.0-alpha)." "The package is now called `manuscript-<version>.snplg`."

## 7. Files

| New | Changed | Deleted |
|---|---|---|
| `.github/workflows/check.yml`, `beta.yml` | `buildPlugin.ps1` (§3.3) | `.github/PULL_REQUEST_TEMPLATE.md` (replaced) |
| `.github/ISSUE_TEMPLATE/bug_report.yml`, `feature_request.yml`, `config.yml`, `.github/pull_request_template.md` | `package.json` (§3.1), `.gitignore`, `.eslintrc.js` / `tsconfig.json` (generated dir) | |
| `scripts/version.mjs`, `ci-build.mjs`, `test-notes.mjs`, `release.ps1` | `src/actions/timingsExport.ts` | |
| `scripts/lib/versioning.mjs`, `ciBuild.mjs`, `testNotes.mjs` | `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md` | |
| `scripts/test-versioning.mjs`, `test-ci-build.mjs`, `test-test-notes.mjs` | `docs/dev/RELEASING.md` (rewritten), `DEVELOPMENT-POLICY.md`, `CLAUDE.md`, `AGENTS.md`, `docs/dev/README.md` | |
| `PRIVACY.md`, `SECURITY.md`, `docs/dev/GITHUB-GUIDE.md`, this design in `docs/dev/history/` | | |

`buildPlugin.sh` (the Linux/macOS build) gets no labels. It is noted as such in RELEASING.md.
CI and Tilman use the PowerShell script.

## 8. Tests

Node script tests (as `test-marks.mjs`, in `npm run test:scripts`):

- `test-versioning.mjs`: `bumpVersion`, `compareVersions`, `targetVersion`, `buildLabel` (release,
  alpha, beta, dirty, no next), `packagedVersionName`, `computeVersionCode` (strictly increasing),
  `parseChangelog` / `stampChangelog` (CRLF kept, empty `[Unreleased]` refused, version twice
  refused), `setJsonStringField`, `setLockfileVersion`.
- `test-ci-build.mjs`: `nextBeta` (first, after gaps, other versions ignored, no target → error),
  `checkBuild` (missing info, missing snplg, no native package, dirty alpha warning, dirty beta
  error, beta from a release commit), `betaNotes` (empty `[Unreleased]` → error).
- `test-test-notes.mjs`: `parseCommitMessage` (block, "none", no block, CRLF), `changelogAdded`,
  `lastReleaseTag` (betas skipped), `renderTestNotes` (NEW, ⚠, none, no changelog lines).

Jest: no new tests. `timingsExport` keeps its current tests, with `buildInfo` mocked if needed.

## 9. Steps and device stops

Each step: `npm run check` green, its own commit with a "Device test:" block, docs in the same
commit, pushed to `feature/release-scaffolding`.

| Step | Content | Check |
|---|---|---|
| S1 | Version labels: `version.mjs`, `versioning.mjs` + tests, `buildPlugin.ps1`, `buildInfo.ts`, `nextVersion` 0.3.0, timings export | Local `./buildPlugin.ps1` → `manuscript-0.3.0-alpha+<commit>.snplg`. Install over 0.2.2 → plugin list "0.3.0-alpha", everything opens. `-Stage beta` → "0.3.0-beta" |
| S2 | `check.yml` (check + build), `ci-build.mjs` verify, TESTING.md + tests | The push itself: both jobs green. The artifact installs over the local build. The summary shows the commits with their Device test blocks |
| S3 | `beta.yml`, `next-beta` / `notes` | Off-device by tests only. The first real run when 0.3.0 is ready. A trial run now would publish `v0.3.0-beta.1` (delete release and tag afterwards), only if you want it |
| S4 | `release.ps1`, RELEASING.md, policy §8/§9 | `./scripts/release.ps1 -DryRun` on `main` after the merge: shows 0.3.0, CI green, changes nothing |
| S5 | Issue/PR templates, PRIVACY, SECURITY, CONTRIBUTING, README, GITHUB-GUIDE, CLAUDE/AGENTS | GitHub → Issues → New issue shows the two forms. Security tab offers "Report a vulnerability" |

Then merge into `main` (PR, "Create a merge commit"), and merge `main` into
`feature/mark-dialogue` and `feature/comments-images`.

**For R1 (release readiness):** besides its own list, R1 changes the font folder in PRIVACY.md,
and the "if your version has it" wording in the bug form goes once R2 is in.

## 10. Risks

- **Windows CI and `buildPlugin.ps1`:** Kept GTD's script needed fixes for CI (the Gradle daemon
  locking the cache, BOMs from PowerShell 5.1, the native-module check). Manuscript's script has
  the same origin and gets the same fixes. The first S2 run is the real test, and a red build is
  expected until it passes.
- **`gen-mark-images` on Linux:** it already runs in cloud sessions (`npm run check`). Fonts for
  the mark images come from the repo, not from the system.
- **Open branches:** `package.json` scripts, `CHANGELOG [Unreleased]` and policy text overlap with
  mark-dialogue and comments-images. These are small conflicts when `main` is merged into them;
  each one is a text merge.
