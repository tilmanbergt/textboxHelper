# Technical design: the edit-marker help with pictures

Status: built on `feature/swap-space-marks`, together with the swap and space marks it shows.
Mockup: design canvas "Textbox Tools – Marks help" (claude.ai).

## 1. Requirements (Tilman)

- The review's help shows a picture of every kind of mark: the marked text and the text after
  Apply. Hand-drawn look, but clean.
- The pictures come from a generic source that is easy to change, not from hand-made images.
- What Textbox Tools puts on the page (the numbers) is shown so that it's clear you don't write
  it, the same way in every picture.
- The help starts with a cheat sheet: every mark named, with its shape, in one list. Then the
  marks with the full pictures, how to draw them and the limits that matter (simple, not every
  rule). Then the review. No scrolling, as everywhere.
- Same approach as Kept GTD: PNGs committed, bundled into the plugin as data URIs.

## 2. Pipeline

Kept GTD renders Mermaid/HTML sources with Playwright, commits the PNGs and a manifest, and
`gen-bundled-content.mjs` writes data URIs into a generated TS module. Our pictures are text and
pen strokes only, so no browser is needed:

| File | Role |
|---|---|
| `docs/user/marks/marks.mjs` | The spec: per mark id the `before` lines, the pen `marks` (strike, loop, verticals, caret, sideways, step, swap, write) placed by word index, the `after` lines with `**bold**` for new text. A changed sample text moves the marks with it. |
| `scripts/lib/markDrawing.mjs` | Pure: lays the text out (opentype.js, Noto Sans; handwriting in Caveat), draws the marks as polylines with a small seeded wobble (same picture on every run), returns SVG. `drawMark` = full picture, `drawMarkIcon` = the mark on its textbox, cropped, without handwriting or numbers. |
| `scripts/lib/markSpec.mjs` | Pure: spec problems, a hash per entry (spec + drawing code, CRLF-safe), problems of the committed pictures. |
| `scripts/lib/pngGray.mjs` | From Kept GTD: re-encodes as 8-bit greyscale. |
| `scripts/marks.mjs` | `npm run marks`: draws changed entries with `@resvg/resvg-js` to `docs/user/images/marks/<id>.png` (960 px wide) and `<id>-icon.png` (75 %), writes `manifest.json`. `--check` (in `npm run check`) needs no dev dependencies. |
| `scripts/gen-mark-images.mjs` | postinstall and `npm run check`: `src/ui/generated/markImages.ts` with `{picture, icon}` data URIs and sizes. Gitignored, not linted. |

Findings: opentype.js's shaping and `toPathData` produce `NaN` for some ligatures and values, so
glyphs are drawn one by one and path data is written by `markDrawing.mjs` itself. Fonts come from
pinned `@fontsource` dev dependencies, so the result doesn't depend on installed fonts.

## 3. The pictures

- "Marked" label, the textbox in a dashed grey frame, the pen marks in black, tagged handwriting
  below; a grey arrow; "After Apply" and the result, new text in bold, a split paragraph as two
  frames.
- **Numbers placed by Textbox Tools are grey** (#7a7a7a): in the replace circle, between the
  caret's legs, beside `<`/`>`, the circled number left of tagged text. A picture with numbers has
  the key "① placed by Textbox Tools" top right; the overview explains it once.
- The shapes follow the recognizers: the replace circle above the strike's end; the space cross
  inside the caret near its tip (`spaceMark.ts`: within 40 px); the step mark with its second
  upright 13 px beside it (`paragraphMarks.ts`: 3–32 px).
- Sizes: 960 px wide pictures, shown at 0.5 dp per px (the sample text at 17 dp, as body text),
  at most 480 dp; icons scaled into a 150 × 52 dp box. About 140 KB of PNGs for 8 marks.

Marks: delete, replace (circle variant; the verticals are named in the text), insert, space,
swap, break at a word (step + second upright), break between lines (`<`), new paragraph (`>`
between textboxes + tagged text).

## 4. The help screen

`ScreenFrame`'s `help` takes `{title, text}` (HelpOverlay, unchanged for the other screens) or
`{title, marks: true}` → `ui/MarkHelp.tsx`, the same layer with fixed pages:

1. **Marks at a glance**: per mark a row (icon, name, one grey line on the shape, "+ text" when
   tagged text is needed, "p. n ›"; a tap jumps there), then two keys ("+ text", grey ①).
2. **Each mark**: name, picture, "Draw:" and "Keep in mind:" with one or two points.
3. **Review and apply**: short blocks (from where, tagged text, no mark found, one character,
   Ignored/Drop, Apply, font and calibration).

Words: `domain/markHelp.ts` (`MARK_HELP`, `MARK_HELP_KEYS`, `REVIEW_HELP`); the old
`EDIT_MARKERS_HELP` text is gone. Pages: `domain/markHelpPages.ts` packs for the measured box
with estimated text heights (generous average character width), two marks per page where they
fit; a picture too tall for a page alone shrinks (not below 80 dp); a low box (landscape) splits
the overview. The header is `PageHeader` with "n / N" and ‹ ›; a page change requests an e-ink
refresh.

## 5. Tests

- `scripts/test-marks.mjs`: the spec has no problems; spec problems; hash (incl. CRLF); manifest
  problems; greyscale PNG round trip.
- `__tests__/domain/markHelpPages.test.ts`: line estimate, order and completeness, no page taller
  than the box (portrait, landscape, narrow), shrinking, `pageOfMark`.
- `__tests__/ui/markImages.test.ts`: help entries and bundled pictures name the same marks.
- `__tests__/ui/MarkHelp.test.tsx`: renders the overview for an A5 X box, pages on, a row jumps
  to its mark.

## 6. Device check

- The help opens from the review's "?"; the overview fits without clipping; icons and pictures are
  sharp; grey numbers readable.
- ‹ › and the rows' jumps; e-ink redraws on every page change.
- Landscape: the overview splits, nothing is cut off.

## 7. Later

Run the spec's strokes through the real recognizers, so a picture can't show a shape the plugin
refuses (needs the strokes in page pixels with the word boxes from the layout).
