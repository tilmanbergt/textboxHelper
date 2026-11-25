# Git, build and release workflow

> **About this document.** The current git, build and release workflow, step by step. Present
> tense, no history. Update it in the same change that alters a script, a branch rule or a
> release step. What a change must contain is in `DEVELOPMENT-POLICY.md`.

All commands are PowerShell, run in the repository root. Commits only ever carry the public
noreply address; the repository is public.

## 1. Branches

- **`main` is always releasable.** Everything on `main` builds, passes `npm run check` and has
  been tried on the device.
- **Small changes** - a bug fix, a doc change, a one-session change - are committed directly on
  `main`.
- **Features and anything risky or spanning several sessions** get a branch
  `feature/<short-name>`, merged back with `--no-ff` once the Definition of Done is met:

```powershell
git switch main
git pull
git switch -c feature/<short-name>
# ... work, commit ...
git switch main
git merge --no-ff feature/<short-name> -m "Merge feature/<short-name>: <what it adds>"
git push
git branch -d feature/<short-name>
```

## 2. Commits

- **One logical change per commit**: code, its tests, its docs and its CHANGELOG line together.
  Formatting-only changes get their own commit.
- **Message**: short imperative subject (max ~70 characters), an empty line, then details.
- **"Device test:" block** at the end of the message for every commit with an effect on the
  device: numbered steps, expected results after `->`. Nothing to test:
  `Device test: none - <reason>`. The CI build collects these blocks into its `TESTING.md`
  (§3); a commit without one is flagged there.

  ```
  Fix backup path blocked as another plugin's private dir

  The backup path was joined with "\" ...

  Device test:
  1. Lasso one textbox with two paragraphs, tap Split Paragraphs, then OK.
     -> No error; one textbox per paragraph.
  ```

- A message with a body is committed from a file: `git commit -F build\<file>.txt` (`build/` is
  ignored by git).
- **Never commit**: `build/`, `*.snplg`, `node_modules/`, logs, personal notes or data. Look at
  `git status --short` before every commit.

## 3. Test builds

```powershell
npm run check
./buildPlugin.ps1
```

Builds are labelled for the release being worked on (`nextVersion` in `package.json`):
`0.3.0-alpha+a1b2c3d`, or `0.3.0-beta+a1b2c3d` with `./buildPlugin.ps1 -Stage beta`; `.dirty` at
the end means uncommitted changes. Set the next version once per release with
`npm run next-version -- <x.y.z>` and commit it. Commit before a build you will test seriously,
so the label names the commit. Install `build\outputs\manuscript-<label>.snplg` over the existing
plugin and test on a copy of a note; the plugin list shows `0.3.0-alpha`.

### Test builds from GitHub

Every push to any branch is checked and built on GitHub (`.github/workflows/check.yml`): job
`check` runs `npm run check`, job `build` then builds the plugin on Windows like a local build
(same label, same signing key, so the two install over each other) and keeps it for 30 days:

1. GitHub → **Actions** → the run of the push (branch and commit message are shown).
2. The run's summary page shows **"Manuscript <label> - what to test"**: the commits since `main`
   (on `main`: since the last release) with their "Device test:" blocks, newest first, those of
   the newest push marked **NEW** and commits without a block flagged ⚠; then the lines added to
   CHANGELOG `[Unreleased]`.
3. At the bottom under **Artifacts**: `manuscript-<label>` - download, unzip. It holds the
   `.snplg` and the same notes as `TESTING.md`.
4. Install the `.snplg` over the existing plugin, as above.

A newer push to the same branch cancels a build that is still running. `npm run test-notes`
writes the same notes to `build\TESTING.md` for a local build.

### Betas

A beta is a test version of the release being worked on (`nextVersion`) that anyone can install.
Make one when that release is feature-complete on `main`, before the release itself:

1. `CHANGELOG.md` `[Unreleased]` reads well for testers (it becomes the beta's text) and is pushed.
2. GitHub → **Actions** → **beta** → **Run workflow**, branch `main` → **Run workflow**
   (works from the phone too).
3. About 20 minutes later the Releases page has the **pre-release** "Manuscript 0.3.0 beta 1"
   (tag `v0.3.0-beta.1`) with the `.snplg`, labelled `0.3.0-beta+a1b2c3d`, and `TESTING.md` since
   the last release. The next run makes beta 2.

The workflow refuses to run on another branch, without a `nextVersion` above the current version,
with an empty `[Unreleased]`, or when the build has uncommitted changes. Pre-releases never become
the "Latest" release. They stay on the Releases page after the release; delete one there (and its
tag) if it was a mistake.

## 4. Releases

Releases are made from `main`. A release is a normal GitHub release; add `--prerelease` to mark one as experimental.

1. Check the release checklist in `DEVELOPMENT-POLICY.md` §8.
2. Set the version: `node scripts/version.mjs --set-version <x.y.z>` (`package.json`,
   `package-lock.json`, `PluginConfig.json` `versionName`; the build writes the versionCode).
3. In `CHANGELOG.md`, add `## [<x.y.z>] - <date>` under `## [Unreleased]`, so the entries move
   into the release and `[Unreleased]` stays empty
   (`node scripts/version.mjs --stamp-changelog <x.y.z> <YYYY-MM-DD>`).
4. Write the release notes to `build\release-notes-<x.y.z>.md` (from the CHANGELOG section,
   plus the install line) and commit:
   ```powershell
   npm run check
   git add -A
   git commit -m "Release <x.y.z>"
   ```
5. Tag, then build. The build of the tagged, clean release commit is labelled `<x.y.z>`:
   ```powershell
   git tag -a v<x.y.z> -m "Release <x.y.z>"
   ./buildPlugin.ps1
   ```
   The result is `build\outputs\manuscript-<x.y.z>.snplg`.
6. Device check (§8 of the policy): install over the previous release; the plugin list shows the
   new version.
7. Push and publish:
   ```powershell
   git push
   git push origin v<x.y.z>
   gh release create v<x.y.z> build\outputs\manuscript-<x.y.z>.snplg --title "Manuscript <x.y.z>" --notes-file build\release-notes-<x.y.z>.md
   ```
8. Open the release page: text and `.snplg` are there.
