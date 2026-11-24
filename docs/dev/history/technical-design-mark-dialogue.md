# Technical design: Mark dialogue — two passes, numbers you can trust, To decide

Status: **design, for Tilman's review.** Requirements: claude.ai project doc
`claude/requirements-mark-dialogue.md`; background and code analysis:
`claude/ideas-review-feedback-2026-11-24.md`; mockups: design canvas "Textbox Tools –
Marken-Dialog und Review". Built on `main` `22e58e8` (fine marks merged). Branch
`feature/mark-dialogue`. Part A only; parts B and C are outlined in §12.

**Guiding rules:**

- Reuse what is there, delete what the change makes unused, leave every touched module smaller
  and clearer.
- **The passes are visible in the code and in the tests.** Pass 1 (what the strokes are) and
  pass 2 (where they act in the text) are separate pure functions with their own test files and
  their own table of cases. A reader can answer "which strokes become which mark?" from the
  pass-1 tests alone, and "which reading with which textbox gives which place?" from the
  pass-2 tests alone.

## 0. Decisions (Tilman)

1. A **number on the page means linked**. The Review always shows a numbered edit: as a change,
   or as "place open". It is never dropped silently.
2. A tagged sidemark **without a mark gets "?"**, no number. Numbers are given at link time and
   count only links; gaps after Drop are fine. Old entries with a number but no mark are read
   as "?".
3. **No place check while writing.** Tag time and Select mark run pass 1 only.
4. **One pass 1** for the tag's look-back, Select mark and the Review.
5. Review order on a page: take out everything tagged → pass 1 on the rest → pass 2 for all →
   the user's settings on top.
6. **To decide** replaces "Needs attention": place open · sidemark without a mark · unclear mark
   on or over the text. A picture, words and the place; never element numbers. Plain
   handwriting beside the text is not listed. To decide never blocks Apply. A small **page map**
   is shown (to try out on the A5 X).
7. **Result per paragraph** on the right: the paragraph as it will read, new text bold, **removed
   text not shown at all**.
8. **Apply per page** by default; "All pages" as a quieter second action.
9. Not in v1: "use these strokes as the mark anyway". Unclear marks offer only readings pass 1
   found; else Ignore (remembered).
10. The user's settings are stored where they are today (pen edits); for plain marks they stay
    in memory.
11. Two readings at tag time: **the newest mark wins**, as today.
12. Lasso toolbar: "Insertion or Replacement" stays; "Comment or Image" comes in part B. In
    part A the "No mark found" card offers Select mark now · Later.
13. Placing in To decide: ‹ › and Here. Comments not exported for now.

## 1. Where the code is today (main `22e58e8`)

Shape and place are mixed, and the same shapes are judged in three places with three rule sets:

| Where | File | What it decides |
|---|---|---|
| Tag look-back | `domain/penEditPairing.ts` `findReplaceMarkInWindow`, `supernote/penEditPageRead.ts` `findCaretInWindow` | shape only, on rects (slash: `isSlashSizedRect`, ≥ ~59°); points only for caret-sized strokes |
| Select mark | `penEditPairing.ts` `readDeclaredMark` | shape only, relaxed (first caret wins; 0–2 crossings; slash by rect) |
| Review | `actions/shapeMarks.ts` (699 lines), `actions/markerPageAnalysis.ts` (694), `actions/editMarkerAnalysis.ts` | shape **and** place, interleaved with async measuring; slash `analyzeSlash` ≥ 45° and `placeSlash` ≤ 2 characters; verticals need the text line |

