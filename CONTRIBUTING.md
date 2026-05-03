# Contributing

Thanks for contributing to `Textbox Helper`.

This plugin is still evolving quickly, so the main goal of the contribution workflow is to keep behavior understandable and changes easy to review.

## Before You Change Code

- read [README.md](C:\Users\tilma\AndroidStudioProjects\NoteDraft\textboxHelper\README.md)
- skim [docs/ARCHITECTURE.md](C:\Users\tilma\AndroidStudioProjects\NoteDraft\textboxHelper\docs\ARCHITECTURE.md)
- if you are touching text measurement or hit testing, also read the shared files in [src/shared](C:\Users\tilma\AndroidStudioProjects\NoteDraft\textboxHelper\src\shared)

## Contribution Principles

- Prefer small PRs over broad refactors.
- Keep Supernote-specific assumptions explicit instead of hiding them behind generic abstractions.
- Reuse shared textbox geometry, layout, and hit-testing helpers instead of duplicating logic.
- Keep logging focused on the problem being debugged.
- Preserve preview-first behavior for user-facing destructive actions.

## Coding Guidance

- Add short module comments when creating a new major file.
- Add concise comments for non-obvious logic, especially around marker recognition, text measurement, and coordinate mapping.
- Avoid moving unrelated code in the same PR if the goal is a bug fix.
- If you introduce a new calibration or heuristic, explain why in code comments.

## Verification

Before opening a PR, run:

```sh
npm run typecheck
```

If you changed behavior that depends on device logs or page geometry, include:

- the relevant log excerpt
- the expected behavior
- the observed behavior before the fix
- the observed behavior after the fix

## Pull Requests

Good PRs for this repository usually include:

- a short problem statement
- the smallest set of files needed for the change
- notes on edge cases considered
- screenshots or log snippets when the behavior is visual or geometry-sensitive

## Areas That Need Extra Care

- [src/editMarkerActions.ts](C:\Users\tilma\AndroidStudioProjects\NoteDraft\textboxHelper\src\editMarkerActions.ts)
  Marker recognition has many heuristics. Small changes can shift behavior in non-obvious ways.
- [src/shared/supernoteTextboxLayout.ts](C:\Users\tilma\AndroidStudioProjects\NoteDraft\textboxHelper\src\shared\supernoteTextboxLayout.ts)
  Changes here affect both marker tools and textbox tools.
- [android/app/src/main/java/com/textboxhelper/TextboxMetricsModule.kt](C:\Users\tilma\AndroidStudioProjects\NoteDraft\textboxHelper\android\app\src\main\java\com\textboxhelper\TextboxMetricsModule.kt)
  Native measurement changes can affect wrapping, hit testing, and resize behavior across the whole plugin.
