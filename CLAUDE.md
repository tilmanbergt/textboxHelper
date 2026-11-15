# Working on Textbox Helper

Textbox Helper ("Textbox Tools" in the toolbar) is a Supernote NOTE plugin (React Native +
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
- New pure logic goes into `src/shared/` without React Native or SDK imports (`import type` is
  fine) and gets Jest tests in `__tests__/`.
- Comments say what and why, never when: no dates, no change history. New files stay ≤ 1,000
  lines.
- Living docs (`docs/dev/README.md` lists them) describe the current state only; open work goes
  to the internal backlog, the claude.ai project document `claude/next-improvements.md`, never
  into repo docs.
- User-visible change = a line under `## [Unreleased]` in `CHANGELOG.md`, in the same change.
- `npm run check` (type check, ESLint, Jest) passes with zero errors and zero warnings after
  every step. Then a device test with `./buildPlugin.ps1`.
- `main` is always releasable; larger work on `feature/<name>`, merged with `--no-ff`.
  Releases follow `docs/dev/RELEASING.md`.
- **End every change, build or release with a short, numbered, copy-paste-ready guide for
  Tilman**: what to commit (message file in `build/`, `git commit -F`), whether to build and
  what to test on the device, whether to push, whether a release is advisable.
- Code review rules: `AGENTS.md` `## Review guidelines`. Architecture: `docs/dev/design-overview.md`.
  Build and code tour: `docs/dev/README.md`.
