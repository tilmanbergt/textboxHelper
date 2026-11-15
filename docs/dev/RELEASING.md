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
  `Device test: none - <reason>`.

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

Commit before a build you will test seriously, so the build matches a commit. Install
`build\outputs\textboxHelper.snplg` over the existing plugin and test on a copy of a note.

## 4. Releases

Releases are made from `main`, as GitHub pre-releases while the plugin is experimental.

1. Check the release checklist in `DEVELOPMENT-POLICY.md` §8.
2. Set the version: `npm version <x.y.z> --no-git-tag-version` (updates `package.json` and
   `package-lock.json`), then in `PluginConfig.json` set `versionName` to the same version and
   raise `versionCode` by one.
3. In `CHANGELOG.md`, add `## [<x.y.z>] - <date>` under `## [Unreleased]`, so the entries move
   into the release and `[Unreleased]` stays empty.
4. Write the release notes to `build\release-notes-<x.y.z>.md` (from the CHANGELOG section,
   plus the install line) and commit:
   ```powershell
   npm run check
   git add -A
   git commit -m "Release <x.y.z>"
   ```
5. Build and copy the result under its release name:
   ```powershell
   ./buildPlugin.ps1
   Copy-Item build\outputs\textboxHelper.snplg build\textboxHelper-<x.y.z>.snplg -Force
   ```
   `build\outputs\` can also hold older `.snplg` files; always copy `textboxHelper.snplg` by name.
6. Device check (§8 of the policy): install over the previous release; the plugin list shows the
   new version.
7. Tag, push and publish:
   ```powershell
   git tag -a v<x.y.z> -m "Release <x.y.z>"
   git push
   git push origin v<x.y.z>
   gh release create v<x.y.z> build\textboxHelper-<x.y.z>.snplg --title "Textbox Helper <x.y.z>" --notes-file build\release-notes-<x.y.z>.md --prerelease
   ```
8. Open the release page: text and `.snplg` are there.
