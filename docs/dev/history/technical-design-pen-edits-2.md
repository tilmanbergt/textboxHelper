# Technical design: pen edits 2 — one button, Select mark, edit in place, edges, Drop

Status: built in two commits (Q1–Q2, Q3–Q6); device test open. See As built. Builds on pen edits
(`technical-design-pen-edits.md`, with the insertion caret in its As built) and paragraph marks
(`technical-design-paragraph-marks.md`). Screens: design canvas "Textbox Tools – Pen edit review".

## 0. Requirements (agreed with Tilman)

- When the mark before tagged text isn't found, the user must never have to write the text again.
  The link between text and mark is what gets redone.
- The note page is where the user writes; the review is where they check and fine-tune. One fix
  per kind of error:

  | What's wrong | Fix |
  |---|---|
  | No mark / wrong mark | **Select mark**: draw or lasso the mark, tap the same button (from the tag card or the review) |
  | Wrong recognized text | **Edit in place** in the review (the Supernote keyboard's handwriting input) |
  | Edges (comma, space, a character) | **Character nudge** of start/end or place in the review |
  | Not wanted | **Drop**, keeping or erasing the handwriting |

- One lasso button, **"Insertion or Replacement"**: the mark decides what the text is.
- The typed `#` replacement lines go. No Accept button: recognized text counts unless skipped.
- Placing a change by touch (tapping words in the review) was considered and rejected: marks are
  accurate at word level; the fine-tuning is at character level.

## 1. Built state before this change (short)

Two lasso buttons "Replacement" (6310) and "Insertion" (6320) chose which mark the look-back
searched for (`findReplaceMarkInWindow` or `findCaretInWindow`); the entry's `kind` came from the
button; a snippet without its mark showed under Ignored with no way to fix it but tagging again.
The review corrected text on a separate screen (`PenEditCorrectionScreen`), removed ignored items
with a second tap ("Remove", "Remove all"), and still read typed `#` lines for replace marks
without a pen edit.

## 2. Scope

1. One lasso button; the mark decides replacement or insertion (§3).
2. Select mark at tag time and from the review (§4).
3. Edit in place; the correction screen goes (§5).
4. Character edges for every change (§6).
5. One Drop with keep or erase handwriting (§7).
6. The `#` path goes (§8).
7. Small: "Check place" for uncertain carets; one snippet badge shape (§3, §9).

**Out:** review across pages / desk; placing by touch; a paragraph option in the review; keeping
the edge nudges of plain marks after the review closes.

## 3. One lasso button

- `BUTTON_ID_TOOLBAR_PEN_EDIT = 6310` (the id is kept), label "Insertion or Replacement"; 6320 is
  no longer registered. `runPenEditTag()` takes no kind.
- The look-back reads the window once and runs both finders. The read still stops once a whole
  replace mark is in it: everything newer was read before, so a newer caret is in the window too.
  `pickNewestMark` (`domain/penEditPairing.ts`): the mark whose newest stroke is newer wins; a
  caret that reuses a stroke of the replace mark (a loop or vertical read as a caret) belongs to
  the replace mark.
- `kindOfMark(mark)` (`domain/penEditModel.ts`): replace → `replacement`, caret (V ∧ < > step)
  → `insertion`, none → `unpaired` (new `PenEditKind`). Unpaired entries show under Ignored as
  "Text N".
- One snippet badge shape (circle). The mark already shows the kind, and a snippet whose mark is
  selected later keeps its badge. Diamonds from earlier builds are still found (by `userData`).
- `PenEditTagOutcome`: `tagged`, `noMark {id, number}`, `markAttached {tagKind, number, fromReview,
  focus}`, `markNotRead {number}`, `empty`, `busy`, `failed`. `presentTagOutcome` hands it to App
  and says whether the plugin view opens.

## 4. Select mark

### 4.1 State

`PenEditEntry.awaitingMark: {since, from: 'tag' | 'review'} | null` (missing in older files →
null). `setAwaitingMark` sets it on one entry and clears it on all others: only one snippet waits,
so the next mark can't be meant for another. `awaitingEntry(index, notePath, page, now)` returns
the active entry of the page whose wait is at most `AWAIT_MARK_MS` (5 minutes) old; later, a tap
on a few strokes is an ordinary tag again.

### 4.2 Tag flow with a waiting entry

After the lasso read (the index is read alongside): with a waiting entry on this page, a lasso of
at most `MAX_DECLARED_MARK_STROKES` (3) strokes, none carrying a pen-edit tag, is the mark
(`attachSelectedMark`); anything else is a normal tag.

- `readDeclaredMark` (pure): the user said it is a mark, so the rules are looser than in the
  look-back. A caret first (one stroke, or two consecutive strokes meeting at the tip), as its shape
  is the more specific; else a replace mark from the widest strike-like stroke, with its loop or up
  to two crossing short lines when present — **the strike alone is enough**. Strokes that belong
  to neither stay out of the mark.
- Found: the mark strokes get the entry's `mark` tag after the lasso settle, the number goes on the
  mark (in the loop, between a caret's legs, in a ring over the verticals, or — for a strike alone —
  in a ring right of the strike's end, so nothing lands on the text), the entry takes `mark`, the
  kind from it, `review: 'open'` and `awaitingMark: null`. The snippet's own files stay as they are.
- Not read: outcome `markNotRead`; the entry keeps waiting.
- Log line `[PenEdit] select mark` with result, mark kind, stroke counts, `fromReview`, ms.
- Review: a replace candidate whose strike is owned by a pen edit whose stored mark has no
  modifiers counts as a replace mark without a loop or verticals (`editMarkers.ts`).

### 4.3 Tag card

`noMark`: "No mark found for text N", with **Fix in review** (closes; the text waits under
Ignored) and **Select mark now** (`startSelectMark(id, 'tag')`, closes). `markNotRead`: what to
lasso, OK. A mark attached from the tag card opens nothing; its number on the page is the
confirmation.

### 4.4 From the review and back

An ignored pen edit's row has **Select mark ›**: `startSelectMark(id, 'review')`, the review
closes. When the mark is attached, `presentTagOutcome` sets the review focus (module state in
`actions/penEditTag.ts`) and the plugin view opens; App opens the review for the whole page with
`focusPenEditId`. The review selects that snippet's change ("Mark found: … is in the changes
now"), or shows the Ignored tab when it still can't be used.

## 5. Edit in place

`PenEditCorrectionScreen.tsx` goes. The selected pen edit's text in the detail area is a pressable
field ("tap to edit"); tapping makes it a `TextInput` (the Supernote keyboard's handwriting input
fills it) with Done and Cancel and the result line. While editing, the textbox pane gives way so
field and buttons sit in the upper part; the keyboard covers the lower third. Done stores
`correctedText` (empty = back to the recognition). The stroke drawing stays only as the fallback
when no picture was kept.

## 6. Character edges

- `EdgeShift = {start, end}` (characters, signed). Pen edits store theirs (`PenEditEntry.edges`);
  plain marks keep theirs in the review's state while it is open.
- `applyEdgeShift(range, shift, textLength)` (`domain/markerAssembly.ts`): start and end move,
  a zero-length range (caret insert, split) moves as one, clamped to the text and to its
  neighbours. A caret insert's joining (spaces) is worked out again at the moved offset.
- Automatic rule first: punctuation right after a struck word stays unless the strike covers it.
- `EdgeControl` in the detail area: the characters around the edge in large type with a bar,
  ‹ › one character per tap; Start and End for deletes and replacements, Place for inserts and
  breaks; a result line.

## 7. One Drop

- Droppable: every pen edit (Changes or Ignored), and plain marks that are removable
  (`removableNums`), in Changes too. Strokes away from every textbox: never.
- Drop turns the detail area's actions into a confirmation (Apply disabled meanwhile): a pen edit
  "Drop, keep handwriting" / "Drop and erase handwriting" / Cancel; a plain mark "Drop and erase
  the mark" / Cancel; "Drop all ignored" with the same choice for the pen edits among them.
- What goes, after a backup: always the entry's badges, numbers and mark strokes (a strike left on
  the page would read as a delete next time); with erase also the snippet strokes; for a plain
  mark its `removableNums`. Only unique `numInPage`, never textboxes. Entries → `dropped`.
- The second-tap arming goes.

## 8. Remove the `#` path

Replace marks without a pen edit go to Ignored ("Replace mark without new text: write the new
words right after it, lasso them and tap Insertion or Replacement"). The replacement-line lookup,
the count mismatch, `replacementSourceTextboxNums` and its exclusions, and the help text go.

## 9. Small items

`locateCaret`'s text target gains `uncertain` (tip between two lines, a snap of more than 0.3
characters, a mark beside the text); the row shows "Check place" and the detail area the reason.

## 10. Tests

Jest (pure): `pickNewestMark`; `readDeclaredMark` (strike + loop, strike + verticals, strike alone,
V, two-stroke <, stray strokes left out, nothing); `setAwaitingMark` / `awaitingEntry` (one at a
time, expiry, other page/note, dropped); `kindOfMark`; parsing entries without `awaitingMark`;
`applyEdgeShift`; the punctuation rule; assembly without `#` lines; `locateCaret` `uncertain`.

Device: see §11.

## 11. Steps and device stops

| Step | Content | Device |
|---|---|---|
| Q1–Q2 | One button; Select mark (model, mark path, tag card, review row, focus) | Tag a replacement and an insertion with the one button; tag without a mark → Select mark now → strike + loop and a caret; Fix in review → Select mark › → the review opens again at the change; a strike alone; a lasso over a textbox (is the button offered?); after 5 minutes a tap is a normal tag |
| Q3–Q6 | Edit in place, edges, Drop, `#` removed | Edit with the keyboard's handwriting input; nudge edges; Drop keep / erase; full review pass |

## 12. Open points

- `showPluginView` from a `showType: 0` button after a successful tag (Select mark from the
  review) — checked on the device in Q1–Q2.
- Whether the button is offered for a lasso that also holds a textbox (`editDataTypes: [0]`).

## As built

- **Two commits**: Q1–Q2 (one button, Select mark) and Q3–Q6 (edit in place, edges, Drop, `#`
  removed). 205 → 229 Jest tests (`penEdits2.test.ts`, `edgeShift.test.ts`, caret "Check place").
- **Look-back with both finders**: the read still stops at a whole replace mark; carets are looked
  for in the same window, so a caret is found only when it is newer than the replace mark (or
  there is none) — which is the rule.
- **Device fix: earlier tagged strokes taken as a caret.** Text tagged right after a text whose
  mark had been selected was paired with that mark's two crossing lines, read as a two-stroke
  caret: no card, and its number landed on the earlier one. The look-back now skips every stroke
  carrying a pen-edit tag (not only badges and numbers) and every stroke at a stored place of an
  active entry (`ownedRects`, `withoutOwned`), and `pickNewestMark` takes a mark only when its
  strokes include the newest stroke of the window — the mark must be the last thing written before
  the text.
- **Strike alone**: a mark selected with Select mark may be a strike without loop or verticals;
  its number goes in a ring right of the strike's end. The review accepts such a strike as a
  replace mark only when its pen edit's stored mark has no modifiers.
- **Review focus** is module state in `actions/penEditTag.ts` next to the tag outcome;
  `presentTagOutcome` decides whether the plugin view opens. App opens the page review with
  `focusPenEditId`; the screen selects that change or shows the Ignored tab and a status line.
- **Edges**: `domain/edgeShift.ts` (`shiftSpans`, `insertModeAt`, `edgeContext`, `coveredSpan`).
  The assembly moves all spans of a textbox together (`shiftedRanges`) and gives every change in a
  textbox an `edgeView` (characters around its edges and the text as it will read). A pen edit's
  nudges are stored 500 ms after the last tap (`setPenEditEdges`); plain marks' live in the hook
  until the page is read again. Word characters for "inside a word" are a plain character class
  (Latin with accents, Greek, Cyrillic): the device's engine may lack Unicode property classes.
- **Punctuation**: `coveredSpan` keeps a trailing `,.;:!?…` run unless the mark reaches past its
  middle, and a leading `(„“"'«` run unless the mark starts before its middle; the width of the run
  is its share of the word's measured width.
- **Check place**: `locateCaret` sets `uncertain` for a tip between two lines (line score ≥ 1) and
  for a snap from more than 0.3 characters inside a word. Sideways carets and steps are not
  flagged.
- **Detail area**: `screens/markers/ChangeDetail.tsx` (picture or stroke drawing, text edited in
  place, edge control, actions, `DropConfirm`). While editing, the textbox text is hidden so the
  field sits at the top; Apply is disabled while editing or while Drop asks.
- **Drop**: `actions/editMarkerDrop.ts`. Ignored rows have Drop (and Select mark › for tagged
  text); a selected change has Drop in its detail area; Drop all (n) heads the Ignored list. A
  backup is written only when handwriting is erased (no textbox text changes when dropping); it
  holds the dropped pen edits and their strokes. `penEditElementNums` gained options: keep the
  handwriting, and take the replace mark (marks always go when dropping).
- **`#` path removed**: `findReplacementLinesForTextbox`, `parseReplacementLines`,
  `ReplacementTextLine`, `replacementSourceTextboxNums` and its deletion at apply are gone.
- **File size**: `actions/editMarkers.ts` was over the 1,000-line rule before this change (1,181
  lines); moving Drop out and removing the `#` path brought it to 1,050. Splitting it further is on
  the backlog.
