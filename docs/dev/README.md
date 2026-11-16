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
| `src/actions/` | The flows behind the buttons: `textboxEdits.ts` (split, join, clean, remove line breaks, Log All Textboxes), `editMarkers.ts` and `editMarkerAnalysis.ts` (handwritten delete and replace markers), `textImport.ts` (text file into textboxes), `textboxScan.ts` (scan for the DOCX export). |
| `src/domain/` | Pure logic, tested with Jest: text splitting, edit plans, marker strokes and text changes, geometry, hit testing, pagination, import parsing and planning, export classification, backup payloads, button ids and action labels, the domain types (`textboxModel.ts`). |
| `src/supernote/` | Device access: SDK calls (`noteElements.ts`, `noteTextInsertion.ts`, `markerStrokeRead.ts`, `exportNoteContext.ts`, `sdkResult.ts`), native text measurement (`textboxMetrics.ts`), button routing, permissions. If a host call fails, start here. |
| `src/storage/` | Files: backups, JSON into EXPORT, the import text file, DOCX. |
| `src/utils/` | The edit-marker diagnostics trace. |
| `src/screens/` | The views and dialogs of the plugin window. |
| `src/ui/` | Shared building blocks of the screens: `ScreenFrame`, buttons, tabs, paging (`PagedSection`, `PagedText`), `theme.ts`; the old screens still use `pluginUiStyles.ts`. |
| `__tests__/domain/` | Jest tests, one file per domain module or group. |
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