Consequences (from the code analysis): a mark Select mark accepts can be refused by the Review
(the number shows, the edit doesn't); a linked strike also appears as "Mark 35"; a 45–55° slash
works alone but not with a sidemark. The Review's mark logic is in `actions/`, so it can only be
tested through the whole page analysis.

## 2. The model

```
page strokes ──► 0. take out tagged ──► 1. PASS 1: readMarks ──► readings ──► 2. PASS 2: placeReading ──► places ──► 3. user layer ──► changes / To decide
                                         (strokes only)            │            (reading + measured textboxes)
                         tag look-back ──► PASS 1 ─────────────────┤  stored with the entry (linked marks)
                         Select mark   ──► PASS 1 ─────────────────┘
```

### 2.1 Input of pass 1 (`domain/marks/markStroke.ts`)

```ts
type MarkStroke = {
  id: string;                 // element uuid for this read
  numInPage: number;          // writing order
  rect: Rect;                 // recognize rect
  points: Point[] | null;     // page pixels; null where not read (look-back reads only small strokes)
  straightLine: boolean;      // geometry tool
};
```

### 2.2 Output of pass 1: a reading (`domain/marks/reading.ts`)

```ts
type MarkKind = 'strike' | 'replaceVerticals' | 'replaceLoop' | 'slash' | 'caret' | 'step'
              | 'sideways' | 'space' | 'swap' | 'closeUp' | 'punct';
type Need = 'point' | 'part' | 'twoParts';
type Anchor = {x: number; y: number; snap: 'word' | 'char' | 'line'};

type Reading = {
  kind: MarkKind;
  need: Need;                       // what pass 2 must find
  strokes: string[];                // ids of the strokes it consumes
  anchors: Anchor[];                // 1 (point) · 2 (part: start, end) · 3 (two parts)
  band: {top: number; bottom: number};  // the mark's height, raw
  rects: Rect[];                    // stroke rects, unchanged (coverage, band — §8)
  direction?: 'down' | 'up' | 'left' | 'right' | 'step';  // carets
  punct?: {char: string | null};    // punctuation circle, read by the plugin
  numberPlace?: Rect;               // the user's own circle, else where the plugin puts it
  flags: string[];                  // 'slants', 'veryFlat', … — shown, never refusing
};

type Pass1Group = {strokes: string[]; readings: Reading[]; reason: string | null};
// readings ranked: [] = not a mark (reason), [r] = one reading, [r1, r2] = two (r1 first)
```

Today's stored `PenEditMark` (rects, `bounds`, `slash`, `numberRect`, caret `tip`/`direction`)
holds exactly what is needed to rebuild a `Reading`; it stays the storage format
(`readingOfStoredMark(mark) → Reading`, `storedMarkOf(reading) → PenEditMark`), so no index
migration.

### 2.3 Pass 1 functions (pure)

- `readMarks(strokes: MarkStroke[]): Pass1Group[]` — the Review: every free stroke of the page,
  grouped into marks in today's order of consumption (paragraph marks → space → swap → close-up
  and punctuation → carets → slash → replace marks → strikes). Strokes in no group are
  handwriting.
- `readDeclared(strokes): Pass1Group` — Select mark: the selected strokes as one group.
- `readLookBack(window): Pass1Group | null` — the tag: the newest mark in the window
  (`pickNewestMark` rule unchanged; decision 11).
- All three use the same **shape functions**, one file per family in `domain/marks/shapes/`:
  `strike.ts` (strike-like, verticals `isReplaceVertical`, loop `isReplaceLoopRect`),
  `slash.ts`, `caret.ts` (V ∧ < > step, two-stroke), `space.ts`, `swap.ts`, `closeUp.ts`,
  `punct.ts`. They are moved from `penEditCaret.ts`, `paragraphMarks.ts`, `swapMark.ts`,
  `spaceMark.ts`, `closeUpMark.ts`, `punctMark.ts`, `slashMark.ts`, `markerStrokes.ts` and the
  shape parts of `actions/shapeMarks.ts`; the text parts of those files move to pass 2.

### 2.4 Input of pass 2: measured textboxes (`domain/marks/textboxView.ts`)

```ts
type TextboxView = {
  uuid: string; numInPage: number; rect: Rect; text: string;
  layout: CaretTextbox | null;   // lines and words (with character edges) from the native measure
  fontReadable: boolean;
};
```

Measuring is async and native; it stays in `actions/` (`markerMeasure.ts`, cached per
textbox). The orchestrator measures **only the textboxes near a reading** (as today) and hands
plain `TextboxView`s to pass 2.

### 2.5 Output of pass 2: a place (`domain/marks/place.ts`)

```ts
type Place =
  | {ok: true; uuid: string; lineIndex: number; start: number; end: number;   // part: [start, end); point: start === end
     mode?: 'inWord' | 'betweenWords' | 'paragraph' | 'blankLine' | 'split' | 'join' | 'space';
     second?: {start: number; end: number};                                    // two parts (swap)
     uncertain?: string}
  | {ok: false; reason: string; guess: Omit<Extract<Place, {ok: true}>, 'ok'> | null; onText: boolean};
```

