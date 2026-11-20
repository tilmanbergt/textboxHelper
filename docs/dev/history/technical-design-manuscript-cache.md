# Technical design: Manuscript — keep what was read, check before acting, measure

Status: **C1 + C2 built 2026-11-20** (As built below; not device-tested yet). C3, C4 open.

**The problem (Tilman, 2026-11-20):** every time the Manuscript card opens, it reads the pages again, and the Outline scans the whole note again. Going back and forth between the card and the note feels like the plugin reads the same thing over and over.

**Guiding rule: show from cache, act on fresh reads.** What the card shows may be older. Anything that writes (Apply, Drop, Outline apply) reads its pages again and checks them first. Most of that check exists already (`preparePage` in `markerApply.ts`, which compares each textbox's text by number; `checkRebuild` and the text check in `outlineApply.ts`).

## 0. Requirements (agreed with Tilman, 2026-11-20)

1. When the card opens again, the pages read before show at once, with their changes.
2. The current page is always checked first. The other pages read before are checked quietly in the background. A page that changed is read again and its list is updated in place. The status line says so only when something changed.
3. **Tapping a page chip checks that page again**, even if it was read before. Show what is known at once, check in the background, and update the list if the page changed (usually something is added).
4. Before Apply, Drop or an Outline apply, the pages concerned are read fresh (as today). A background check still running stops first, so reads and writes never overlap.
5. **Timings:** the plugin records how long each step takes (page reads, analysis steps, recognition, applies, Outline scan). Under **Details → Speed**, **Save timings** writes them as one JSON file to EXPORT, so it can be handed over as a file. **Clear** starts over.
6. The first version should already help in most cases, not only measure.

## 1. What a check costs, and what it saves

A page read: `getElements` → pen-edit context (index, pictures) → page size, for diagnostics only → stroke stats for every mark → shape marks → delete/replace analysis → carets → assembly. A **check** only does `getElements` plus one read of the pen-edit index and compares a fingerprint. If the fingerprint matches, everything after `getElements` is skipped. How much that saves is what the timings measure (Q1).

## 2. Fingerprint of a page (`domain/pageFingerprint.ts`, pure)

`pageFingerprint(elements, penEntries, calibration)` → string. Per element, in page order:
- `type`, `numInPage`, `layerNum`, `userData`
- the recognize rect and `predict_name`
- for textboxes: the text, `textRect`, font size, bold, italic, frame style, align
- for geometries: type and points
- for titles and pictures: their rects

Pen part: the active index entries whose snippet tag is on the page, with `id, kind, number, state, mark, strokesTagged, awaitingMark`. Recognition, correction and edges are left out: the review gets them live through its pen states. Calibration is part of the key.

**Why `numInPage` is in it but `uuid` is not** (host facts): uuids change on every read, so including them would make every check fail. Numbers change on an insert, an edit or a save. When they change, the cached preview's numbers would be wrong for Apply and Drop, so the page must be read again. A miss is always safe; a wrong hit is not.

Stroke points are not read (that's the expensive part). An eraser stroke that only shortens a stroke without changing its recognize rect would go unnoticed. Apply's text check still protects the text (R1).

## 3. Cache (`actions/manuscriptCache.ts`, in memory)

- Module-level map: note path → `{pageCount, pages: page → {fingerprint, preview, readAt}, outline}`.
- Survives closing and reopening the card for as long as the plugin's JS runs (Q2).
- **Invalidation:**
  - The page count changed → the whole note is forgotten.
  - The plugin's own writes forget the pages they touched (Review apply, Drop), or the Outline scan (Outline apply, a block's first tag).
  - Calibration is in the key.
  - "Refresh preview" in Details forces fresh reads.
- No disk cache yet (C3).

## 4. Review flow (`useManuscriptReview.ts`, `usePageChecks.ts`)

- **Open:** read note info. Pages cached for this note show at once as read. Then:
  - If the current page is cached, it is checked first in the background.
  - If not, it is read in the foreground as before.
  - Then the other cached pages are checked, nearest first (`checkOrder`).
- **Chip tap:** an unread page is read in the foreground; a page read before goes to the front of the check queue.
- **Check queue:** one page at a time; the chips of pages waiting or being checked are faint. A hit refreshes only the pen states. A miss swaps in the new analysis, drops edge nudges kept for that page's old changes, and shows "Page 5 changed since it was read: its list is updated." when the list differs (`listChanged`).
- **Before writing:** Apply, Drop, Select mark and rereads stop the queue and wait for the page being checked. A foreground read pauses the queue and resumes it after.

## 5. Outline (`useOutline.ts`)

- A scan cached for this note shows at once; the scan runs again in the background ("Checking the outline…"). Its result replaces the blocks unless something is planned. With a plan, the blocks stay and the status line says Apply checks every page first.

## 6. Timings (`domain/perfLog.ts` pure, `utils/perf.ts`, `actions/timingsExport.ts`)

- A bounded log of 3,000 entries, kept across card openings: `{atMs, stage, ms, page?, detail?}`. Events have `ms: null`.
- **Stages:**
  - `card.open` (event: `pageCount`, `cachedPages`, `currentCached`), `card.noteInfo`, `card.firstList`
  - `page.read` (with `reuse`, `reused`, `elements`, `textboxes`, `changes`, `penEdits`), `page.getElements`, `page.fingerprint`, `page.cacheHit` / `page.cacheMiss`
  - `page.penContext`, `page.diagnosticsContext`, `page.strokes`, `page.shapeMarks`, `page.lineMarks`, `page.carets`, `page.assemble`, `page.recycle`
  - `pen.recognize`
  - `review.apply`, `review.drop`
  - `outline.scan`, `outline.cacheShown`, `scan.titles`, `scan.getElements`, `outline.check`, `outline.apply`
- **Export:** `textboxhelper-timings-<time>.json` in EXPORT: plugin version, `createdAt`, `recordingSince`, `jsContextAgeMs`, cache state, event counts, a summary per stage (count, total, median, max), then the entries.
- **UI:** Details → Speed: "124 timings since 16:40.", **Save timings**, **Clear**.

## 7. Steps

- **C1 Timings** and **C2 Cache in memory, checks**: built.
- **C3** (after the first timings) Disk cache, if Q2 shows the JS context doesn't survive between openings; check the note file's mtime first if the file API offers it (Q3).
- **C4** (if `getElements` itself is slow) Check only the current and the tapped page; leave the rest cached until Apply.

## 8. Open questions

- **Q1** What share of a page read is `getElements` vs. analysis?
- **Q2** Does the plugin's JS context survive closing and opening the card? (`jsContextAgeMs`; `cachedPages` on `card.open`)
- **Q3** Can the plugin read the open note file's modification time?
- **R1** An eraser stroke that doesn't change a stroke's recognize rect is missed by the check.

## As built (C1 + C2, 2026-11-20)

- The log is `utils/perf.ts`; saving is `actions/timingsExport.ts`, because `utils/` may not import `storage/`. The Details line and buttons are `screens/manuscript/useTimingsExport.ts`.
- **Reading a page:** `readMarkerPage(notePath, page, {reuse})` in `markerPageAnalysis.ts`; `analyzeMarkerPage` is a wrapper with `reuse: false`.
  - The fingerprint is taken again after a full analysis, because the analysis may move pen edits to this page in the index.
  - On a hit, the cached preview gets its pen states fresh from the index. When the card opens from the cache, the pen states of every cached page are read from the index first (`currentPenStates`), so recognized text isn't recognized again.
- **Reading again after a change:**
  - After an apply, a calibration change or an Outline apply, the Review reads its pages again with `reuse: true`. Unchanged pages are hits; the pages written are forgotten first. Only "Refresh preview" reads everything from scratch.
  - An Outline apply no longer reads every Review page from scratch (`review.recheck`).
- A failed background check keeps the cached view and is only logged.
- `page.diagnosticsContext` includes a `getPageSize` call on every page read (diagnostics only); if the timings show it as costly, it can go behind a switch.
- `useManuscriptReview.ts` grew to 535 lines (under the 1,000 limit); moving the opening-from-cache part out is a candidate for the next touch.
