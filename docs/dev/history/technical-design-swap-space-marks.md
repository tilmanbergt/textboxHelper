# Technical design: swap and insert-space marks, and the font rule

Status: built (see As built); device test open. Ideas: `claude/ideas-more-edit-marks.md` (claude.ai project) §1 (swap) and §2 (caret family). Decisions (Tilman, 2026-11-18/19): this design covers **swap** and **insert space** only; new paragraphs are `technical-design-paragraph-marks.md` (step mark, `<`/`>`; built in another session); the text caret stays as built (pen edits §8). Space caret: **∧ and V** both. **Font rule:** marks on a textbox whose font can't be loaded are ignored, and the user is told why. **Swap with other changes:** keep both where simple — edits inside the swapped parts first, then the swap (§6.2).

Code read: local `textboxHelper` working tree (2026-11-19): `actions/editMarkers.ts`, `actions/editMarkerAnalysis.ts`, `domain/markerAssembly.ts`, `domain/markerTypes.ts`, `domain/markerStrokes.ts`, `domain/penEditCaret.ts`, `domain/hitTesting.ts`, `domain/textboxLayout.ts`, `domain/fontPaths.ts`, `supernote/textboxMetrics.ts`, `TextboxMetricsModule.kt`. Goes into the repo as `docs/dev/history/technical-design-swap-space-marks.md`.

**Sequence:** after paragraph marks are merged. Both add shape tests "before the delete analysis" in `editMarkers.ts`; building on top avoids two competing dispatch orders.

## 1. Scope

**In:**
- **F — font rule** for every mark in the review (§2).
- **C — character positions** from the native measurement (§3), used by the space mark and by the existing text caret.
- **S — insert space:** a ∧ or V with a small cross or `#` at its tip, on its own (§4).
- **W — swap:** the transpose stroke on one line of one textbox (§5), combined with simple edits inside it (§6.2); later across several lines (§5.4).
- **P — paragraph mark change:** the step mark gets a second vertical (§5.5), so a single step can mean "swap split" in both orientations.

**Out:** swap across textboxes; swaps inside or across other swaps; capitals, close-up and the other ideas in `ideas-more-edit-marks.md` §3; push-down/layout engine.

## 2. Font rule (F)

**Rule.** A textbox whose font fell back to Android's default typeface (`isDefaultTypefaceStatus`) is **locked** for this review: every mark that needs its word or line positions is Ignored, with the reason naming the font and the fix. Today the review continues and only shows `fontWarning`; that goes away for the review (the textbox tools Split/Join/… keep their warning).

**What counts as "on" a locked textbox** (everything placed by its measured lines/words):
- delete and replace marks (incl. their verticals/loop, and tagged replacements paired to them),
- caret insertions inside the box (`placeCaretInsertions` → `inline`),
- paragraph marks (`<`/`>` line boundaries and the step mark inside the box),
- the new swap and space marks.

**Not locked:** an insertion between two textboxes (`gap`) — it needs no positions inside a box. Its new textbox's height is still measured in the neighbour's font, as today. *(Assumption — see §9.)*

