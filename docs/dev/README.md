# Textbox Helper - developer notes

> **About this document.** How to build and check the plugin, a tour of the code, and the list of
> developer documents. Living document: present tense, kept true in every change that moves a
> file, adds a script or adds a document.

## Building

Requirements: Node 18 or newer, Java 17 and the Android SDK (Android Studio), Windows PowerShell.

```powershell
npm ci                 # install exactly what package-lock.json says
npm run check          # type check, ESLint, Jest
./buildPlugin.ps1      # build the plugin
```

The build bundles the JavaScript, compiles the native module with Gradle and writes
`build\outputs\textboxHelper.snplg`. `PluginConfig.json` in the repository root is used as it
is (version, pluginID, permissions). Install the `.snplg` on the Supernote by copying it to
`MyStyle/` and installing it in Settings → Apps → Plugins, over the existing plugin.

npm is the package manager; there is no `yarn.lock`.

## Checking your changes

`npm run check` runs, in this order, and stops at the first failure:

1. `tsc --noEmit` - zero errors;
2. `eslint .` - zero errors and zero warnings;
3. `jest --passWithNoTests` - every test in `__tests__/` passes.

The single steps are also available as `npm run typecheck`, `npm run lint` and `npm test`.

## Code tour

| Path | What lives there |
|---|---|
| `index.js` | Registers the toolbar buttons (lasso toolbar and NOTE toolbar) and starts routing. If a button doesn't appear where expected, start here. |
| `App.tsx` | The plugin window: asks for file permissions, routes each button press to a view, runs previews and actions, shows status and results. |
| `src/pluginRouting.ts` | Button ids and the bridge from Supernote button presses into React Native. |
| `src/permissions.ts` | Asks for FILE:READ and FILE:WRITE at start. |
| `src/textboxActions.ts` | Split (sentences, paragraphs), join, clean spaces, remove line breaks: preview, backup, apply. |
| `src/editMarkerActions.ts` | Handwritten delete and replace markers: recognition, preview, backup, apply. |
| `src/textboxImportActions.ts` | Import of a text file into textboxes (paragraphs, markdown headings, pagination). |
| `src/export/` | DOCX export: note context, textbox scan and classification, DOCX generation, the export screen. |
| `src/shared/` | The shared textbox core, mostly pure: geometry, layout and measurement, hit testing, pagination, import parsing, backup paths, note text insertion. |
| `src/ui/` | Views and dialogs of the plugin window, and their styles. |
| `__tests__/` | Jest tests. |
| `android/.../com/textboxhelper/TextboxMetricsModule.kt` | Native module: Android `StaticLayout` text measurement for textbox sizes and hit testing. |

## Documents

**Living documents** describe the current state and are kept true in every change. They contain
no history and no open work:

- `DEVELOPMENT-POLICY.md`: the rules and checklists for every change and release. **Start here.**
- `design-overview.md`: how the plugin is built, and why.
- `supernote-host-facts.md`: how the Supernote and its plugin host behave where the SDK
  documentation is silent or unclear.
- `RELEASING.md`: git, commits, builds and releases.
- this `README.md`.

In the repository root: `CLAUDE.md` (short instructions for Claude), `AGENTS.md` (code review
guidelines), `CONTRIBUTING.md`, `CHANGELOG.md`.

**Historical documents** live in `docs/dev/history/`: technical designs (`technical-design-*.md`,
requirements, design, as built) and device test records. They are written once and not updated
afterwards; if one disagrees with a living document, the living document is right.

Open work - ideas, bugs, technical debt - is not kept in the repository but in the internal
backlog (the claude.ai project document `claude/next-improvements.md`).
