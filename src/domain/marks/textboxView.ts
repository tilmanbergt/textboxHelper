import type {Rect} from '../textboxModel';

/**
 * The input of pass 2 (technical-design-mark-dialogue.md §2.4): every textbox of the page as the
 * review measured it. Measuring is native and stays in `actions/` (`markerMeasure.ts`, once per
 * textbox and review); pass 2 gets plain views.
 */

/** A textbox's measured lines and words in page pixels (the shape every placing works on). */
export type CaretTextbox = {
  uuid: string;
  numInPage: number;
  rect: Rect;
  text: string;
  lines: Array<{
    index: number;
    start: number;
    end: number;
    top: number;
    bottom: number;
    /** Page y of the line's baseline, when measured. */
    baseline?: number;
  }>;
  /** Height of small letters in pixels, when measured. */
  xHeight?: number;
  words: Array<{
    start: number;
    end: number;
    lineIndex: number;
    left: number;
    right: number;
    /** Page x of each character's edge, when the native measurement gave them. */
    edges?: number[];
  }>;
};

export type TextboxView = {
  uuid: string;
  numInPage: number;
  rect: Rect;
  text: string;
  /**
   * False until the review measured it: pass 2 then says it wants it (`PageResult.wanted`) and is
   * run again with it measured, so only the textboxes near a mark are measured.
   */
  measured: boolean;
  /** Lines and words from the native measure; null when not measured or the measure failed. */
  layout: CaretTextbox | null;
  /** False when the font fell back to the standard font: its words were measured in the wrong font. */
  fontReadable: boolean;
  /** Why a mark on it can't be placed, when its font can't be read. */
  lockedReason?: string;
};
