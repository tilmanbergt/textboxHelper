# Technical design: fine marks — letters, spaces, punctuation, "Insert right here"

Status: built (see As built); device test open. The full design with every rule and example table
was agreed in the claude.ai project (`claude/technical-design-fine-marks.md`, 2026-11-20/22);
this is its record in the repository. Builds on `technical-design-swap-space-marks.md` (font rule,
character edges, shape-mark step), `technical-design-paragraph-marks.md` (gap insertion, reflow),
`technical-design-pen-edits-2.md` (one button, Select mark, edge nudges) and
`technical-design-mark-help.md` (pictures).

## 1. Requirements as decided (Tilman)

- **Verticals mean an exact place.** A strike with two short verticals works letter by letter:
  with tagged text it replaces exactly what is between them, without text it deletes exactly that.
  A plain strike and a strike with a loop stay word-level; the loop keeps the number.
- **Slash through one letter:** deletes it, or with tagged text replaces it. A slash on a space is
  ignored.
- **Close-up arc** ‿ or ⁀ under or over one word gap removes the space; the arc opens toward its
  line. One gap per arc. Punctuation at the gap goes only when the review's "Also remove" is
  ticked. At a line end the arc is drawn twice (end piece, start piece); drawn after the last word
  of a paragraph and before the first word of the paragraph directly below, the two arcs join the
  paragraphs (one space between; none when the dash is removed).
- **Punctuation circle:** a ∧ or V with a filled circle between its legs puts in the mark drawn
  inside, with no tagging. The plugin reads it from a small set (`, ; . : ' -`); what it can't
  read waits for a quick pick (also `?`), so a letter never goes in. (Asking the handwriting
  recognizer was planned as a fallback; see As built.) Quotes, `!`, brackets and the
  typography settings (quotation-mark style, apostrophe) are a later step (P2).
- **Circles on marks:** empty, the number goes in it (at a vertical, a slash, between a caret's
  legs); filled, it is content (the punctuation circle).
- **Spaces:** a caret in a gap adds words with spaces, between letters letters without; replacing
  or deleting never adds a space and never glues two words together; only the space mark, the
  close-up arc and a hyphen put into a gap change spaces between words; punctuation spaces by its
  type. A stray comma left by a word-level strike stays (the edge nudge takes it).
- **Insert right here:** tagged text without a usable mark (no mark, or a caret whose place is
  unclear) goes in as a new paragraph where its handwriting starts; a little overlap with the
  paragraph above is tolerated; over text or beside a paragraph it is ignored with the reason;
  with no paragraph near, a new textbox at the handwriting (nearest textbox's style, else the
  system font at 36). Offered on the tag's card and under "Needs attention".

## 2. Design (as built)

**Pure logic (`src/domain/`)**

