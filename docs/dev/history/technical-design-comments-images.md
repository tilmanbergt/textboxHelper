# Technical design: Comments and images (part B), with part C outlined

Status: **design, decisions of §10 taken; ready to build after part A is merged.** Follows part A (`technical-design-mark-dialogue.md`,
S0–S8 on `feature/mark-dialogue`, with §13.4 verticals and §13.5 New text / Marks). Requirements: claude.ai project doc
`claude/requirements-mark-dialogue.md` §2, §3.2, §4.3; mockups: design canvas "Textbox Tools –
Marken-Dialog und Review", artboards 2, 2b, 3, 6, 8, 9. Built on part A (`feature/mark-dialogue` `eb7c60b`). Branch
`feature/comments-images`.

**Guiding rules:** as part A. A comment or image is a **sidemark** (tagged handwriting, today's
`snippet`) that needs no mark. It reuses the pen-edit entry, its tags, its picture and its
recognition; it adds no new store. Pure logic in `src/domain/notes/`, with table tests that
mirror the questions the code answers.

## 0. Decisions (Tilman)

1. **Two lasso entries.** "Insertion or Replacement" (6310) stays: it looks back for a mark.
   **"Comment or Image"** (6320, new) never looks back; a small card asks Comment · Image.
2. When unsure, "Insertion or Replacement" offers Comment · Image on its cards: "No mark found"
   (Select mark now · Comment · Image · Later) and "Not a clear mark" (for the **waiting**
   sidemark, never for the strokes just selected; those stay plain handwriting).
3. Signs on the page: comment = speech bubble with "C", image = a plain double frame.
   **No numbers** (numbers count only links of mark and sidemark).
4. A comment or image **belongs to a paragraph**: by default the nearest by height, worked out
   in the Review; the user can change it (‹ Paragraph above · Paragraph below ›). An image also
   has **before / after** its paragraph (default after).
5. **Notes** tab in the Review (fourth tab, after New text · Marks · To decide): the page's
   comments and images. Notes are not
   edits: Apply leaves them alone.
6. Comment actions: Done ✓ (stays, greyed in the list) · Use as text › (back to "?") · Drop
   (sign removed, handwriting stays). Image actions: Update image · Drop.
7. Comments are **not exported** for now (later maybe a Markdown comment). Images are written
   to the file only in **part C**.
8. In part B comments and images **don't move** with their paragraph (moving strokes needs a
   device check first; part C).
9. Wording: "Image", never "Picture"; German texts say "mit dem Lasso markieren".

## 1. What is there after part A

- Pen-edit entry (`domain/penEditModel.ts`): `kind` replacement · insertion · unpaired,
  `number: number | null`, `strokeRects`, `iconRect`, `hasPicture`, `recognition`,
  `correctedText`, `state`, `confirmed`, …; one index JSON per note (`storage/penEditStore.ts`).
- Tagging (`actions/penEditTag.ts`): lasso snapshot, look-back (pass 1), entry, picture
  (`generateLassoPreview`), tags on the strokes (`tbh:pe:<id>:snippet`), badge polygon + number
  textbox (`snippetnum`), save. Outcome screen `PenEditOutcomeScreen.tsx` (`noMark`,
  `markNotClear`).
- Review: tagged strokes taken out before pass 1; tabs **New text** (tagged texts by their
  number, circled as on the page) · **Marks** (plain symbols) · **To decide** (`noMark` "?"
  items with Select mark ›, Insert right here, Drop; place open; unclear with Ignore and Remove
  strokes); pass 2 works on `TextboxView`s; `domain/reviewLists.ts` builds the tab lists.
- Circles on the page and in New text mean one thing only: the number of a tagged text. The
  comment and image signs must never look like that circle (§3.2).
- Blocks: textboxes carry the block tag `tbt:b:{id,…}` once the Outline or the source link gave
  them one (`domain/blockTag.ts`); the aside area starts at the aside divider
  (`domain/noteRegions.ts`); linked files start at their dividers (`k: 'f'`).

## 2. Data

### 2.1 Entry (`domain/penEditModel.ts`)