**Mechanism** (`actions/editMarkerAnalysis.ts`, `supernote/textboxMetrics.ts`):
- New `measureTextboxOnce(textbox, calibration)`: a per-preview cache keyed by uuid (text, width, font size, font path), returning `{measurement, fontReadable, fontName}`. Today `analyzeDeleteMarker` measures once **per marker**; every analysis (delete, swap, space, caret placement, paragraph marks) goes through the cache instead → fewer native calls, one truth per textbox.
- `fontReadable = !isDefaultTypefaceStatus(measurement.typefaceStatus)`.
- Every analysis first asks the cache; a locked box → `buildRejectedResult(marker, fontLockedReason(fontName))`, with `removableNums` as usual (the user may still remove a mark; the review doesn't suggest it).
- `fontLockedReason(name)` (pure, `domain/fontPaths.ts`): `Font "851tegakizatsu.ttf" can't be read by plugins, so marks on this textbox can't be placed. Copy the font file to MyStyle/TextboxHelper/fonts and open the review again.`
- **Telling the user:** the review's summary gets one line per review (not per mark): `Marks on 2 textboxes were skipped: their font can't be read (851tegakizatsu.ttf). See Ignored.` — replaces `fontWarning` in `EditMarkerPreview` with `lockedFonts: {name: string; textboxNums: number[]}[]`; the screen shows it where the warning was. The Ignored rows carry the full reason.
- Diagnostics: `fontLocked` entry per textbox (path, status).

## 3. Character positions (C)

Today `offsetOnLine` (`penEditCaret.ts`) and `findCharacterOffsetAtPoint` (`hitTesting.ts`) guess a character from the word's average character width. Wrong by a letter in proportional fonts ("mi|ll" vs "m|ill"); fine for text insertion at word edges, not good enough for a space inside a word.

- **Native** (`TextboxMetricsModule.kt`, `measureTextLayoutDetailed`, inside the word loop): add `charEdges` — `layout.getPrimaryHorizontal(i)` for `i = segmentStart … segmentEndExclusive` (length = characters + 1; same coordinate system as `left`/`right`). Cost: a few hundred calls per textbox, well under the measurement itself; check in the device log (§7).
- **Type** (`textboxLayout.ts`): `NativeDetailedWord.charEdges?: number[]` (optional: an old native build still works and falls back to the average).
- **Pure** (`domain/textOffsets.ts`, new): `charOffsetAtX(word, x) → {offset, distancePx}` — the nearest edge; average-width fallback when `charEdges` is missing or its length doesn't match.
- `offsetOnLine` uses it (better text insertions inside words for free); `findCharacterOffsetAtPoint` too.

## 4. Insert space (S)

### 4.1 Shape (`domain/spaceMark.ts`, pure)
- **Caret:** `analyzeCaret` / `analyzeTwoStrokeCaret` (existing), direction **up (∧) or down (V)** only; `<`/`>` with a cross → Ignored ("a cross works with ∧ or V only").
- **Cross:** 2–4 strokes, each short (longest side 8–60 px and ≤ 1.2 × caret size), fairly straight (`straightness ≥ 0.8`); **at least one pair intersects** (segment intersection of their end-to-end lines, with 4 px slack) at an angle of 45–135°. Covers `+`, `×` and `#`.
- **Near the tip:** the cross's centre within `max(40 px, 1.5 × caret size)` of the caret's tip, on any side (on paper the `#` sits above the caret; people will put it anywhere close).
- Each cross stroke belongs to at most one caret (nearest tip wins).
- Result: `SpaceMark = {caret: CaretShape; caretStrokeUuids; crossStrokeUuids; tip}`.

### 4.2 Place
- `locateCaret(tip, direction, textboxes)` (existing) → must be `{kind: 'text'}` in a non-locked box; a `gap` result → Ignored ("a space must point into a line").
- Offset: `charOffsetAtX` on the word under the tip; between words → the nearest word edge.
- Already a space (or line start/end) at the offset → Ignored ("there is already a space here").
- Change: zero-length range `{kind: 'replace', start: offset, end: offset, replacementText: ' '}`; operation kind `'space'`, summary `Space · "this|word"` (6 characters each side), detail `Textbox N · line L`.

### 4.3 Caret with cross vs tagged insertion caret
- A caret paired with a tagged insertion (`pen.carets`, already excluded from markers) stays an insertion. A cross next to it → Ignored ("cross next to an insertion caret — erase one of them").
- Tagging: `findCaretInWindow` skips nothing new; if Tilman draws caret + cross and then tags text, the look-back finds the caret → insertion wins and the cross is reported. Accepted edge case.

## 5. Swap (W)

### 5.1 Shape (`domain/swapMark.ts`, pure)
Input: stroke points (one stroke, or two strokes whose ends meet within `TWO_STROKE_JOIN_PX` = 24 px, joined like the two-stroke caret), and the measured lines of the textbox the stroke's centre is in.

- **Size gate (cheap, before measuring):** width ≥ 80 px; height ≥ 20 px; height ≤ 0.9 × width. Its centre inside exactly one textbox.
- **Line:** for each measured line with centre `cy` and height `h`, test the pattern; exactly one line must pass (none or two → Ignored "swap mark doesn't fit one line").
- **Pattern** (works for the square ⊓⊔ and a rounded S, both orientations, drawn left→right or right→left):
  1. Walk along the stroke; classify each point `above` (`y < cy − 0.15 h`), `below` (`y > cy + 0.15 h`) or `mid`.
  2. Drop `mid` points; merge runs. Exactly **two runs** remain: one `above`, one `below` (either order). More runs (a wave, handwriting) → no swap.
  3. Each run spans ≥ 25 px in x and the two runs overlap in x by ≤ 20 % of the narrower → they sit side by side.
  4. Each run reaches beyond the text: the `above` run has points at `y ≤ cy − 0.35 h`, the `below` run at `y ≥ cy + 0.35 h` (it goes over/under the text, not through it — tells it apart from a strike).
  5. **Split x** = x where the stroke crosses `cy` between the two runs (interpolated); it must lie between the runs' inner ends ± 15 px.
- **Bounds:** left = the stroke's min x, right = its max x (outer verticals count if drawn; if not, the ends of the horizontals).
- Result: `SwapMark = {strokeUuids; lineIndex; left; split; right; aAbove: boolean}`. Both orientations (A above or A below) are swaps.

### 5.2 Text (`domain/swapText.ts`, pure)
- Words on that line (measured, `lineIndex`): **A** = centre x in `[left, split)`, **B** = centre x in `[split, right]`. Each must have ≥ 1 word (else Ignored "one side of the swap has no words").
- A and B are **side by side**: the mark's middle vertical is the one boundary (`|___|‾‾‾|` or `|‾‾‾|___|`). There is no text between them except the **gap** — the whitespace between A's last word and B's first word, where the vertical stands.
- **Zones** of the original text: `before = [0, a0)`, `A = [a0, a1)`, `gap = [a1, b0)` (whitespace only), `B = [b0, b1)`, `after = [b1, end)`, with `a0 = A.first.start`, `a1 = A.last.end`, `b0 = B.first.start`, `b1 = B.last.end`. Range of the swap `R = [a0, b1)`.
- `swapParts(a, gap, b, options) → string` (applied to the parts **after** their inner edits, §6.2):
  - **Slot punctuation:** split leading `[(\[{„«“‘'"]*` and trailing `[.,;:!?…)\]}»”’'"]*` off `a` and `b`; they stay in their slot: `leadA + coreB + trailA + gap + leadB + coreA + trailB`. ("big, red car" → "red, big car"; "the red blue." → "the blue red.")
  - **Capitals** (when `options.fixCase`): only when `a0` starts a sentence (text start, or after `[.!?…]` + whitespace) and `coreA` starts upper-case and `coreB` starts lower-case: upper-case `coreB`'s first letter, lower-case `coreA`'s first letter unless `coreA` is "I" or entirely upper-case. `capsAvailable(...)` says whether the toggle is shown.
- Operation kind `'swap'`, summary `Swap · "a" ⇄ "b"` (shortened, edited parts), `words` = A + B.

### 5.3 Toggle state
- `RecognizedEditOperation.swap?: {fixCase: boolean; available: boolean}`.
- The review keeps `swapOptions: Record<operationId, {fixCase: boolean}>` next to the pen states; `assembleMarkerPreview(base, penStates, swapOptions)` rebuilds the swap text (pure; no re-measuring).
- Change row: a small "Fix capitals" checkbox (`ui/Checkbox.tsx`) only when `available`.

### 5.4 Across several lines (later step, M6)

A and B still sit side by side (one boundary), but each may run over several lines and end inside a word. The one-line mark is cut into three pieces that can be drawn on different lines:

| Piece | Shape (A above) | Shape (A below) | Marks |
|---|---|---|---|
| start corner | vertical up, then a line right **above** the text `⌈‾` | vertical down, then a line right **below** `⌊_` | where A starts (the vertical's x) |
| split | `‾|_` | `_|‾` | where A ends and B starts |
| end corner | a line **below** ending in a vertical up `_|` | a line **above** ending in a vertical down `‾|` | where B ends |

- **Split piece (the anchor):** both runs must be **longer than one word**: each run ≥ max(60 px, the width of the word next to the vertical on its side). It says "long swap" visually and keeps a short step from becoming a swap.
- **Corners are found from the split:** in the same textbox, the nearest matching start corner **before** it in reading order and the nearest matching end corner **after** it; orientation must match the split's. A corner without a split is an ordinary stroke (→ delete analysis, usually "too tall"). A split without both corners → Ignored ("swap needs a start and an end corner").
- **Lines in between are optional:** over-/under-lines on the lines between are consumed when their side matches (above for A's lines, below for B's — mirrored likewise) and ignored if they're missing. A line on the wrong side → swap Ignored ("swap lines on the wrong side").
- **Places:** each vertical → `charOffsetAtX` (§3), snapped to a word edge within 0.6 characters, else inside the word. So A and B can end "up to a specific word or character".
- **The one-line mark** is the same three pieces in one stroke; the §5.1 test stays as the fast path.
- **Limits:** one textbox; no explicit line break (`\n`) inside A or B (conflict, as in §6.2); pairing must read start → split → end without another split in between; overlapping swaps → all Ignored. A split right after the last word of a line gives a gap at the line wrap — fine.
- Zones, punctuation slots, capitals and §6.2 apply unchanged (they work on offsets only).

### 5.5 Paragraph step mark gets a second vertical (change to `technical-design-paragraph-marks.md`)

Problem: a single swap split `_|‾` (A below) looks exactly like the paragraph step mark. Instead of forbidding the mirrored swap (hard to remember), the paragraph mark gets a feature of its own:

- **Paragraph break = step + a second vertical** next to its upright (`_||‾`): a separate short stroke, roughly parallel to the upright (angle ≤ 20°), 6–30 px from it on either side, overlapping ≥ 50 % of its height, crossing the same line. Mnemonic: two lines = break (as `‖` / ¶).
- Then: **one vertical = swap split** (either orientation), **two verticals = paragraph break** (either orientation, rising or falling).
- `<` / `>` paragraph marks are unchanged.
- **A step without the second vertical** and without matching corners → Ignored with a hint: "A paragraph break needs a second line next to the upright; a swap needs start and end corners." — never silently one or the other.
- Not to be mixed up with the replace mark (strike **through** the text + two verticals): the step's runs lie above and below the text, and paragraph marks are classified first (§6.1).
- **Coordination:** the paragraph marks are being built now. This is a change to their step test (`paragraphMarks.ts`) plus one test case each; it should land in that work or right after, before M6.

## 6. Where it plugs in

### 6.1 Classification order (`actions/editMarkers.ts` → pure `domain/markClassification.ts`)
After stroke stats are loaded and before `analyzeDeleteMarker`:

1. Exclude own elements and tagged snippets/carets (as today).
2. Locked textboxes (§2): markers whose centre is in one → Ignored.
3. **Paragraph marks** (as built there; step mark with its second vertical, §5.5).
4. **Swap** (§5) — one or two strokes.
5. **Space** (§4) — caret + cross strokes.
6. Replace (strike + verticals/loop) and delete (as today), on the strokes **not consumed** above.

A consumed stroke is in exactly one result. The pure part takes `{uuid, numInPage, points, rect}[]` plus textbox measurements and returns `{swaps, spaces, remaining}`; the flow measures through the cache (§2) first. Strokes that fail a shape test simply go on to the next test.

### 6.2 A swap together with other changes (`domain/swapCompose.ts`, pure)

**Rule (Tilman, 2026-11-19): first the edits inside the swapped parts, then the swap.** Every other change in the same textbox is placed in one zone (§5.2); it is applied there, and the swap moves the edited parts.

**Zone of a change:**
- A range `[s, e)` with `e > s` (delete, replace) belongs to `before`, A, B or `after` when it lies **completely** inside it.
- A point change at offset `p` (caret insertion, space, paragraph split): strictly inside A or B → moves with that part. **At an edge** (`p = a0, b1`, or anywhere in the gap) it does **not** travel: before/after R it stays outside; in the gap it stays in the gap, i.e. between the swapped parts. E.g. "big red car", insert "very" before "big", swap big/red → "very red big car". The diff shows it; who meant "red very big" draws the caret inside after applying.

**Allowed (the usual cases):**
| Case | Example | Result |
|---|---|---|
| delete inside A or B | "the big old red car", swap "big old" / "red", strike "old" | "the red big car" |
| replace inside A or B | swap + replace "big" → "huge" | "red huge car" |
| insertion / space inside a word of A or B | caret inside "bigg|er" | moves with the word |
| any change before or after R | as today | unchanged |
| two swaps on disjoint ranges | | both |

**Conflicts → the swap is Ignored, the other changes stay** (reason names the cause; the user applies the rest and swaps in a second pass):
1. **A change crossing an edge:** a strike from A across the split into B (it covers words of both parts), a replacement covering half of A and something before it. *"A change crosses the edge of the swapped part."*
2. **A swapped part emptied by its edits:** A or B deleted completely (or replaced by empty text). Swapping with nothing is a move, not a swap. *"One swapped part is deleted completely."* (Replacing **all** of A with new text is fine — it's inside A.)
3. **Two swaps overlapping** (nested or crossing): both Ignored. *"Swaps overlap."*
4. **A paragraph split strictly inside A or B, or in the gap:** inside a part it would move with it; in the gap it would put A and B into different paragraphs — then it isn't a one-line swap any more. *"Paragraph break inside the swap."* (At `a0` or `b1` it stays outside: allowed.)
5. **A pen edit inside A or B that isn't ready** (recognizing, skipped, failed, empty): the swap **waits** with it — shown as `Swap · waiting for replacement 3`, not applied, its strokes stay on the page. Applying the swap alone would move text under a replacement mark that is still on the page; the later pass couldn't place it.

**Assembly** (`markerAssembly.ts`): for a textbox with swaps, the ranges inside R are taken out of the flat list:
1. Zone each range; conflicts as above → swap Ignored (its ranges go back to the flat list unchanged).
2. `a' = applyTextMutationRanges(text[A], rangesInA shifted)`, same for `gap'` (only point insertions can be there) and `b'`.
3. One range `[a0, b1) → swapParts(a', gap', b', options)` replaces R in the flat list; changes before/after R stay separate ranges.
4. `consumedMarkerNums` of the swap operation unchanged; each inner change keeps its own operation row (and its own strokes to remove).
- **Display:** R is shown as one diff block (old struck, new bold); the inner changes' rows say "inside swap". Simple, and the result is what the user checks.
- **Apply:** unchanged — `textMutations` gets the final text.

**Space vs delete covering the same word** (no swap): existing range handling (`getUniqueTextMutationRanges`); add a test that a zero-length insertion inside a deleted range is dropped with a reason.

### 6.3 Types (`markerTypes.ts`)
- `EditMarkerOperationKind = 'delete' | 'replace'` (range kinds unchanged — swap and space apply as `replace` ranges).
- `ReviewOperationKind` gains `'swap' | 'space'` (rows, icons, counts).
- `EditMarkerPreview.fontWarning` → `lockedFonts` (§2); `RecognizedEditOperation.swap` (§5.3); `insideSwap?: string` (the swap's operation id) for inner changes.
- `MarkerPreviewBase` gains `swaps: SwapDraft[]` (`{operation, zones: {a0, a1, b0, b1}, capsAvailable}`), so the composition reruns when pen states or the toggle change.

### 6.4 Apply
No new apply code: the composed swap is one range in `textMutations`; its strokes go into `consumedMarkerNums` and are removed with the others (by `numInPage`, unique rule).

### 6.5 Review screen
- Rows: `Swap · "big" ⇄ "red"`, `Space · "this|word"`; diff from `buildDiffSegments` (old struck, new bold) — no new segment style.
- Help text (`domain/helpTexts.ts`): two lines for the marks; one for the font rule; one for "edits inside a swap are made first".

## 7. Device check

1. `charEdges`: time added per textbox (log `measureMs` before/after); a caret in the middle of "millimeter" in TilmanHandwriting1 and 851tegakizatsu lands on the right letter.
2. Space: ∧ + `+`, V + `×`, ∧ + `#`, cross drawn left/right/above of the tip; a cross alone (no caret) stays an ordinary stroke (→ delete analysis, probably "too short").
3. Swap: square, rounded S, mirrored, right-to-left, pen lifted at the split; a swap next to a strike on the same line; swap of first two words of a sentence (capitals toggle); punctuation case.
4. Swap combinations: strike inside B, caret insertion inside A, caret in the gap, a tagged replacement inside A (before and after recognition), a strike crossing the split (→ swap Ignored).
5. Font rule: a box in 851tegakizatsu **without** the copy → all its marks Ignored with the message, the box beside it (system font) works; with the copy → works.
7. Multi-line swap: A over 2 lines and B over 3 (both orientations); ends inside a word; split at a line end; a bare step (no corners, no second vertical) → Ignored with the hint; paragraph step with the second vertical on the left and on the right.
6. "Save Diagnostics" contains the classification per stroke (swap/space/remaining) and the swap zones → fixtures.

## 8. Steps (each a commit / `git format-patch` into `build/`)

| Step | Content |
|---|---|
| M1 | Font rule: `measureTextboxOnce` cache, locked boxes, `lockedFonts`, reasons, help text; all analyses through the cache + tests (pure parts) → device check 5 |
| M2 | `charEdges` native + type + `textOffsets.ts`; `offsetOnLine` / `findCharacterOffsetAtPoint` use it + tests → device check 1 |
| M3 | Space: `spaceMark.ts`, classification step, rows + tests → device check 2 |
| M4 | Swap alone: `swapMark.ts`, `swapText.ts`, toggle, rows + tests → device check 3 |
| M5 | Swap with other changes: `swapCompose.ts`, assembly, waiting state, conflicts + tests → device check 4, 6 |
| P1 | Paragraph step mark: second vertical required (§5.5), hint for a bare step + tests (in or right after the paragraph-marks work) |
| M6 | Swap across lines: corner and split pieces, pairing, optional in-between lines + tests (§5.4) → device check 7; As built |

Tests (Jest, pure): `fontLockedReason`; `charOffsetAtX` (edges, fallback, mismatch); cross detection (`+`, `×`, `#`, non-crossing strokes, too long); space placement (inside word, at a gap → Ignored, gap result → Ignored); swap shape (square, S, mirrored, reversed, two strokes, wave → no, strike → no, two lines pass → no); `swapText` (punctuation slots, capitals on/off/not available, "I", all caps, separator with two spaces); classification (stroke consumed once, order, locked box); `swapCompose` (each row of the "allowed" table, each conflict 1–5, point changes at `a0`, in the gap and at `b1`, edits in A and B together, capitals decided on the edited parts).

## 9. Still open (small; defaults chosen, change if wrong)

1. **Gap insertions and locked fonts:** assumed *not* locked (they place nothing inside a box). Alternative: lock them when the box above is locked (its style and height measurement come from there).
2. **Point changes at a swap edge:** stay in place (don't travel). Alternative: travel with the word they touch — but in the gap that's ambiguous (end of A or start of B?), so staying is the only rule without guessing.
5. **Later, if ever:** a swap of two parts with text between them that stays ("red **and** blue" → "blue and red") would need a different mark (two loops + arrow, say). Not planned.
3. **Cross position:** anywhere within reach of the tip (§4.1). Alternative: only above a ∧ / below a V (stricter, fewer false hits).
4. **Thresholds** (sizes, 0.15/0.35 line-height bands, 45–135°) are first guesses; tune from device diagnostics in M3/M4.

## As built

- **Commits**: font rule + one measurement per textbox; character edges (native); swap, space and
  the paragraph step's second upright together (they share the shape-mark stage). 232 → 275 Jest
  tests (`swapSpaceMarks.test.ts`, `textOffsets.test.ts`, assembly and Select mark cases).
- **Measurement** (`actions/markerMeasure.ts`): `createTextboxMeasurer` caches one measurement
  per textbox for the preview; `analyzeDeleteMarker`, `locateMarkOnPage` (carets, paragraph
  marks, tagged insertions) and the shape marks all use it. A locked textbox gives a delete mark
  the font reason (`fontLocked` on its result, so a tagged replacement on it says so too) and a
  caret target `unclear` with the font reason. The status line is `fontWarning` (kept as the
  field's name) built by `buildLockedFontsMessage`; the old "positions may be wrong" warning is no
  longer shown in the review.
- **Character edges**: `charEdges` per word from `TextboxMetricsModule.kt`; `CaretTextbox.words`
  carry them as `edges` (page x); `charPositionInWord` (`domain/textOffsets.ts`) is used by the
  caret placement and the swap's places. Edges that don't fit the word (count, order) fall back
  to the average width.
- **Shape marks** (`actions/shapeMarks.ts`, replaces the paragraph loop of `editMarkers.ts`):
  reads every stroke's points once, then paragraph marks, spaces, swaps, in that order. Used
  strokes are kept out of the delete analysis and out of replace marks' verticals and loops.
- **Paragraph step** (P1): `analyzeStepMark` reads falling steps too; on its own in the review a
  step needs `isSecondUpright` (both strokes are consumed). Before tagged text a step works with
  or without it: `findCaretInWindow` and `readDeclaredMark` take a second upright along as part of
  the mark. A bare step that is no swap piece is Ignored with `BARE_STEP_REASON`.
- **Space**: one-stroke ∧/V, or two strokes meeting at the tip (only strokes of a caret's size are
  paired), with `findCrossAtCaret` (2–4 legs crossing at ≥ 45° within max(40 px, 1.5 × caret size)
  of the tip). A caret whose tip isn't on a textbox is left alone (it may be a "v" in
  handwriting). Kind `space`, a zero-length range with `' '`; edge nudges work as for insertions.
- **Swap shapes** (`domain/swapMark.ts`): `pieceOnLine` reads a stroke against one line (runs
  above/below ±0.2 line heights, reaching ±0.3; tiny end runs are the outer verticals' tips). Two
  runs with at least one outer vertical = the whole one-line mark; two runs without = the middle
  piece; one run with a vertical crossing the line's middle at its left = start corner, at its
  right = end corner; one run alone = a plain line. `pairSwapPieces` pairs a middle piece with the
  nearest matching corners in reading order (same textbox, same orientation); its runs must reach
  past the word on each side (≥ 60 px). Plain lines between the swap's first and last line are
  consumed with a swap drawn in pieces, without a side check. Overlapping swaps are both refused.
- **Places**: `offsetAtX` snaps to word edges within 0.6 characters, else cuts inside the word
  (the swap gets "Check place"); `swapZones` takes the spaces off both parts' ends and refuses a
  swap over a paragraph end.
- **Text** (`domain/swapText.ts`): `composeSwap` zones every other change of the textbox; inside
  A, the gap or B it is made first (edge insertions stay outside or in the gap), a change over an
  edge or a paragraph break inside is a conflict (the swap goes to Ignored, the change stays), a
  part left empty is a conflict, a pen edit inside that isn't ready makes the swap wait
  (`swap.waitingFor`, not applied, its strokes stay). The assembly tags ranges with their
  operation (`TaggedRange`) to replace the inner ones by one range `[a0, b1)`; inner operations get
  `insideSwap`. Swaps take no edge nudges.
- **Review**: rows "Swap" and "Space"; the detail area shows the new order and "Fix capitals"
  (`SwapOptions`, kept while the review is open) when it applies, or that the swap waits. Swaps and
  spaces can be dropped like other plain marks. Refused swap pieces and bare steps are listed (and
  droppable) only when they lie on a textbox.
- **Device round 1** (page with three swaps, diagnostics of 2026-11-20): only the one-line swap
  worked. Four causes, fixed in the fourth commit:
  1. A start corner drawn just above a paragraph was tried against the textbox before it first,
     read there as a plain underline, and the search stopped. `placeSwapPiece` now tries every
     near textbox; a real piece wins over a plain line, then the textbox the stroke's middle is in.
  2. The zones were taken from the line's band (48 px, with the line spacing), so a corner's
     upright reaching the top of the small letters didn't count. The text was in the right place
     (baselines and word edges match the screenshot within 1–3 px); the band was the wrong ruler.
     Shapes are now judged against the letters (`letterZone`): above the small letters, below the
     baseline, uprights crossing the small letters' middle. The native measurement gives the
     x-height and cap height (`getTextBounds`), with 0.53 / 0.73 of the font size as fallback.
     An upright is measured from the corner where the line turns (`uprightAt`).
  3. The middle piece and the end corner drawn in one stroke (‾|___|) was read as a one-line
     swap. A one-line mark with only one outer upright now joins the matching corner before
     (right upright) or after (left upright) it, when there is one.
  4. Unused swap pieces fell through to the delete analysis and became deletes. Refused pieces
     are now always kept out of it (reported only when they lie on a textbox). Plain lines are
     still left to it: a strike through one line is also a "line" below the line above.
  The page is a test fixture (`__tests__/fixtures/swap-page-2026-11-20.json`: textbox 3 as
  measured, textbox 4 laid out from the screenshot, strokes traced along their recorded bounds).
  The < / > test for "tip between two lines" still uses the band; unchanged, as it was
  device-tested good.