- `placeReading(reading, textboxes: TextboxView[]): Place` — one function, switching on
  `reading.need` and `reading.kind`; the per-kind rules move from `editMarkerAnalysis.ts`
  (strike: one textbox, one line, word coverage), `penEditCaret.ts` `locateCaret`,
  `slashMark.ts` `placeSlash`, `swapText.ts`, `paragraphMarks.ts`, `closeUpMark.ts`,
  `exactBounds.ts` into `domain/marks/place/*.ts`.
- **Shape refusals never happen here** (too short, too tall…): they are pass 1's. Pass 2 refuses
  only for the text: no textbox, two lines, font locked, a slash on a space, a caret pointing at
  nothing.
- `onText`: whether the reading lies on or over a textbox (decides "unclear mark" vs
  "handwriting" for an unplaced unlinked mark).
- `guess`: the nearest sensible place (nearest line by band, words under the anchors, nearest
  word gap), for "place open".

### 2.6 Choosing among readings (unlinked marks)

`resolveGroup(group, textboxes) → {reading, place} | {unclear: readings[], reason} | handwriting`:
try the readings in rank order; the **first that places** wins (this keeps today's behaviour,
where a stroke that a shape test took but could not place was free for the next test). None
places: on text → unclear (offer the readings that pass 1 found, decision 9); not on text →
handwriting. Linked marks have exactly one stored reading and never fall through.

### 2.7 Step 3 — the user layer (`domain/marks/userLayer.ts`)

`applyUserLayer(place, layer) → place` for edges (‹ ›, existing `edgeShift.ts`), Here (turns
`ok: false` with a guess into `ok: true`), the chosen reading. Stored for pen edits as today
(`PenTextState.edges`, `confirmed: true` new); in memory for plain marks.

## 3. Tests — one structure that mirrors the passes

New folder `__tests__/marks/`, separate from the existing tests:

| File | Question it answers | Shape of a case |
|---|---|---|
| `pass1.read.test.ts` | Which strokes are read as which mark? | `{name, strokes: [builders…], expect: [{kind, need, strokes, anchors≈}] or {none: reason}}` — grouped by mark family (strike, replace, slash, caret, step, sideways, space, swap, close-up, punct, number circle, handwriting that is no mark, two readings) |
| `pass1.sameJudge.test.ts` | Do look-back, Select mark and the Review agree? | every positive case of `pass1.read` run through `readLookBack` (strokes in writing order, points only for small strokes, as on the device), `readDeclared` and `readMarks`: same kind and anchors |
| `pass2.place.test.ts` | With which textbox values does a reading land where? | `{name, reading: builder, textboxes: [textbox builder…], expect: {uuid, line, start, end, mode} or {open: reason, guess}}` — grouped by need: point (caret in a word / in a gap / between lines / beside two paragraphs / at a line end), part (strike over words, exact verticals in a word, slash on a letter, slanted slash, strike over two lines, font locked), two parts (swap one line / across a wrap) |
| `pass12.resolve.test.ts` | How do rank and placement decide among readings? | a group with two readings + textboxes → the chosen one, or unclear, or handwriting |
| `userLayer.test.ts` | What do ‹ ›, Here and a chosen reading change? | place + layer → place |
| existing `markerAssembly`, `fineMarksAssembly`, `paragraphMarks`, `swapSpaceMarks` … | Do whole pages still give the same changes? | unchanged; they are the **golden** end-to-end tests |

**Test builders** (`__tests__/marks/build.ts`), so every case reads like the mark it draws:

```ts
strike(x1, x2, y)            verticals(xLeft, xRight, y)   loop(cx, cy)
slash(cx, cy, angleDeg, len) caret('down' | 'up', tip)     sideways('left' | 'right', tip)
step(x, y) · swap(a, b, y) · arc(x1, x2, y, 'down' | 'up') · circle(cx, cy, r, fill?)
hand('word', x, y)           // handwriting: curved strokes that are no mark
textbox('the big red car', {left, top, width, fontSize})   // layout with a fixed-advance font
```

`textbox(…)` lays out lines and words with a fixed advance per character (as `LINE` in today's
`fineMarks.test.ts`), so expected offsets are easy to read in the test. Device-recorded cases
(diagnostics JSON, like `__tests__/fixtures/swap-page-2026-11-20.json`) are loaded by
`fixture('name')` and appear in the same tables.

