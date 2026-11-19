# Technical design: paragraph marks (split and insert paragraphs)

Status: built, device test pending (2026-11-19). Builds on pen edits (technical-design-pen-edits.md) and the
insertion caret (As built there).

## Goal

Hand-drawn marks that change the paragraph structure, with one clear meaning each:

| Mark | On its own (edit-marker review) | Before a tagged Insertion (its caret) |
|---|---|---|
| V, ∧ | ignored | text goes in between words or inside a word |
| <, > | splits the paragraph at a line boundary | text becomes a paragraph at a line boundary |
| step _\|‾ | splits the paragraph at a word gap | text becomes a paragraph at that word gap |

A paragraph is a textbox (imported notes have one paragraph per textbox). Splitting makes
separate textboxes; one textbox with line breaks may become a setting later.

## The marks

### < and > (sideways carets)

- One stroke or two strokes meeting at the tip (as for V/∧). Up to 250 px (V/∧ stay at 130).
- Where the tip points, in order (decided 2026-11-19 with two device pictures):
  1. Above a paragraph's first line or below its last line: before or after the paragraph (no
     distance limit; a small < just under "permission." means after the paragraph).
  2. Within 30 % of a line height of a boundary between lines: a break there.
  3. On an empty line: a break there.
  4. Beside a line that ends a paragraph (its last line, or a line ending in a line break), at least
     20 px past its last word: after that line (the big < far right of "permission.").
  5. Anything else is unclear and goes to Ignored ("point it between two lines"); no further guessing.
- New paragraphs lose empty lines and spaces at their start and end; empty parts are dropped.
- Inner boundary (between line k−1 and line k): split exactly at the start of line k.
- First or last boundary of a textbox (and between textboxes): no split.
  - As caret: the text becomes a new paragraph before or after that textbox (as the gap insertion
    does now).
  - On its own: nothing to do; Ignored ("already a paragraph boundary").
- Which side of the text, and whether < or >, doesn't matter.

### Step mark (_|‾)

- One stroke: a run to the right under a line, straight up, a run to the right above the same
  line. The upright crosses the line it splits; the upright's x is the split place.
- Shape test on the stroke's path: start at the lower left, end at the upper right; lower and upper
  runs roughly level (each spread ≤ 30 % of the mark's height) and going right (≥ 15 px); the
  upright nearly vertical (x spread ≤ max(25 % of height, 20 px)) and covering ≥ 50 % of the height.
  Height 24–160 px, width ≥ 40 px. Thresholds to be tuned on the device.
- Line: the one whose band holds the mark's middle height. Place: the word gap nearest to the
  upright (a word's start; after the last word = start of the next line). A gap at the paragraph's
  very start or end: nothing to split, Ignored.
- As caret: the snippet's number goes right of the upper run's end.

## Mechanism: the split sign

- A split is a zero-length change at the split offset whose text holds a private split sign
  (U+E000): on its own "⁋", with an insertion "⁋text⁋". It goes through the same assembly as
  deletions, replacements and caret insertions in that textbox, so offsets stay right.
- Review: the sign shows as a line break with a ¶, the inserted text in bold.
- Apply: the textbox's new text is cut at the signs into parts (each trimmed, empty parts dropped).
  The first part stays in the textbox (re-measured); every further part becomes a new textbox
  right below it, in order, styled like it (font, size, alignment, frame), with the spacing the
  textbox had to the one below it (8–60 px, else 24 px). Paragraphs below in the same column move
  down by what is needed (reflow as for gap insertions); nothing moves up.
- New textboxes are written into the file last (`PluginFileAPI.insertElements`).

## Where it plugs in

- Domain (`penEditCaret.ts`, `paragraphMarks.ts`): shape tests (sideways size, step), boundary
  location (`locateSideways`), step location (`locateStep`), split sign and part cutting, review
  display text. All pure and tested, with the device cases from pages 26 and 27.
- Tag look-back (`findCaretInWindow`): also tests step marks; a step caret is stored as
  `mark.direction = 'step'` with its tip (upright x, middle height).
- Edit-marker review (`editMarkers.ts`): before the delete analysis, each marker stroke's path is
  tested for < / > and step; a match becomes a `split` operation (or Ignored with its reason)
  instead of a delete candidate. Strokes tagged as an insertion's caret are excluded as before.
- Apply: cutting at split signs, new textboxes, reflow.
- Review screen: "Paragraph break" rows; "Insert N · new paragraph".

## Not in this step

- One textbox with line breaks as an alternative (setting).
- V/∧ on their own.
- Joining paragraphs (a mark to undo a break).

## As built

- `domain/paragraphMarks.ts`: split sign, `analyzeStepMark`, `locateSideways`, `locateStep`,
  `splitParagraphParts`, `showSplits`, `splitChangeText`. `analyzeCaret` tests the step first; V/∧
  are limited to 130 px, < / > to 250 px. `locateCaret` hands sideways carets and steps to these.
- Caret targets gained `split` and `unclear` (with the reason shown under Ignored).
- Review: marker strokes that are a < / > or a step become `split` operations ("Paragraph break")
  before the delete analysis, or Ignored with their reason; V/∧ strokes go on as before.
  Insertions whose caret is a split get insert mode `paragraph`.
- Apply: a textbox's new text is cut at the signs before its height is measured; the further parts
  go through the same placement and reflow as gap insertions (`placeGapParagraphs`, one group per
  split textbox, below the textbox's new rect), and are written into the file last.
- Tests: `paragraphMarks.test.ts` (device cases from page 26: > before line 2, big < in the middle
  of the last line now unclear), assembly tests for a break on its own and a paragraph insertion.