- `kind` gains `'comment' | 'image'`.
- New optional `note?: NoteInfo`, only on comments and images:

```ts
type NoteInfo = {
  /** The paragraph the user chose: its block id. Missing: the nearest by height (§4). */
  paragraph?: string;
  /** Images: before or after their paragraph. Default 'after'. */
  place?: 'before' | 'after';
  /** Comments: checked off. */
  done?: boolean;
};
```

- `number` stays `null` for notes. `mark` stays `null`. `state` stays `'open'` (housekeeping
  removes only applied or dropped entries, so notes are kept).
- Parse: an unknown `kind` is read as `'unpaired'` (as today for bad data).
- **Changing the kind** (comment ⇄ "?" ⇄ image) is one entry update plus the sign change on the
  page (§3.3); the strokes' tags stay (`snippet` role), so the Review keeps taking them out.

### 2.2 Paragraph link

- The link is stored **only when the user chooses** a paragraph (‹ ›). Then the chosen textbox
  gets a block id if it has none (`newBlockId`, written with the file API as the Outline's
  status does: `modifyElements` on that one textbox's `userData`, then save).
- Without a stored link the paragraph is computed on every read (§4), so nothing is written
  while reading.
- A stored link whose block is gone (deleted, applied away) falls back to the nearest by height
  and shows "Your paragraph is gone: nearest one shown."

## 3. On the page

### 3.1 Button "Comment or Image" (`index.js`, `domain/buttonIds.ts`)

- `BUTTON_ID_TOOLBAR_NOTE = 6320`; `registerButton(2, ['NOTE'], {…, name: 'Comment or Image',
  showType: 0, editDataTypes: [0]})` like 6310; routed in `initPluginRouting`.
- `runNoteTag()` (`actions/noteTag.ts`, new, ~150 lines; shares the lasso snapshot, picture and
  tag-writing helpers of `penEditTag.ts`, which are moved into `actions/sidemarkWrite.ts` so
  both use them):
  1. Lasso snapshot (strokes, rect), picture — as the pen-edit tag, **no look-back**.
  2. Open the small card (`screens/penEdit/NoteKindCard.tsx`): **Comment** · **Image** ·
     Cancel. The lasso snapshot is kept in memory while the card is open.
  3. On a choice: entry with `kind`, tags on the strokes, the sign (§3.2), save; close the card.
     Cancel: nothing written.
- The same 0.9 s wait after the lasso closes as the pen-edit tag (crash rule in
  `supernote-host-facts.md`).

### 3.2 Signs (`domain/penEditTags.ts`, `supernote/penEditElements.ts`)

- New polygons next to `circlePolygon` / `snippetBadgePolygon`:
  `bubblePolygon(box)` (rounded rectangle with a small tail at the lower left) and
  `framePolygon(box)` (a plain double frame: two nested squares joined, so it differs from the
  ring at a glance; no glyph, so no dependence on the device font). Same size as the badge (`BADGE_SIZE_PX`), same place
  (`snippetBadgeRect`).
- The text inside: comment "C" in the existing number textbox (role `snippetnum`); image: no
  text (the frame alone).
- `looksLikePenEditNumber` accepts "C". The badge role stays `snippet` decoration, so Apply's
  and Clean up's removal of decorations treats them as today; **Apply removes signs only of the
  entries it applies** (check that `markerApply` filters by entry id, as it does for numbers).

### 3.3 From "?" to comment or image, and back

- `convertSidemark(id, kind)` (`actions/sidemarkConvert.ts`): entry `kind` and `number: null`
  (and `note` for notes) first, then the page: the badge polygon replaced (ring ⇄ bubble ⇄
  frame: delete one geometry, insert the other — both found by `userData` on one `getElements`),
  the number textbox's text set ("?" / "C" / removed), save.
- Used by: the "No mark found" card (Comment · Image), the "Not a clear mark" card ("Or keep
  the waiting text as Comment · Image"), To decide's "?" side (Comment · Image), Notes'
  "Use as text ›" (back to "?").

### 3.4 Cards (`PenEditOutcomeScreen.tsx`)

- `noMark`: actions **Select mark now** · **Comment** · **Image** · Later; one line: "Comment
  and Image belong to the paragraph beside them."
- `markNotClear`: below Try again, a group "Or keep the waiting text <handwriting picture> as:
  **Comment** · **Image**". The strokes just selected are not touched.

## 4. Which paragraph (pure, `domain/notes/paragraphOf.ts`)

```ts
type ParagraphCandidate = {uuid: string; blockId: string | null; rect: Rect; region: 'text' | 'aside'; file: string | null};
paragraphOf(note: {rect: Rect; region; file}, candidates: ParagraphCandidate[], storedBlockId?: string)
  → {uuid, blockId, by: 'stored' | 'nearest'} | {none: true; reason}
```

- **Stored** block found → that one.
- **Nearest by height:** among the textboxes of the **same page, same region** (text vs aside,
  `noteRegions.ts`) and, with linked files, the **same file**: the one whose vertical range
  overlaps the note's most; no overlap → the nearest above the note's top (a comment written
  below a paragraph belongs to it); none above → the nearest below.
- Headings count as paragraphs (a comment on a heading is allowed).
- None on the page → `none` ("No paragraph on this page") → To decide (§5.3).
- `neighbours(paragraph, candidates) → {above, below}` for ‹ › (reading order,
  `compareByReadingOrder`), across pages: the last paragraph of the previous page / first of the
  next (read lazily when the user taps past the page edge).

## 5. Review

### 5.1 Reading a page

Notes are sidemarks, so they are already taken out before pass 1. New after pass 2:
`notesOf(page)` (`actions/notesRead.ts`): the entries of kind comment/image on the page, their
paragraph by `paragraphOf` (the `TextboxView`s are there; no measuring needed), and a short
text: the recognized text if there is one, else none.

### 5.2 Notes tab (`screens/manuscript/NotesList.tsx`, `NoteSide.tsx`, `useNotes.ts`)

- Fourth text tab **Notes k** after New text · Marks · To decide (count of the page's comments
  and images; done comments included, greyed); built in `reviewLists.ts` like the others. The page strip counts notes as "· k notes".
- Row: sign (bubble / frame), kind and paragraph ("Comment · ¶ 1", "Image · after ¶ 2"), the
  handwriting picture (small) or its recognized text; done → grey.
- **Comment side** (artboard 8): handwriting large; "Read as …" with **Read** (recognition on
  demand through the existing queue) and Correct; **Belongs to**: page map (part A's `PageMap`,
  the note and its paragraph framed), the paragraph's first words, **‹ Paragraph above ·
  Paragraph below ›**; actions **Done ✓** (toggles) · **Use as text ›** · **Drop**.
- **Image side** (artboard 9): the image (the stored picture); Belongs to with ‹ ›; **Place:
  Before ¶ n · After ¶ n**; a grey line "Written to the file in a later version"; actions
  **Update image** (new picture of the tagged strokes now) · **Drop**.
- Every action writes at once (one entry update; ‹ › also tags the textbox, §2.2); the list
  updates in place. No Apply involved.

### 5.3 To decide

- "?" side gains **Comment** · **Image** (§3.3).
- A note with no paragraph on its page shows under To decide: "Comment without a paragraph"
  with ‹ Paragraph above / below › (from the neighbouring pages) and Drop.

### 5.4 Drop

`dropNote(id)`: the sign (polygon and text) removed, the strokes' tags removed (they become
plain handwriting), entry `state: 'dropped'` (housekeeping removes it later), save. Confirm in
the side panel as pen edits do ("Drop comment? The handwriting stays.").

## 6. Elsewhere

- **Outline:** a block row shows a small "C n" / image count when notes belong to it, for
  **every page of the note**, without reading pages: `paragraphOf` runs over the note entries in
  the pen-edit index (their page and rect from tag time) and the Outline's own scan
  (`ScannedTextBox` with page and rect). A note whose handwriting was moved with the lasso since
  tagging counts by its old place until the Review reads that page (which writes the new place
  to the index); notes with a chosen paragraph are counted by their block id. Moving or setting
  aside a block with notes: the planned line says "Its comments stay where they are (moving them
  comes later)."
