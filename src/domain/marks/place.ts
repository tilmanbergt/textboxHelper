import type {CaretInsertMode} from './place/point';

/**
 * The output of pass 2 (technical-design-mark-dialogue.md §2.5): where a reading acts in the
 * text. A part is [start, end); a point has start === end. Pass 2 refuses only for the text (no
 * textbox, two lines, font locked, a slash on a space, a caret pointing at nothing); shape
 * refusals are pass 1's.
 */

export type PlaceAt = {
  uuid: string;
  numInPage: number;
  lineIndex: number;
  start: number;
  end: number;
  /** How an insertion joins the text there, or a paragraph split. */
  mode?: CaretInsertMode | 'split';
  /** A close call worth a look in the review. */
  uncertain?: string;
};

export type Place =
  | ({ok: true} & PlaceAt)
  | {
      ok: false;
      reason: string;
      /** The nearest sensible place, for "place open" (S4); null when there is none. */
      guess: PlaceAt | null;
      /** Whether the reading lies on or over a textbox: an unclear mark rather than handwriting. */
      onText: boolean;
    };
