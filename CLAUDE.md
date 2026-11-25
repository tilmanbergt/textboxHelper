# Working on Manuscript

Manuscript (formerly Textbox Tools; the lasso panel keeps that name) is a Supernote NOTE plugin (React Native +
`sn-plugin-lib`, one native Kotlin module) for editing textboxes inside notes: split, join,
clean up, handwritten edit markers, text import and DOCX export. Its identity never changes:
pluginID `wkx45auazdre2crs`, pluginKey `textboxHelper`. A new pluginID would install as a
second plugin next to the old one.

**Before any change, read and follow `docs/dev/DEVELOPMENT-POLICY.md`.** Every feature, bugfix
and release ends with its checklists (§7 for changes, §8 for releases).

Short version:

- Features: clarify requirements, then a technical design in `docs/dev/history/`, then implement.
  Bugs: exact failure, then root cause, then a test that fails for it, then the fix.
- The user's text is never lost: every action that changes a note shows a preview first and
  writes a backup before it touches the page.
- Paths on the device are joined with `/` only (`docs/dev/supernote-host-facts.md`).
- Code lives in layers (`domain/`, `utils/`, `supernote/`, `storage/`, `actions/`, `ui/`,
  `screens/`); ESLint enforces the imports. New pure logic goes into `src/domain/` without React
  Native or SDK imports and gets Jest tests in `__tests__/domain/`.
- Comments say what and why, never when: no dates, no change history. New files stay ≤ 1,000
  lines.
- Living docs (`docs/dev/README.md` lists them) describe the current state only; open work goes
  to the internal backlog, the claude.ai project document `claude/next-improvements.md`, never
  into repo docs.
- User-visible change = a line under `## [Unreleased]` in `CHANGELOG.md`, in the same change.
- `npm run check` (build info, script tests, type check, ESLint, Jest) passes with zero errors
  and zero warnings after every step. CI runs it again on every push and builds the `.snplg`;
  that build (or `./buildPlugin.ps1`) is what gets device-tested.
- `main` is always releasable; larger work on `feature/<name>`, merged with `--no-ff` (a merge
  commit, never squash). A cloud session pushes its own feature branch. Releases only via
  `scripts/release.ps1` from `main`, betas via Actions → beta (`docs/dev/RELEASING.md`,
  `docs/dev/GITHUB-GUIDE.md`).
- Every commit with an effect on the device ends with a "Device test:" block; CI collects them
  into the build's `TESTING.md`.
- **End every change, build or release with a short, numbered, copy-paste-ready guide for
  Tilman**: where the build is (CI run or local build) and what to test on the device, whether
  the branch is ready to merge, whether a release is advisable (`DEVELOPMENT-POLICY.md` §9).
- Code review rules: `AGENTS.md` `## Review guidelines`. Architecture: `docs/dev/design-overview.md`.
  Build and code tour: `docs/dev/README.md`.