- **Clean up:** unchanged; notes stay where they were drawn (as in the Outline).
- **Export / write-back:** comments and images are skipped (handwriting is never exported;
  the entries are not text).
- **Housekeeping:** dropped notes after the usual 3 days; open notes kept.
- **Help:** one help page "Comments and images" (how to tag, the two signs); the cheat sheet
  unchanged.

## 7. Tests (`__tests__/notes/`)

| File | Question | Case shape |
|---|---|---|
| `notes.paragraph.test.ts` | Which paragraph does a note belong to? | `{name, note: rect + region + file, textboxes: [box(…)], stored?, expect: uuid / none}` — overlap, below a paragraph, above the first, between two, heading, aside area, other file, stored link, stored link gone |
| `notes.neighbours.test.ts` | What do ‹ › select? | reading order on a page, across the page edge, aside excluded |
| `notes.model.test.ts` | Do entries parse and convert? | kind round trips "?" ⇄ comment ⇄ image; unknown kind; `note` defaults |
| `notes.signs.test.ts` | Are the signs the right shapes and places? | bubble/frame polygons inside the badge rect, distinct from the ring |
| UI tests | Tabs, rows, sides | as part A's `ReviewTab` tests |

Golden of part A stays unchanged (notes never become changes or To decide marks, except "no
paragraph").

## 8. Steps (one commit each, `npm run check` green)

- **B1 Entry, signs, button.** `kind` comment/image, `note`, bubble/frame polygons,
  `sidemarkWrite.ts` (moved helpers), `noteTag.ts`, `NoteKindCard`, button 6320. *Device: tag a
  comment and an image; signs right; NOTE stays responsive; reopen the note: signs and tags
  there.*
- **B2 Converting.** `sidemarkConvert.ts`; Comment · Image on `noMark`, `markNotClear` and the
  "?" side. *Device: "?" → comment → Use as text (B4) later; the waiting text, not the new
  strokes, becomes the comment.*
- **B3 Paragraph.** `paragraphOf`, `neighbours`, block-id tagging on choice; `notesRead.ts`.
  Table tests. *Device: comments beside, below and between paragraphs; aside area; linked note
  with two files.*
- **B4 Notes tab.** List, comment and image sides, Done, Use as text, Drop, Update image; To
  decide "no paragraph"; Outline counts and the planned-line note; help page; CHANGELOG.
  *Device: the screens of artboards 8 and 9; Apply leaves notes alone.*

## 9. Part C — image file and moving (outline; device checks first)

**C0 device checks** (a short test build or a Diagnostics button):
1. `generateLassoPreview` of tagged strokes: resolution, white or transparent background,
   whether textboxes in the lasso area are drawn too; time.
2. Page render (`generateNotePng`) and crop as the fallback: time on the A5 X.
3. Moving strokes: `modifyElements` with shifted points (or delete + insert with the same
   points and `userData`): do strokes stay intact (pressure, width), keep their tags, survive
   save and reopen; time for ~30 strokes.
4. Does the Supernote Cloud plugin sync PNGs next to the txt into the vault; which folder.

**C1 Image file:** PNG made when the Review shows the image or the write-back needs it (never at
tag time), name `<file> image <n>.png` next to the text file (or a configured attachments
folder), `![[…]]` written before/after its paragraph by the source link / linked files writer;
re-import shows `![[…png]]` as a protected placeholder with the image name; Update image
renders again under the same name; Drop removes the file (with a confirmation).

**C2 Moving:** when an Outline apply or Clean up moves a block, its notes move by the same
offset (same page) or to the target page beside it (other page), using the result of check 3;
notes of a set-aside block go with it into the aside area.

## 10. Decided (Tilman)

- Q-B1: the image sign is the plain double frame (no glyph).
- Q-B2: no shortcut; "Comment or Image" always shows its small card.
- Q-B3: Outline counts for the whole note from the index and the Outline scan (§6), no extra
  page reads.
