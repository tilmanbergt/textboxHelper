# Technical design: pen edits — "Replacement" and "Insertion"

Status: in progress on `feature/pen-edits` (P1–P3 built). Built on the calmer-screens code
(`screens/markers/…`, `domain/markerDiff.ts`, `PagedText`).

Reused from Kept GTD (`supernote/lassoRead.ts`, `supernote/strokeRecognition.ts`,
`supernote/markIcons.ts`, `storage/marks.ts` `createMarkFromLasso`, its `index.js` Mark button,
`docs/dev/history/technical-design-lasso-0.8.md`, `docs/dev/supernote-host-facts.md` §6).

## 0. Requirements (agreed with Tilman)

- Replace marks work well, but getting the new text in did not: write `#` + text, lasso, convert
  to text (3–4 s each) breaks the flow. Goal: mark everything in one go, wait once, then review.
- Two lasso commands, **Replacement** and **Insertion**. No `#`, no `+` prefix: the command says
  what the text is. Tagging must stay fast: no recognition and no scan of the page's handwriting.
- Rule: a replacement is written **right after its replace mark**; pairing follows from that.
- The pairing is visible on the page: a small **number** next to the mark and its replacement.
- A **tag icon** (as in Kept GTD) shows that a snippet is tagged and moves with it.
- Storage is a JSON file in the plugin folder plus a **picture** of each snippet, shown beside the
  recognized text in the review.
- Recognition only while a plugin screen is open and the user reads; never while writing (weak
  processor). Corrections by pen, not keyboard. The review can be left and resumed.

## 1. Scope

**In:** the two lasso-toolbar buttons. One tap stores the lassoed handwriting (strokes + picture),
pairs a replacement with the replace mark written just before it, and puts a tag icon and numbers
on the page. The edit-marker review (lasso and page scope) recognizes tagged snippets ahead of the
reader, shows picture + text, lets the user accept, correct (by pen) or skip, and can be left and
resumed. Apply writes replacements into the textbox, inserts insertions as new textboxes, and
removes the snippet strokes, icons, numbers and marks.

**Out (later):** review across pages / the desk (after the layout engine); caret insertions (§8);
recognition outside the review screen; pairing by position; per-change skip for delete marks.

**Unchanged:** delete marks; the `#` textbox path for replacements (still works when a replace
mark has no tagged snippet).

## 2. What Kept GTD already proved (reused, not re-tested)

- **Recognition from stored strokes:** strokes rebuilt with `createElement(STROKE)` at their
  drawn place, `recognizeElements(built, pageSize)` with the real page size from
  `PluginFileAPI.getPageSize`, then recycled. **One recognition at a time.** About 3–4 s per
  snippet, plus 0.3–0.5 s to build the copies. Errors come back as text (e.g. `117: …`).
- **Reading the lasso:** path, page, **picture first** (`generateLassoPreview`; on a cold start
  the host can drop the lasso, error 904), rect, elements, stroke points/pressures, page size.
- **Lasso button without a plugin screen** (`showType: 0`): the listener lives outside App (App
  may not be mounted). `setLassoBoxState(2)` removes the lasso box before the first write. A
  failure opens a small outcome screen; success shows nothing but the icon.
