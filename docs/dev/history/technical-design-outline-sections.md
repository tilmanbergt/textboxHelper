# Technical design: Outline with sections (three panes, heading levels)

Status: **built 2026-11-21 (O1–O5, As built below); device checks open.** Requirements: `claude/ideas-outline-sections.md` (all decisions there, D1–D4 accepted 2026-11-21). Mockup: design canvas "Textbox Tools – Outline with sections" (https://claude.ai/artifact/NgS1TaW8G2pFgndxez3Dp5). **Base: `feature/linked-files` at `d256bc3`** (L1–L4 and cross-file moves); the work continues on that branch. Sizes from Kept GTD's `docs/dev/design-device-rendering.md`.

Goals for the code, in order: **reuse** what the Manuscript and linked-files work built (plan, layout, apply, title sync, paged lists, frame); **one source of truth** for structure (a pure model the screen only renders); **delete** what the old Outline needs and the new one doesn't; every file well under 1,000 lines, `OutlineTab.tsx` (601 today) becomes a thin frame.

## 0. What is there (on the branch)

- `domain/outlineModel.ts` — `buildOutline(items, statuses, pages)` → `OutlineBlock[]` in reading order; `heading: boolean` from the export's style rules (`classifyTextRole`), `fileSource` for a divider; filters `all | pending | status`.
- `domain/outlinePlan.ts` — `PlannedChange` (move before a key / end, aside, delete), `plannedOrder`, `sectionOf` by rank (file 0, heading 1), `canMoveBefore`, `canRemove`, undo, `plannedSummary`.
- `domain/outlineLayout.ts` + `actions/outlineApply.ts` — `checkRebuild` (blockers: edits, unread, handwriting, foreign titles), `applyOutlinePlan` (backup, move/insert/delete, `syncFileTitles`, save).
- `domain/fileTitles.ts` + `actions/fileTitles.ts` + `supernote/noteTitles.ts` — titles over dividers, tag `k:'t'`, matched by rectangle; style `import.fileTitleStyle`.
- `domain/sourceBlocks.ts` — a heading block's `text` is **without** `#`s, `level` 1–6; `sourceExport.ts` writes an edited heading as `#`.repeat(level) + text.
- `screens/manuscript/OutlineTab.tsx` (601), `useOutline.ts` (325); `ui/PagedSection`, `PagedText`, `ScreenFrame`, `ChipRow`, `Segmented`, `PillButton`, `theme`.

## 1. Model

### 1.1 Heading text — `domain/headingText.ts` (new, pure)

The one place that knows the `#` syntax.

```ts
export type HeadingLevel = 1 | 2 | 3;
/** Level from the text's leading #s: 0 = no heading. "#### x" and deeper count as 3 (text unchanged). */
export function headingLevelOf(text: string): 0 | HeadingLevel;
/** The text without its leading #s and the space after them. */
export function headingTitleOf(text: string): string;
/** The text with `level` #s (0 removes them); keeps the title as it is. */
export function withHeadingLevel(text: string, level: 0 | HeadingLevel): string;
```

Rule as in Obsidian: one to six `#` then a space or tab; `#tag` is not a heading.

### 1.2 Blocks — `domain/outlineModel.ts` (changed)

`OutlineBlock` drops `heading: boolean` for:

```ts
kind: 'file' | 'heading' | 'paragraph';
/** file 0, heading 1–3, paragraph null. */
level: number | null;
fileSource: string | null;   // kept for the file's source id
```

Level of a textbox, first match wins (D2):
1. a divider tag (`k:'f'`) → `file`, 0;
2. `headingLevelOf(text)` > 0;
3. **legacy:** a tagged block whose source record says heading (notes linked before this change) → the record's level (capped at 3); `buildOutline` gets `headingLevels: Map<tagId, number>` from the records the card already reads;
4. covered by a NOTE title (ours or the user's) → `settings.outline.defaultHeadingLevel`;
5. else paragraph.

The style rules are no longer used here. `ScannedTextBox` gains `underTitle: boolean` (`textboxScan.ts` computes `isInsideTitleRect` already).

`rank(block)` moves here from `outlinePlan.ts`: file 0, heading = level, paragraph `Infinity`. Filters change to `OutlineFilter = 'all' | 'edits' | 'notFinal'`; `filterCounts` goes (the screen shows no counts per filter).

### 1.3 Contents — `domain/outlineContents.ts` (new, pure)

Everything both columns show is derived here, so the screen has no structure logic.

```ts
type ContentsEntry = {
  key: string;                       // the heading's/divider's block key; 'start' / 'orphans' for the pseudo entries
  kind: 'file' | 'heading' | 'start' | 'orphans';
  depth: number;                     // indentation: file 0, # 1, ## 2, ### 3 (without files: # 0 …)
  title: string;                     // headingTitleOf(text) / file name
  own: string[];                     // keys of its own paragraphs (up to its first child heading)
  children: string[];                // child entry keys
  section: string[];                 // all block keys of its section (sectionOf)
  pendingOwn: number; pendingAll: number;
};
type Contents = {entries: ContentsEntry[]; byKey: Map<string, ContentsEntry>; flat: boolean};

export function buildContents(order: OutlineBlock[]): Contents;
```

- **Start:** paragraphs before the first heading of a note without files → entry `start` (title "Start").
- **Orphans (D4):** textboxes before the first divider of a linked note → entry `orphans` (title "Not in a file", grey).
- A file's own text is its start text.
- `flat` when there are no headings and no files: the screen shows one pane.

Views, also pure:

```ts
/** Contents rows for the filter: dim = no matches in its section; folded = child entries hidden, with their count. */
export function contentsRows(contents, blocks, filter): {entry, dim: boolean, folded: number}[];
/** The open entry's paragraphs for the filter, and how many are hidden. */
export function ownRows(entry, blocks, filter): {rows: OutlineBlock[]; hidden: number};
/** What follows an entry's own text: "## The cost of fluency (3 ¶)". */
export function followingHint(contents, entry): string | null;
/** The entry to open first: the first with edits waiting, else the first. */
export function initialEntry(contents): string | null;
```

Filter rule: `edits` = `pendingEdits > 0`, `notFinal` = status ≠ final. A child entry is folded when neither it nor anything below it matches; an entry is dim when nothing in its section matches.

## 2. Plan — `domain/outlinePlan.ts` (extended)

`PlannedChange` gains a level change; the existing kinds stay:

```ts
| {kind: 'level'; key: string; level: 0 | HeadingLevel; withSubheadings: boolean}
```

- **`plannedOrder`** applies level changes first (a copy of each changed block with its new `level`/`kind`; with `withSubheadings`, every heading in its section shifts by the same delta, capped 1–3, and is marked too), then moves, aside, delete as today. `PlannedOrder` gains `levels: Map<key, {from, to}>`; `ChangeMark` gains `'level'`. The Contents column renders `buildContents(planned.order)`, so it shows the planned structure for free.
- **Aside / delete of a heading** take its whole section (`sectionOf`); of a divider stay refused (`canRemove`).
- **Who can move:** `canMove(block)` = paragraph or file (D1). Headings never move.
- **Move targets** (pure helpers; each returns a `MoveTarget` or null when it changes nothing, so the UI disables the button):
  - `stepUp`, `stepDown`, `toTop`, `toEnd` — within the entry's `own` (paragraph) or among sibling files (file);
  - `toEntryEnd(contents, entryKey)` — Move to…: before the entry's first child heading, else before the next section start, else `'end'`.

  All of them produce today's `{kind:'move', before}` change, so `plannedOrder`, the layout and the apply stay as they are.
- `plannedSummary` reads "1 heading level (with 2 subheadings) · 1 paragraph moved · 1 section set aside"; the page list moves to the check line ("pages 2–5 and 7–8 rebuilt").
- `canMoveBefore` stays (used by the helpers); `undoFor` / `undoLast` unchanged.

**Blocked by pending edits** (unchanged rule, now also for levels): a block with edits waiting can't be moved, levelled, set aside or deleted; a section can't be set aside or deleted while any block in it has edits. One function `blockedBy(block | section)` returns the edits count for the panel's "Review its n edits ›".

## 3. Apply — `actions/outlineApply.ts` (extended)

- **Level changes** are text changes in place: per page, `modifyPageElements` with `withHeadingLevel(text, to)` and the reading-aid style for the new level (`textboxStyle` with the import's `heading1–3` / paragraph style — the same table the import uses). The textbox keeps its number and tag.
- **Height:** a new style can make the textbox taller. Its new height comes from the existing text measurement (`supernote/textboxMetrics`); if it grows, its page joins the rebuild range and `layoutRebuild` places the rest (it already keeps gaps and stops at the first unchanged page). If nothing grows, a levels-only plan touches no layout. So **`checkRebuild` treats a level change like a move of that block** for the range; the blockers stay.
- Order inside one apply: backup (the payload already holds the pages' textboxes) → level changes → moves/aside/delete → **title sync** on all touched pages → save. One save, as today.

## 4. Titles — one sync for files and headings (D3)

`domain/fileTitles.ts` → **`domain/noteTitlesPlan.ts`**, `actions/fileTitles.ts` → **`actions/titleSync.ts`** (`syncTitles(notePath, pages)`; callers of `syncFileTitles` switch, the old name goes in the same step).

- **Wanted titles:** every divider (as today), and every heading whose level is in `settings.outline.titleLevels` (default `[1, 2]`).
- **Ours:** tag `k:'t'`; with `s` for a file title (as today), with `h: level` for a heading title (`BlockTag` gains optional `h`). Matched by rectangle as today; a title of ours that covers no wanted textbox any more is removed (a heading turned into a paragraph, a `###` when level 3 isn't titled).
- **Not ours** (no `k:'t'`): never touched; it makes the textbox a heading of the default level (§1.2).
- **Style:** `import.fileTitleStyle` for files; `outline.titleStyles[level]` for headings (default 1 / 2 / 3; P2 decides whether they differ usefully).
- Restore titles (Details) calls the same `syncTitles` on every page.

## 5. Import and export (D2)

- **`sourceBlocks.ts`:** a heading block's `text` keeps its `#`s (`## Methods`), exactly as the line; `level` stays for the summary. The source link's "untouched = byte-identical" then holds with no special case, and **`sourceExport.ts` writes every edited block's text as it is** (the `#`.repeat(level) branch goes). A paragraph that gained `#`s is written with them; a heading whose `#`s were struck is written as a paragraph — the file follows the note.
- **Legacy records** (headings stored without `#`s): an untouched textbox still equals its record's text → original span, byte for byte; an edited one without `#`s gets the record's level prefixed once (one branch in `sourceExport.ts`, marked legacy). No migration.
- **Plain import** (not linked) writes the `#`s too, so every note follows the same rule. Reading-aid styles `heading1–3` unchanged; levels 4–6 get `heading3`'s style.
- **DOCX export:** `classifyTextRole` checks `headingLevelOf(text)` first (heading, `#`s stripped from the written text, Word heading level = the level); the style rules stay as the fallback for older notes.
- **Cross-file moves:** "a heading with its #s" (as built) now simply means its text.

## 6. Files move (D1)

A file entry's panel action bar: **↑ Up · ↓ Down · Move before… ›** (the Contents column shows → on file entries only). `stepUp`/`stepDown` among files; Move before… = `{kind:'move', key: divider, before: otherDivider}`. `sectionOf` by rank already moves the whole file; `syncTitles` and the `index.txt` write follow. The "Add n" message in Details changes to "… move them with ↑ ↓ in the Outline".

## 7. Screen

### 7.1 Files (`screens/manuscript/outline/`, new folder)

| File | Role | Reuses |
|---|---|---|
| `OutlineTab.tsx` | frame: Show line, two columns or one, planned line, panel; ~150 lines | `ScreenFrame` body |
| `useOutline.ts` (moved, slimmed) | read, statuses, plan, check, apply — as today, plus level changes | everything in it now |
| `useOutlineView.ts` (new) | open entry, panel subject (last tapped), filter, move mode; `useMemo` over `buildContents` / `contentsRows` / `ownRows` | pure §1.3 |
| `ContentsColumn.tsx` | `PagedSection` of `ContentsRow` (40 dp): indent by depth, open = black fill, ✎ n, "was #"/"set aside" marks, ▸ n when folded, → in move mode | `PagedSection` |
| `ParagraphList.tsx` | `PagedSection` of `ParagraphRow` (64 dp two lines / 42 dp one), "Then: …" hint, "n hidden" | `PagedSection`, `firstLine`/`lastLine` |
| `DetailsPanel.tsx` | info line + Go to page ›, `LevelStatusLine`, text (`PagedText`), `ActionBar`; heading/file/paragraph variants | `PagedText` |
| `LevelChoice.tsx` | the two cards (with / only this heading) with their previews | pure preview from `plannedOrder` |

### 7.2 Shared UI (`ui/`, new, small, used beyond the Outline later)

- **`TextChoices.tsx`** — a row of text options, the selected one bold + 2 dp underline, dots between; 40 dp tap height. Used for Show, Level, Status. Replaces `Segmented` in the Outline; `Segmented` stays where it is used elsewhere.
- **`ActionBar.tsx`** — thin rule above, borderless word buttons (48 dp), separators, a trailing ⋯ that opens a one-row menu for rare actions (Delete). A disabled action shows greyed with its reason in the status line, not hidden.
- **`TextLink.tsx`** — underlined text button ("Go to page 2 ›", "Undo last", "Cancel").
- **`ui/glyphs.ts`** — `UP '↑'`, `DOWN '↓'`, `TOP '⤒'`, `END '⤓'`, `TO '→'`, `FOLDED '▸'`, `EDITS '✎'`, status glyphs: one place to swap if the device font lacks one (device check).

Row heights and text follow the rendering doc: fixed heights passed as `height`, `numberOfLines`, `includeFontPadding: false`.

### 7.3 Removed

The six filter chips, `FILTER_LABELS`, `filterCounts`, `rowHeight`, `EndTarget`, `MoveTargetButton` (← on rows), the always-on move mode, the status `Segmented` in the panel, "Read again" in the tab (moves to Details). `ChipRow` stays (the Review tab uses it).

## 8. Settings (`storage/settingsFile.ts`, `domain/settingsModel.ts`)

```ts
outline: {
  defaultHeadingLevel: HeadingLevel;        // 1
  titleLevels: HeadingLevel[];              // [1, 2]
  titleStyles: Record<HeadingLevel, number>; // {1: 1, 2: 2, 3: 3}
}
```

Shown in Manuscript → Details → **Headings** (three lines in the light style). Reading-aid styles stay the import's.

## 9. Steps (each: `npm run check` green, own commit, docs and deletions in the same commit)

1. **O1 Pure model:** `headingText`, `outlineModel` kinds/levels (+ legacy levels, `underTitle`), `outlineContents`, plan extensions (level, section aside/delete, move helpers, file moves, `blockedBy`). The old tab keeps working on `kind === 'heading'`. No device.
2. **O2 Import/export with `#`s:** `sourceBlocks`, `sourceExport` (+ legacy branch), plain import, DOCX. **Device stop 1:** import a file with three levels → `#`s on the page; round trip byte-identical; an old linked note still writes correctly; DOCX headings.
3. **O3 Levels and titles:** apply of level changes (text, style, height → rebuild range), `titleSync` for files and headings, settings + Details → Headings. **Device stop 2:** level change with/without subheadings, table of contents after it (P2), a user's own title left alone.
4. **O4 Three panes:** the new screen files, shared UI, removals. **Device stop 3:** A5 X with a 3-file note and a flat note; glyphs; panel heights (420/300); paging both columns; Move to… across files with the write's question; file ↑ ↓ and `index.txt`.
5. **O5 Docs:** design overview (Outline section), host facts (glyphs, title styles), user help for the Outline, CHANGELOG; requirements' open points closed; this design copied to `docs/dev/history/` with As built.

## 10. Tests (Jest)

- `headingText`: levels 0–6, `#tag`, tabs, `withHeadingLevel` both ways, title kept byte for byte.
- `outlineModel`: level precedence (divider, `#`s, legacy record, title, default), kinds.
- `outlineContents`: own/children/section, Start, orphans, flat, filter rows (dim, folded counts), `ownRows` hidden count, `followingHint`, `initialEntry`.
- `outlinePlan`: level change alone and with subheadings (caps), planned contents after it; section aside/delete; headings can't move; move helpers at the edges (null), Move to… lands before the first child heading; file moves; `blockedBy`.
- `noteTitlesPlan`: files + heading levels, a level dropped from `titleLevels`, user titles untouched, our heading title left over after a level change removed.
- `sourceExport`: untouched heading byte-identical with `#`s in the text; edited heading; struck `#`s → paragraph; legacy heading without `#`s.
- DOCX classification by `#`s before style.

## 11. Open points and device checks

- **P1** Device font: ⤒ ⤓ → ▸ (✎ ○ ◐ ● work today). Fallback in `ui/glyphs.ts`: words only ("Top", "End") and ›.
- **P2** NOTE table of contents: do title styles 1–4 show any hierarchy? Decides `titleStyles` defaults (linked-files P6).
- **P3** Height measurement for a restyled heading on the device (§3); if unreliable, a level change always rebuilds from its page.
- **P4** Contents width on a Nomad: a third of the width (not 330 dp); Simulate-screen check as in Kept.
- **P5** Panel height: fixed 420 dp, 300 dp while the planned line shows — keep if it reads well on the device.
- **P6** Levels 4–6 from Obsidian show as `###` entries; if that confuses, a later setting can treat them as paragraphs.

## As built

All five steps in one pass on `feature/linked-files`, one commit each. 409 Jest tests (383 before).

- **O1 model.** `domain/headingText.ts` as designed: one to six `#` then a space or tab; deeper than
  `###` counts as 3, the text unchanged. `OutlineBlock` has `kind`, `level`, `fileSource` and
  `aside` (its tag's `a`). `buildOutline` takes `OutlineOptions` (`defaultLevel`, `recordLevel`).
  `rank` lives in `outlineModel.ts`. The move helpers live in `outlineContents.ts`, not in the plan,
  since they need the Contents: `stepMoves` (paragraph within its entry's own paragraphs, file among
  files), `moveToEntry`, `moveFileBefore`; all return a "move before" target or null. A pseudo
  entry **Set aside** gathers blocks set aside earlier (proposed open point, built). Removing a
  heading with its subheadings lifts them by one level.
- **O2 `#`s.** As designed. The DOCX level comes from the scan (`textboxScan.ts` marks a text with
  `#`s as a heading whatever its style, and keeps `headingLevel` and `underTitle`); there is no
  separate pure test for DOCX, `headingText` covers the rule.
- **O3 levels and titles.** `outlineApply.ts` `levelEdits` measures the new text with the textbox's
  own font (`estimateTextboxHeight`); a heading taller by more than 4 px passes its new height to
  `layoutRebuild(…, heights)`, which counts it as changed there. Pages where only levels change are
  checked for edits waiting and unread pages, not for handwriting or titles. `planTitles(elements,
  titleLevels)` (default `[]`: file titles only) matches our heading titles by rectangle and level,
  so a level change replaces its title. **Every import** now syncs titles on its pages, plain
  imports too. `restoreTitles` moved into `actions/titleSync.ts`. Defaults: titled levels `#` and
  `##`; styles `#` 1 (black), `##` 3 (dark grey), `###` 2 (light grey).
- **O4 screen.** As in §7.1, plus: the panel is disabled while Move to is on (Cancel in the top
  line); a heading's panel shows its title and the start of its first paragraph, no status; the
  Delete confirmation is the ⋯ row itself (a second tap, "Delete section (n blocks)"). The Details
  → **Outline** section (default level, titled levels, Restore titles moved there from Linked
  files, Read the outline again) came with O4 instead of O3, since it uses the new controls. Render
  tests: `__tests__/ui/outlineTab.test.tsx`, `outlineControls.test.tsx`.
- **Hook.** A block's new change replaces its earlier one of the same sort, so a level change and
  a move of one paragraph go together.

**Still open (device):** P1 glyphs, P2 table of contents with title styles, P3 height measurement
of a restyled heading, P4 Contents width on a Nomad, P5 panel heights.