**Golden check before and after the move:** step S0 records, for every page in the existing
scenario tests and every fixture, the list of changes and ignored marks the current code gives
(`__tests__/marks/golden/*.json`). Every later step must give the same lists, except the
changes listed as intended in its commit (e.g. slanted slashes found, linked marks no longer
"not recognized").

## 4. On the page

### 4.1 Tag (`actions/penEditTag.ts`)

1. As today up to the look-back read; then `withSlashPoints`: the points of the two newest
   strokes whose rect may hold a slash are read (small strokes, like carets today).
2. `readLookBack(window)` → reading or none.
3. Reading → `number = nextPenEditNumber(linked numbers on the page)`; **index entry first**
   (`storedMarkOf(reading)`, number), then the rings and numbers; inserting fails → the entry is
   set back to unlinked and the outcome says so.
4. None → `number: null`; the snippet's number textbox shows `?`; outcome card (§4.3).

### 4.2 Select mark (`attachSelectedMark`)

1. `readDeclared(selected strokes)`.
2. One reading → index first (`mark`, `kind`, `number = next`); one `getElements(page)`; the
   `snippetnum` textbox's text `?` → `n` (`modifyPageElements`); the mark's ring/number
   inserted; save. Failure → index back, message.
3. None or two → nothing written; outcome `markNotClear` with the picture and the reason.

### 4.3 Outcome cards (`screens/penEdit/PenEditOutcomeScreen.tsx`)

- `noMark`: "No mark found for this text" · "It is kept with a ? and waits in the review under
  To decide." · **Select mark now** · **Later**.
- `markNotClear` (replaces `markNotRead`): "Not a clear mark" · picture of the selected strokes
  (`strokeDrawing.ts`) · pass 1's reason · "The text keeps its ?." · **Try again** · **Cancel**.

### 4.4 Data (`domain/penEditModel.ts`, `domain/penEditTags.ts`)

- `number: number | null` (null = "?"); parse: `kind: 'unpaired'` → `number: null`.
- `confirmed?: boolean` (Here on a place-open pen edit).
- `looksLikePenEditNumber` accepts `?`.

## 5. Review

### 5.1 Orchestration (`actions/markerPageAnalysis.ts`, slimmed)