- **Icon in the note:** `createElement(GEO)`, `GEO_polygon`, `userData`, inserted with
  `insertPageElements` (`insertGeometry` can't carry `userData`), one retry after error 105
  (500 ms), then `saveCurrentNote()` (unsaved icons were lost when the note closed). Changed or
  removed only when its `numInPage` is unique on the page.
- **Recognition queue:** selected item first, then the next 3; refills after each result.

## 3. Design

### 3.1 Identity on the page (`domain/penEditTags.ts`)

- Id `pe-YYYYMMDD-HHmmss-NNN`. `userData` `tbh:pe:<id>:<role>`, role `snippet` (tag icon),
  `marknum` (number at the mark), `snippetnum` (number at the snippet).
- **The page is the truth for membership:** an entry belongs to a page when its tag icon is found
  there by `userData`. Erasing the icon drops the entry from the review.

### 3.2 Tag icon and numbers

- Tag icon: 28 px `GEO_polygon` at the top left inside the lasso; a diamond for a replacement, a
  plus for an insertion.
- Numbers: a small textbox (font 20) with the number, `userData` `…:marknum` / `…:snippetnum`,
  right of the strike's end and right of the tag icon. Number = 1 + the highest number of the
  active entries on that page.
- Ignored everywhere: `isNormalTextElement` skips them (by `userData`, and by look: one or two
  digits at font size ≤ 24), so textbox tools and edit markers follow; the export scan skips them
  too.
- Icon and numbers of one tap go in one `insertPageElements` call, then one save. They are found
  again by `userData`, not by uuid (an inserted element's uuid isn't known without a page read).

### 3.3 Storage (`storage/penEditStore.ts`, model `domain/penEditModel.ts`)

```
<plugin folder>/pen-edits/index.json          all entries without stroke data
<plugin folder>/pen-edits/<id>/strokes.json   stored strokes + page size
<plugin folder>/pen-edits/<id>/picture.png    the lasso picture
```

- Entry: id, kind, notePath, page, number, createdAt, lasso rect, stroke uuids, `mark` (`{kind: 'replace', strikeUuid, modifierUuids}` or null; a tagged union so §8's
  caret needs no migration), hasPicture, recognition `{status, text, error, ms}`, correctedText,
  review (`open | accepted | skipped`), state (`active | applied | dropped`).
- One serial write queue; every write reads the file fresh and writes through a temp file.
- Recognition results and review decisions are stored as soon as they exist (resumable review).
- An unreadable index is kept as `index.broken-<time>.json` and a new one started.

### 3.4 Tag flow (`actions/penEditTag.ts`, from `index.js`)

1. Guard against double presses.
2. Read the lasso, picture first (temporary file in the app's document folder).
3. No strokes → outcome "Nothing to tag".
4. `setLassoBoxState(2)`.
5. Replacement: look-back pairing (§3.5).
6. Insert icon + numbers, save.
7. Move the picture into `pen-edits/<id>/`, write `strokes.json`, add the entry.
8. Outcome screen only on failure or when a replacement found no mark.

Every step is timed in the log (`[PenEdit] tag`).

### 3.5 Look-back pairing (`domain/penEditPairing.ts`, reads in `supernote/penEditPageRead.ts`)

- `L` = the lowest `numInPage` of the lassoed strokes; read `L−1` down to `L−8` with
  `PluginFileAPI.getElement` (missing numbers skipped); keep main-layer strokes and straight lines
  that aren't ours; stroke stats for these few only.
- Newest first: a strike (long and flat, or a straight line) crossed by two short vertical strokes
  ≤ `REPLACE_MODIFIER_PAIR_MAX_GAP` apart; strikes already paired with an active entry don't count.
- No textbox measurement, no recognition, no page scan. Whether the strike covers words is
  checked in the review.

### 3.6 Review (P4)

- Active entries on the page (found by their icons); snippet strokes and our elements excluded
  from marker candidates.
- A replace candidate whose strike uuid equals an entry's strike takes the entry's text; otherwise
  the `#` lookup. An entry without its mark on the page → Ignored, with its picture.
- Insertions placed by position (§3.7).
- Recognition queue while the screen is open: selected first, then 3 ahead; results stored at once;
  `cancelRecognize()` on close.
- Placeholder "‹replacement 3 being recognized…›" (diff style `pending`) and the picture beside the
  text. Per pen edit: Accept, Skip (stays for later), Recognize again, Correct.
- "Apply N changes" applies delete marks and ready pen edits; pending, failed and skipped ones stay.

### 3.7 Insertion placement (`domain/penEditInsertion.ts`)

- Above = the last textbox in the snippet's column starting above the snippet; below = the next.
- New textbox: column and style of the one above (else below), top = snippet top.
- An overlap with the one below is a warning in the review; nothing is pushed down yet.

### 3.8 Recognized text and corrections (`domain/penEditText.ts`, P6)

- Lines joined with spaces; a word split with a hyphen at a line end joined; spaces collapsed.
- Correct by pen: a text field with the Supernote handwriting pad, in the upper two thirds; or fix
  the handwriting and tag again. A correction wins over the recognition.

### 3.9 Apply (P5)

Save note; backup including the snippets' stroke data; text mutations as today; insertions as new
textboxes; delete marks, snippet strokes, icons and numbers (unique `numInPage` only); entries →
applied.

### 3.10 Buttons

`BUTTON_ID_TOOLBAR_TAG_REPLACEMENT = 6310`, `BUTTON_ID_TOOLBAR_TAG_INSERTION = 6320`; lasso
toolbar, NOTE, strokes, `showType: 0`.

## 5. Device check (in the P3 build)

1. `numInPage` follows writing order; after erasing and after a lasso move?
2. Snippet + icon + number lassoed and moved: same uuids, `userData` kept on icon and number?
3. Tag time end to end (target < 2 s); the eight `getElement` reads.
4. Number textbox readable; not picked up by the textbox tools or the export.
5. (P6) Handwriting pad in the correction field.

## 6. Steps

| Step | Content |
|---|---|
| P1 | Pure domain: tags, model, pairing, insertion, text + tests; number filter |
| P2 | Ports `lassoRead`, `strokeRecognition`; `penEditElements`, `penEditPageRead`, `penEditStore` |
| P3 | Buttons, tag flow, outcome screen → device check 1–4 |
| P4 | Review: preview merge, recognition queue, placeholder + picture, accept/skip, resume |
| P5 | Apply |
| P6 | Correct by pen → device check 5; As built |

## 7. Open points

- Icon shapes; number size and place (after the device check).
- Unpaired replacement: only Ignored for now.
- Cleanup of applied entries (shared with the backup rule).

## 8. Later: caret insertions

An insertion is placed where a V-shaped caret was drawn just before the text: a ∧ under a line
(insert between two words) or a turned V (`>` / `<`) between paragraphs. The look-back window gets
a second shape test; `mark` gains `{kind: 'caret', …}`; one "Text" button could then replace both.
The caret inside a textbox needs the review's word positions (same font caveat as delete marks);
the caret between paragraphs needs only reading order and could come first.
