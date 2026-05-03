# GitHub Release Checklist

Use this checklist when preparing the repository for the wider Supernote community.

## Repository Basics

- choose and add a license
- confirm the repository name is the public name you want to keep
- check `.gitignore` for local-only files and large debug artifacts
- make sure README instructions match the current plugin behavior

## Documentation

- explain the main features in [README.md](C:\Users\tilma\AndroidStudioProjects\NoteDraft\textboxHelper\README.md)
- keep [docs/ARCHITECTURE.md](C:\Users\tilma\AndroidStudioProjects\NoteDraft\textboxHelper\docs\ARCHITECTURE.md) aligned with the real code structure
- keep [CONTRIBUTING.md](C:\Users\tilma\AndroidStudioProjects\NoteDraft\textboxHelper\CONTRIBUTING.md) short and actionable
- add screenshots or a short demo once the public behavior is stable

## Quality Gate

- run `npm run typecheck`
- optionally run `npm test`
- sanity-check the plugin on-device for:
  - textbox tools
  - delete markers
  - replace markers
  - straight-line geometry markers
  - page-wide marker apply

## Community Readiness

- decide how you want to receive bug reports and feature requests
- create an initial issue or discussion for known limitations
- document any experimental areas clearly in the README

## Suggested First Public Release Notes

Useful things to mention:

- textbox split/join/cleanup tools
- delete and replace edit markers
- support for typed replacement text with `#` lines
- support for straight-line geometry markers
- known limits of calibration and recognition heuristics