1. Read the page (as today): elements, strokes with points, textboxes.
2. **Take out** tagged strokes: snippets, decorations, and the strokes of **every** linked mark
   (`isExcluded` changes: a replace mark's `mark` strokes are excluded too).
3. **Pass 1** `readMarks(free strokes)`; drop groups remembered as Ignored (§5.4).
4. **Readings of linked marks** from the index (`readingOfStoredMark`, shifted with their tagged
   strokes as `resolvePenEdit` does today).
5. **Measure** the textboxes near any reading (as today, cached) → `TextboxView[]`.
6. **Pass 2**: linked → `placeReading` (ok → change; not ok → place open with the guess, never
   "not recognized"); unlinked → `resolveGroup`.
7. **User layer** (edges, Here) → drafts → `markerAssembly.ts` (unchanged) builds hunks and
   plans.

`shapeMarks.ts` disappears (its shape parts are pass 1, its place parts pass 2, its order is
`readMarks`). `markerPageAnalysis.ts` keeps reading, orchestration and drafts; target well under
its 694 lines.

### 5.2 Result model (`EditMarkerPreview`)

`ignoredMarkers` is replaced by `toDecide: ToDecideItem[]`:

```ts
type ToDecideItem =
  | {kind: 'placeOpen'; penEditId: string; number: number; reading: Reading; place: Place /* ok:false */}
  | {kind: 'noMark'; penEditId: string; rect: Rect}
  | {kind: 'unclear'; key: string; strokes: number[][]; rect: Rect; words: string; reason: string; readings: Reading[]};
```

One problem = one item (step 2 of §5.1 makes a linked mark's strokes invisible to pass 1).

### 5.3 Screen (`ReviewTab.tsx`, new `ToDecideList.tsx`, `ToDecideSide.tsx`, `PageMap.tsx`)

- Tabs **Changes n** · **To decide m**; the page strip counts both.
- Rows: number ring, "?" or an empty dashed box; kind; words or handwriting; page and paragraph.
- **Place open:** mark picture with the text around it, the reason, Place ‹ › (existing
  `EdgeControl`, running over line ends), result line, **Here** · Drop.
- **"?":** handwriting picture, recognized text with Correct (`PenText`), **page map**,
  **Select mark ›**, **Insert right here**, Drop.
- **Unclear:** picture, words under it, reason; one button per reading pass 1 found, then its
  edges, result and **Here**; **Ignore**.
- **Page map** (`ui/PageMap.tsx`): the page's textbox rects as grey bars and the item's rect
  framed, scaled into ~110 × 150 dp; plain views, no page render.
- `AttentionLine`, `AttentionItem` are deleted.

### 5.4 Ignore store (`storage/ignoredMarks.ts`)

Per note and page: the group's rect and a short hash of its points; matched within ± 4 px.
Written on Ignore, read with the page's pen-edit context.

### 5.5 Result per paragraph (`domain/markerDiff.ts`, `ChangeSide.tsx`)

`buildResultSegments(originalText, ranges)`: same walk as `buildDiffSegments`, removed text
skipped, inserted text bold, pending pen text muted, the apply step's space cleanup applied.
Test: its plain text equals the plan's `nextText` for the same ranges. `ChangeSide` shows it at
the top ("¶ after its k changes") for the selected change's textbox.

### 5.6 Apply per page (`useManuscriptReview.ts`, `ManuscriptScreen.tsx`)

`applyPage()` applies `view.plans` of the selected page: **"Apply n edits on page p"**; when
other read pages have ready edits, **"All pages · m edits"** (today's `apply`).

## 6. Pictures without page render

Unclear marks keep their stroke points (pass 1 has them); linked marks' strokes come from the
same page read; `strokeSegments` draws them. Words around: from the textbox view.

## 7. Slash (`domain/marks/shapes/slash.ts`, `place/slash.ts`)

- Pass 1: trim end hooks (first/last ~10 % of the length), straightness ≥ 0.85, direct length
  10–130 px, **angle ≥ 30°** (a strike is flatter than ~29°: `MAX_MARKER_HEIGHT_RATIO` 0.55, so
  the two never overlap). Rect pre-test `isSlashCandidateRect` decides whose points the look-back
  reads.
- Pass 2: crosses the line's middle; height 0.5–1.5 line heights; **width ≤ 1.6 line heights**;
  the letter under the crossing at the line's middle; wider than two letters → `uncertain:
  'The slash is slanted: check the letter.'`.
- Diagnostics: `slash` log with angle, straightness, height/line, width/character.

## 8. Accuracy and speed

- Pass 2 keeps today's inputs: the stroke rects stay in the reading (`rects`, `band`), so word
  coverage and the line band are computed as now. Today's text filters (one textbox, one line,
  caret away from text = handwriting, paragraph mark between two lines) are pass 2 rules.
- The order of consumption and "first reading that places wins" keep today's results; the golden
  check proves it.
- Tag: pass 1 on data already read + points of at most two small strokes. Select mark: + one
  `getElements`. Review: linked marks skip pass 1; the rest as today.
- Timing stages: `tag.pass1`, `selectMark.total`, `review.pass1`, `review.measure`,
  `review.pass2`.

## 9. Steps (each one commit, `npm run check` green, golden check unchanged unless listed)

- **S0 Test frame and golden record.** `__tests__/marks/build.ts` (builders),
  `__tests__/marks/golden/` recorded from the current code for the existing scenario pages and
  fixtures; `golden.test.ts` compares. No source change. *Device test: none.*
- **S1 Pass 1 in `domain/marks/`.** `MarkStroke`, `Reading`, the shape families, `readMarks`,
  `readDeclared`, `readLookBack`; the look-back, Select mark and the Review's shape parts call
  them (`shapeMarks.ts` keeps only placing for now). Slash rules of §7 (intended golden change:
  slashes of 30–45° found). `pass1.read.test.ts`, `pass1.sameJudge.test.ts`. *Device: tag a
  slash at ~60° and ~35°, strike + verticals, loop, caret; Review as before.*
- **S2 Pass 2 in `domain/marks/place/`.** `TextboxView`, `Place`, `placeReading`,
  `resolveGroup`; `shapeMarks.ts` and the placing parts of `editMarkerAnalysis.ts` /
  `markerPageAnalysis.ts` removed; orchestration as §5.1 (without the linked-mark change yet).
  `pass2.place.test.ts`, `pass12.resolve.test.ts`. Golden unchanged. *Device: a page with every
  mark kind gives the same Review as before.*
- **S3 Numbers and "?".** `number | null`, "?" text, numbering at link time, index first, Select
  mark changes the "?", outcome cards with picture and reason. *Device: tag without a mark → ?,
  Select mark → number; a scribble → "Not a clear mark".*
- **S4 Linked marks in the Review.** Linked strokes taken out; stored readings through pass 2;
  place open instead of "not recognized"; `toDecide` model; Ignore store; `userLayer.ts`
  (Here, `confirmed`). Intended golden change: linked marks that were "not recognized" become
  changes or place open. *Device: a linked strike over two lines → place open, ‹ › and Here.*
- **S5 To decide screen.** Tabs, rows, the three sides, `PageMap`; `AttentionLine` gone.
  *Device: the three kinds, Ignore remembered, page map readable.*
- **S6 Result per paragraph and Apply per page.** `buildResultSegments`, `ChangeSide` top
  section, `applyPage`, labels; CHANGELOG. *Device: two changes in one paragraph → only the
  result, nothing struck; apply page 4 only.*

Each step also updates `docs/dev/design-overview.md` where the layer map changes (S1, S2) and
the CHANGELOG where the user sees a change (S1 slash, S3, S4, S5, S6).

## 10. Files (target)

```
src/domain/marks/
  markStroke.ts  reading.ts  textboxView.ts  place.ts
  pass1.ts            readMarks, readDeclared, readLookBack, order of consumption
  pass2.ts            placeReading, resolveGroup
  userLayer.ts
  storedMark.ts       readingOfStoredMark, storedMarkOf
  shapes/  strike.ts slash.ts caret.ts space.ts swap.ts closeUp.ts punct.ts
  place/   part.ts point.ts twoParts.ts slash.ts paragraph.ts closeUp.ts
__tests__/marks/
  build.ts  golden/  golden.test.ts
  pass1.read.test.ts  pass1.sameJudge.test.ts
  pass2.place.test.ts  pass12.resolve.test.ts  userLayer.test.ts
```

Moved from: `penEditCaret.ts`, `paragraphMarks.ts`, `swapMark.ts`, `swapText.ts`,
`spaceMark.ts`, `closeUpMark.ts`, `punctMark.ts`, `slashMark.ts`, `exactBounds.ts`,
`insertHere.ts` (placing), `markerStrokes.ts` (shape parts), `penEditPairing.ts` (shape parts),
`actions/shapeMarks.ts`, `actions/editMarkerAnalysis.ts` (placing). Each source file ends up
either in `domain/marks/` or smaller; existing tests are moved with their code and keep their
cases.

## 11. Device test after S6

1. Tag after a strike + verticals, a loop, a caret, a slash at ~60° and ~35°: number at once;
   the Review shows each under Changes.
2. Tag without a mark: "?" and the card; Select mark on a clear mark: "?" becomes the next
   number; on a scribble: "Not a clear mark" with picture and reason, "?" stays.
3. A linked strike over two lines: place open with a guess; ‹ › and Here make it a change.
4. A stroke over a word that is no mark: unclear, with picture; Ignore; reopen: not listed.
5. Margin handwriting: not listed.
6. Two changes in one paragraph: right side shows only the result, new words bold.
7. Apply on page 4 only; "All pages" applies the rest.
8. Timings export has the new stages.

## 12. Parts B and C (outline)

- **B — Comment or Image** (lasso button 6320): no look-back; card Comment · Image; signs
  (speech bubble "C", frame); `kind: 'comment' | 'image'`, paragraph by height (pass 2 for
  sidemarks), `picturePlace: 'before' | 'after'`, `done`; Notes tab; the cards offer Comment ·
  Image for the waiting sidemark.
- **C — Image file and moving:** PNG when needed, `![[<file> image n.png]]` before/after its
  paragraph; comments and images move with their paragraph (device check: moving strokes).
- Later test level: the help pictures' spec (`docs/user/marks/marks.mjs`) drawn by
  `scripts/lib/markDrawing.mjs` exports its strokes and word boxes; a test runs them through
  pass 1 and pass 2 and compares with each entry's `after` — the help pictures then prove what
  the plugin reads.

## 13. Open

- Wording of reasons (`domain/marks/reasons.ts`).
- S1 + S2 are the large moves (≈ 1,500 lines change place). If a step gets too big, S1 is split
  into S1a (caret, slash, strike families) and S1b (swap, space, close-up, punct).
