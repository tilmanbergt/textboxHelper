# Baseline and working agreement (0.2.1)

Historical record: how the project was brought back into working order after a pause, using the
sister project Kept GTD (`tilmanbergt/kept-gtd`) as the model for tooling and process. Written
once; the living documents in `docs/dev/` are the current truth.

## Starting point

At 0.2.0 the plugin had no tests, no changelog, no license file, a lockfile out of step with
`package.json` (`npm ci` failed; builds had used `yarn.lock`), four type errors, one ESLint error
and 28 warnings, and documentation links with Windows paths. On current firmware, every action
that writes a backup failed with "not allowed to access other plugin's private dir".

## What was done

1. **Green baseline** (commit "Make type check, lint and clean install pass"):
   - a stray character that broke the type check removed;
   - the missing "Split Paragraphs" label added (the dialog had no title);
   - an unreachable heading branch in `supernoteNoteTextInsertion.ts` removed - no caller set
     `isHeading`, and it set the title style on the element instead of on `element.title`
     (`supernote-host-facts.md` §3);
   - the hook-dependency exception in `App.tsx` marked with its reason;
   - npm only: `package-lock.json` regenerated, `yarn.lock` removed;
   - MIT LICENSE, CHANGELOG and `npm run check` added; doc links fixed.
2. **Backup path fix** (released as 0.2.1): the backup path was joined with `\`, which on
   Android names a sibling of the plugin folder; the host refuses that as another plugin's
   private folder. `src/shared/backupPaths.ts` and the first Jest test.
3. **Formatting only**: Kept GTD's `no-void` setting and `eslint --fix`; ESLint at zero warnings.
4. **`sn-plugin-lib` 0.2.3** and `npm audit fix` (lockfile only).
5. **Working agreement**: `CLAUDE.md`, `AGENTS.md`, `docs/dev/` with `DEVELOPMENT-POLICY.md`,
   `README.md`, `design-overview.md` (from the former `docs/ARCHITECTURE.md`),
   `supernote-host-facts.md`, `RELEASING.md` (replacing `docs/GITHUB_RELEASE_CHECKLIST.md`);
   `npm run check` fails on ESLint warnings.

## Decisions

- The pluginID `wkx45auazdre2crs` stays; a new ID would install a second plugin and would not
  have fixed the private-folder error.
- Kept GTD's process is taken over in a slim form: no CI, scenario tests, coverage ratchet or
  claims register yet - they come when the plugin has the layers and tests to support them.
- Releases stay GitHub pre-releases while the plugin is experimental.

## As built

Done as described above; `npm run check` passes with zero errors and warnings and 3 Jest tests.