| File | What |
|---|---|
| `exactBounds.ts` | A vertical's x → character offset (snap to a word edge within 0.5 characters), the exact span between two verticals, the character under a point, the "bigg[er]" snippet. |
| `slashMark.ts` | Slash shape (short, steep, straight), its rect test for the look-back, its place on a measured line. |
| `closeUpMark.ts` | Arc shape (flat chord, one-sided sag, the bend spread out — not a caret's tip), its line by its opening, the gap / end piece / start piece it marks, the punctuation the toggle may take. |
| `paragraphJoin.ts` | The joined text of two paragraphs, the dash the toggle may take. |
| `punctMark.ts` | The circle in a caret's opening and the strokes inside it, the plugin's reading of them. |
| `punctText.ts` | Where a punctuation mark goes and with which spaces, by its type. |
| `insertHere.ts` | Where "Insert right here" puts text: a gap, a new textbox, or unclear. |
| `markerText.ts` | `withSpacesKept`: after a range that removed a space, one is put back where two words would meet (ranges marked `joins` are exempt). |
| `markerAssembly.ts` | Close-ups (with their conflicts), punctuation (placed when assembled, so a quick pick re-places it), joins (the lower paragraph's text into the upper one, the lower one emptied), the row options. |
| `penEditPairing.ts` | Look-back of 4 strokes: the user's number circle at the right vertical, the slash as a replace mark. |
| `penEditModel.ts` | `placement: 'here'`, the replace mark's `bounds`, `slash`, `numberRect`. |

**Flows**

- `actions/shapeMarks.ts`: after the paragraph marks, each ∧/V is checked for a circle between its
  legs (filled: punctuation; empty: an ordinary caret) before the space mark's cross; after the
  swap come the close-up arcs (pieces paired into wrap close-ups and joins) and the slashes (with
  their own number circle). A circle the plugin can't read waits for the user's pick.
- `actions/markerPageAnalysis.ts`: two verticals give an exact range (character edges of the
  struck words); a strike with verticals and no text deletes exactly; the user's number circle at
  the right vertical is consumed with the mark.
- `actions/penEditReview.ts`: insertions with `placement: 'here'` are placed by `insertHere.ts` as
  gap insertions; a new textbox is a gap insertion with a gap of no height at the handwriting's top.
- `actions/penEditTag.ts`: slash and number circles in the look-back; the number goes in the user's
  circle (or a ring above the slash); Select mark reads a slash too and clears `placement`.
- Review UI: "Also remove" on close-ups and joins, quick picks on punctuation rows and on tagged
  text recognized as one or two characters, "Insert right here" on the card and under "Needs
  attention".
- Help: five new pictures (`replace-letters`, `slash`, `punctuation`, `close-up`, `close-up-wrap`);
  overview rows are 46 dp so all 13 marks fit one overview page on the A5 X.

## 3. Tests

`__tests__/domain/fineMarks.test.ts` (shapes, places, spaces, look-back, model, the §2.5 example
rows of the project design) and `fineMarksAssembly.test.ts` (close-up, conflicts, swap gap,
punctuation picks and refusals, joins, new textbox). The help-page tests follow the new count.

## 4. Device test (open)

1. Exact verticals around "er" in "bigger" (+ "est", and alone); around "big " (no glued words).
2. Slash through a letter and a comma; slash + "ds"; slash through a space (ignored).
3. Own circles: above the right vertical, above a slash, between a caret's legs — number inside.
4. Close-up ‿ and ⁀; over two gaps (ignored); "Also remove"; two arcs at a line wrap; join of two
   paragraphs, with a hyphen.
5. Punctuation circle: each of `, ; . : ' -` in a V and a ∧; a letter in the circle (Check, not
   applied); `?` by quick pick; replace "," by ";" (slash + circle).
6. Insert right here from the card and from "Needs attention": between paragraphs, overlapping a
   little, over text, beside, on an empty area (new textbox).
7. Tag right after an arc (not a caret), after a slash (a replacement), after a punctuation circle
   (no mark).
8. Help: the overview on one page, the five new pictures.

## As built

Differences from the project design, decided while building:

- **Caret edge snap** was already built at 0.6 characters (`WORD_EDGE_SNAP_CHARS`); kept. Exact
  verticals snap at 0.5.
- **Tidy-up** is the existing one: double spaces collapsed, no space before `, . ; : ! ?`, none after
  `( [ {`. It does not touch `) ] } »`; left as it is.
- **The plugin's ring for two verticals** stays where it was (centred above the verticals); the
  slash's ring sits above its top.
- **No recognizer for unclear circles** (Tilman): asking it while the page is read would slow the
  page down. A circle the plugin can't read is a "Check" row that waits for a quick pick; `?` is
  only a quick pick. If the device test shows many unread circles, the plugin's own reading is
  tuned first; recognizing in the background (like tagged text) is the later option.
- **Comma–apostrophe tie:** the place alone decides (between letters → `'`, else `,`); "after a
  word ending in s" was dropped ("Yes, I" is far more common). The row is marked Check either way.
- **Slash in the look-back** only when it is the newest stroke (or right before its own circle),
  never while a strike in the window is crossed by another stroke (an unfinished replace mark), and
  a caret wins over a slash-sized leg. A slash never ends the reads early.
- **Join** needs no new apply code: the lower textbox's text becomes empty, and apply removes an
  emptied textbox as before.
- **P2** (typography settings; quotes, `!`, brackets in the circle) is not built yet.
- Thresholds (arc sag and roundness, slash size, circle size and closure, punctuation features,
  the 5-character reach of an arc, Insert-here tolerance and the 300 px "beside") are first guesses
  to be tuned from device diagnostics: every reading is logged (`closeUpArc`, `slash`,
  `punctuationMark`).
