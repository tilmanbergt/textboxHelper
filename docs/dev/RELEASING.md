# Git, build and release workflow

> **About this document.** The current git, build and release workflow, step by step. Present
> tense, no history. Update it in the same change that alters a script, a workflow, a branch rule
> or a release step. What a change must contain is in `DEVELOPMENT-POLICY.md`; which GitHub flow
> to use when is in `GITHUB-GUIDE.md`. Design: `history/technical-design-release-scaffolding.md`.

All commands are PowerShell, run in the repository root.

## 1. One-time setup

```powershell
winget install GitHub.cli        # then open a new PowerShell window
gh auth login                    # GitHub.com, HTTPS, log in with the browser
git config user.email "50413979+tilmanbergt@users.noreply.github.com"   # repo-local, public address
git config user.name "Tilman Bergt"
```

Commits only ever carry a noreply address - the repository is public. `release.ps1` needs `gh`
to look up CI and to publish; without it, it asks and prints the manual steps.

## 2. Branches

- **`main` is always releasable.** Everything on `main` builds, passes `npm run check` and has
  been tried on the device. Releases are only made from `main` (`release.ps1` refuses anything
  else).
- **Small changes** - a bug fix, a doc change, a one-session change - are committed directly on
  `main`.
- **Features and anything risky or spanning several sessions** get a branch
  `feature/<short-name>` (or `fix/<issue-number>-<short-name>`). A cloud session creates its own
  branch and pushes to it; CI checks and builds every push (§4).
- No long-lived branches besides `main`. Merge or delete a branch within days.

Start a branch locally:

```powershell
git switch main
git pull
git switch -c feature/<short-name>
```

Finish it once the Definition of Done (`DEVELOPMENT-POLICY.md` §7) is met: on GitHub with the
pull request's **Merge pull request** → **Create a merge commit** (`GITHUB-GUIDE.md`), or locally:

```powershell
git switch main
git pull
git merge --no-ff feature/<short-name> -m "Merge feature/<short-name>: <what it adds>"
git push                                      # CI on main checks and builds it: that is the gate
git branch -d feature/<short-name>
git push origin --delete feature/<short-name> # only if the branch was pushed
```

Never squash or rebase a branch into `main`: that loses the "Device test:" blocks of its commits.
If CI turns red on `main`, fix it before anything else - a red `main` can't be released (§5).

## 3. Commits

- **One logical change per commit**: code, its tests, its docs and its CHANGELOG line together.
  Formatting-only changes get their own commit.
- **Message**: short imperative subject (max ~70 characters), an empty line, then details.
  Reference issues with `Fixes #12` - GitHub closes the issue when it reaches `main`.
- **"Device test:" block** at the end of the message for every commit with an effect on the
  device: from the line `Device test:` to the end (trailers like `Co-Authored-By:` after it are
  fine), numbered steps, expected results after `->`. Nothing to test:
  `Device test: none - <reason>`. The CI build collects these blocks into its `TESTING.md` (§4);
  a commit without one is flagged there.

  ```
  Fix backup path blocked as another plugin's private dir

  The backup path was joined with "\" ...

  Device test:
  1. Lasso one textbox with two paragraphs, tap Split Paragraphs, then OK.
     -> No error; one textbox per paragraph.
  ```

- A message with a body is committed from a file: `git commit -F build\<file>.txt` (`build/` is
  ignored by git).
- **Never commit**: `build/`, `src/generated/`, `*.snplg`, `node_modules/`, logs, report or
  diagnostics files, personal notes or data. Look at `git status --short` before every commit.

## 4. Checks and test builds

```powershell
npm run check                    # build info, help pictures, script tests, tsc, ESLint, Jest
./buildPlugin.ps1                # test build, labelled for the release being worked on
./buildPlugin.ps1 -Stage beta    # the same, once that release is feature-complete
npm run test-notes               # build\TESTING.md: what this branch contains and how to test it
```

- **The release being worked on** is `nextVersion` in `package.json`. Set it when work on the next
  release starts (right after a release, §7): `npm run next-version -- 0.4.0`, commit
  "Set next version 0.4.0" with `Device test: none - version only`, push.
