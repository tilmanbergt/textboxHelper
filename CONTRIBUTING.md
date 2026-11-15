# Contributing to Textbox Helper

Thanks for your interest! Textbox Helper is a hobby project, maintained by one person in spare
time, so response times vary.

## Reporting bugs

Open an issue with:

- the Textbox Helper version (Settings → Apps → Plugins)
- your device model and firmware version
- exact steps to reproduce, what you expected and what happened, and the exact message shown
- a screenshot if the problem is about layout or recognition

## Ideas

Ideas are welcome. Describe the problem you want solved and how you work today, not only the
solution you have in mind.

## Code contributions

Please open an issue first and wait for a go before starting a pull request; small, obvious fixes
(typos, broken links) are fine without asking.

- Rules and checklists for every change: `docs/dev/DEVELOPMENT-POLICY.md`
- Build instructions and a tour of the code: `docs/dev/README.md`
- How the plugin is built: `docs/dev/design-overview.md`
- Run `npm run check` (type check, ESLint, Jest) - it must pass with zero errors and warnings.
- Add a line to `CHANGELOG.md` under `[Unreleased]` for every user-visible change.
- Test on a real device, on a copy of a note, and say which device in the PR.

Areas that need extra care: marker recognition (`src/editMarkerActions.ts`) and text measurement (`src/shared/supernoteTextboxLayout.ts`,
`TextboxMetricsModule.kt`) - small changes shift behavior across all features.

By contributing you agree that your contribution is licensed under the MIT License of this
project.
