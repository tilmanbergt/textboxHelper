# Technical design: Aside area ("Set aside" below one divider)

Status: **built 2026-11-22 (A1–A4), As built at the end; device checks open.** Requirements: `claude/ideas-aside-area.md` in the claude.ai project (A1–A9, decided 2026-11-21/22). Mockup: design canvas "Textbox Tools – Aside area" (https://claude.ai/artifact/UvNrGPbsG8G1b8kXtnrJYJ). **Base:** `feature/linked-files` at `0103d7d`.

## Requirements as decided

- **A1** Everything in the aside area stays in the note: never written to a linked file, never exported.
- **A2** One aside area per note, also with several linked files.
- **A3** The plugin makes one heading, "Set aside"; any further subdivision is the user's own headings typed on the aside pages. A section set aside brings its heading along.
- **A4** Position decides: below the divider is aside, above it is text, also after a lasso move.
- **A5** Show › Set aside in the Outline shows only the aside area; All, With edits and Not final only the text.
- **A6** Move back works like Move to…: choose a file or heading of the text.
- **A7** No handwriting in the Outline.
- **A8** Show › Set aside is always offered; while the area is empty it explains what it is and how to use it.
- **A9** After a Move back is planned, the view jumps to the text at the target.

## Guiding rules

1. **No second mechanism.** The aside area is a part of the note bounded by a divider, like a linked file. Dividers with tags, title sync, segments, sections in the Contents, move targets and page inserts exist for files already; the work is making them serve the area too.
2. **Position is the only truth (A4).** One pure function says where the aside area starts; everything else derives from it.
3. **Pure core, thin screens.** Which part a block is in, which actions it offers, which entries a view shows are pure functions with tests.
4. **Delete what this replaces, in the same change:** the `a` tag as a rule, the Contents pseudo entry "Set aside" for notes with a divider, the panel's own aside checks.

## 1. Model

- **Tag:** `BlockTag.k = 'a'` is the aside divider (a textbox "Set aside", no `s`/`i`); our title over it is `k:'t'` with `a: 1`. `a` on a textbox is only read (legacy), never written.
- **Where the area starts** (`domain/noteRegions.ts`): the divider's index in reading order. Without a divider (notes set aside before it existed), the first `a`-tagged textbox after the last textbox of a linked file's text, so one moved back by hand doesn't pull the text after it into the area.
- **Segments** (`fileSegments.ts`): the last file ends at the area; `aside` holds the area's textboxes. A file's blocks there count as set aside (`CrossingOptions.aside`), not missing.
- **Outline** (`outlineModel.ts`): the divider is a block of kind `'aside'`, rank 0 like a file; `aside` per block by position; a file divider inside the area is text.
- **Contents** (`outlineContents.ts`): the area is the last top entry, its headings below it; notes without divider get the pseudo entry "Set aside".
- **Plan** (`outlinePlan.ts`): the divider never moves, changes level or goes; nothing in the area is set aside again; a move from the area into the text is a plain move, named "moved back".

## 2. Layout and apply

The text and the area are laid out apart: text that grows gets pages inserted before the area's first page; set-aside blocks go onto new pages at the end, under a new divider when there is no area yet; a legacy area gets its divider on a page of its own. Our titles follow (`syncTitles`), the divider titled like a file. Clean up starts the area too. The DOCX export leaves the area out. A file added to a linked note goes before the area.

## 3. Screen

Show: All · With edits · Not final │ Set aside (a rule before it). The Set aside view lists the area's entry and the user's headings; its paragraphs offer Move back ›, ↑ ↓, Move to… (within the area), ⋯ Delete; its headings Level and Delete. Move back is Move to… with the text's entries; then the view jumps to the text. An empty area shows the explanation (`ui/EmptyState.tsx`, shared with the Review).

## 4. Tests

`__tests__/domain/asideArea.test.ts` (where the area starts, the Outline's blocks, entries and views, moves, the plan, the actions per block, the two-part layout, the export), `__tests__/ui/outlineAside.test.tsx` (empty view, aside view, Move back), `sourceLink.test.ts` and `linkedFiles.test.ts` adapted (write-back by position, the aside title).

Device: §7 of the draft — set aside into a linked note (divider page, title, Update without the blocks), text overflow before the area, a lasso move across the divider, DOCX without the area, a legacy note getting its divider, the Set aside view with headings typed on the page, Move back across files, the glyph ▤, the table of contents.

## As built

Built in one pass on `feature/linked-files`; 449 Jest tests (424 before). Differences from the draft:

- **No region framework.** `noteRegions.ts` has `asideStart`, `splitAtAside`, `isAsideDivider` and `hasAsideDivider`; the draft's `regionsOf` / `regionAt` / `regionPages` were not needed. The layout splits the note in two parts only (`outlineLayout.ts` `layoutNote`, with `shiftedPage`): the text and the aside area. Linked files keep their behaviour: a file that grows in an Outline apply still pushes the files after it down, as before (per-file regions stay a later step). Clean up keeps its own file range; its whole-note scope already left the area out and inserts pages at the text's end.
- **Set-aside protected blocks** count as set aside like any block (left out, no question), as set-aside blocks did before; no "was set aside" removal question.
- **Views** stayed in `outlineContents.ts` (`inView`, `isFlat`, `asideEntry`, `initialEntry(contents, view)`, `contentsRows` by view); `OutlineFilter` gained `'aside'` instead of being renamed; no `outlineViews.ts`, no footer summary.
- **Actions per block:** `outlineActions.ts` `blockActions(block, flat)` returns the actions a paragraph or heading gets in the text or the area; the panel draws them. Status, Level and a file's own bar stay as they were. Headings in the area get no Move back (headings never move, Outline sections D1).
- **Move targets:** no `moveTargets`; the view decides which entries show (Move back shows the text's) and `moveToEntry` works within the text, within the area and back. `ContentsColumn` passes the chosen entry along, so the view can jump there (`useOutlineView` `showInText`).
- **The plan** gives every planned block its part by its planned place (`withPlannedAside`), so a block moved back right before the divider is text; set aside keeps going to new pages at the end. No planned divider block: the divider is placed at apply (`actions/asideArea.ts`).
- **Legacy:** the next Outline apply on such a note inserts the divider on a page of its own before the area; when set-aside text shares a page with the text, that is a blocker with the reason (move it with the lasso).
- **Deleting the divider** on the page simply ends the area (position decides); no Diagnostics line. **Export** leaves the area out (`exportClassification.ts` `textPartOf`, also in the counts) without a summary line.
- **Show line:** `TextChoices` got `ruleBefore` instead of option groups.
- **Added:** a file added to a linked note goes after the text's last page, before the area (`asideArea.ts` `textEndPage`, used by `textImport.ts`); the Review help has a "Set aside" block.