- **Labels** say which release a build belongs to: `0.3.0-alpha+a1b2c3d` while the release is
  being built, `0.3.0-beta+a1b2c3d` for the final device test, `0.3.0` for the release itself (the
  tagged, clean release commit). `.dirty` at the end means the build contains uncommitted changes.
  Without a `nextVersion` above the current version a build is labelled `0.2.2+dev.a1b2c3d` and
  the build prints a reminder.
- The build stamps version, stage and commit into the app (`src/generated/buildInfo.ts`), bundles,
  compiles the native module and writes `build\outputs\manuscript.snplg` plus a copy named after
  the label, e.g. `manuscript-0.3.0-alpha+a1b2c3d.snplg`. The Supernote's plugin list shows
  `0.3.0-alpha`.
- **Commit before building** a build you will test seriously: then the label names the exact
  commit.
- Install the `.snplg` on the Supernote **over** the existing plugin and test on a copy of a note.

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

A newer push to the same branch cancels a build that is still running. A local build is only
needed for something not pushed yet. `release.ps1` waits for the whole run, the build included:
a failing build stops a release like a failing check.

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

## 5. Releases

### When

- **Patch** (`0.3.0 → 0.3.1`): only fixes. Release soon after a fix users are waiting for.
- **Minor** (`0.3.x → 0.4.0`): new features or changed behavior. Release when a set of features is
  done and tested - no fixed schedule.
- Not every merge needs a release. Releases are moments when `[Unreleased]` tells a coherent
  story.

### Steps

1. **Prepare** - on `main`, clean tree, everything pushed, CI green for that commit:
   ```powershell
   git switch main
   git pull
   git status --short           # must be empty
   ```
2. **Check** the release checklist in `DEVELOPMENT-POLICY.md` §8.
3. **Dry run** - shows the new version and what would happen, changes nothing (it checks CI on
   `main` and runs `npm run check`):
   ```powershell
   ./scripts/release.ps1 -DryRun                 # releases nextVersion from package.json
   ./scripts/release.ps1 -Bump patch -DryRun     # a hotfix without a nextVersion
   ```
4. **Release**:
   ```powershell
   ./scripts/release.ps1                         # or -Bump patch for a hotfix
   ```
   `-Bump` must agree with `nextVersion` when one is set; `-Version x.y.z` overrides both;
   `-Prerelease` publishes it as a GitHub pre-release. The script checks that CI (checks and
   build) is green on `main` for this commit, sets the version in `package.json`,
   `package-lock.json` and `PluginConfig.json`, turns `[Unreleased]` into `[x.y.z] - date` in the
   CHANGELOG and runs `npm run check` on exactly what it is about to commit. If anything is red it
   **stops** and prints how to undo the version changes. It commits `Release x.y.z`, tags
   `vx.y.z` and builds `build\outputs\manuscript-x.y.z.snplg`. Then it **pauses**. The tag starts
   no CI run; the release commit is checked by CI when it is pushed to `main`.
5. **Device check** while the script waits (§6), then answer `y` to publish. The script pushes
   `main` with the tag and creates the GitHub release with the `.snplg` and the CHANGELOG section
   as text.
   - Answer `N` if anything is wrong: the commit and tag exist only locally, and the script
     prints the two commands to undo them. Fix, commit, start again at step 1.
6. **After publishing** (§7).

### Hotfix

Because `main` holds no unfinished work (§2), a hotfix is a fix on `main` (with its CHANGELOG line
under Fixed) followed by `./scripts/release.ps1 -Bump patch`.

## 6. Device check before publishing

- [ ] Install `build\outputs\manuscript-x.y.z.snplg` **over the previous release** (not a clean
      install).
- [ ] The plugin list shows `x.y.z` (no `-alpha`, `-beta` or `+dev`).
- [ ] Every toolbar entry opens: Manuscript in the NOTE toolbar; the lasso toolbar entries.
- [ ] Settings are still there; a note with textboxes opens in Manuscript (Review, Outline, Files).
- [ ] What this release changed works (the CHANGELOG section is the checklist).

## 7. After a release

- Check the release page on GitHub: text and `manuscript-x.y.z.snplg` attached.
- Set the next release so test builds carry its name: `npm run next-version -- x.y.z`, commit
  "Set next version x.y.z" (`Device test: none - version only`), push.
- The next work starts with an empty `## [Unreleased]` section - the script leaves it ready.
- Triage new issues: `needs-info` (version or report missing), `confirmed` (reproduced). Fixes
  reference the issue (`Fixes #12`).
