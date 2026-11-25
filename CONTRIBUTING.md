# Contributing to Textbox Tools

Thanks for your interest! Textbox Tools is a hobby project, maintained by one person in spare
time, so response times vary.

## Reporting bugs

Open an issue with the **Bug report** form. The most helpful things to include:

- the plugin version (Settings → Apps → Plugins)
- your device model and firmware version
- exact steps to reproduce, what you expected and what happened, and the exact message shown
- a photo of the screen if the problem is about layout or recognition, and the diagnostics file
  the form asks for

Please check existing issues first, and look through any file for private text before attaching
it. Security problems go privately through the Security tab ([SECURITY.md](SECURITY.md)).

## Ideas and questions

Ideas and questions are welcome: open a **Feature request or question**. Describe the problem you want solved and how you work today, not only the
solution you have in mind.

## Code contributions

Please open an issue first and wait for a go before starting a pull request; small, obvious fixes
(typos, broken links) are fine without asking.

- Rules and checklists for every change: `docs/dev/DEVELOPMENT-POLICY.md`
- Build instructions and a tour of the code: `docs/dev/README.md`
- How the plugin is built: `docs/dev/design-overview.md`
- Git, builds and releases: `docs/dev/RELEASING.md`
- Run `npm run check` (script tests, type check, ESLint, Jest) - it must pass with zero errors and
  warnings. CI runs it on every push and pull request.
- Add a line to `CHANGELOG.md` under `[Unreleased]` for every user-visible change.
- End every commit with an effect on the device with a "Device test:" block (`RELEASING.md` §3).
- Test on a real device, on a copy of a note, and say which device in the PR.

Areas that need extra care: marker recognition (`src/actions/editMarkerAnalysis.ts`,
`src/domain/markerStrokes.ts`) and text measurement (`src/supernote/textboxMetrics.ts`,
`TextboxMetricsModule.kt`) - small changes shift behavior across all features.

By contributing you agree that your contribution is licensed under the MIT License of this
project.
