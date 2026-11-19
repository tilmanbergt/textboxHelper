import type {PageWordCandidate} from './hitTesting';
import type {TextboxMeasurementCalibration} from './textboxLayout';
import type {TextSegment} from './textPages';
import type {CaretInsertMode} from './penEditCaret';
import type {EdgeShift} from './edgeShift';
import type {PenEditReview, RecognitionStatus} from './penEditModel';
import type {PenEditKind} from './penEditTags';
import type {PageElementData, Rect, TextElementData, TextboxData} from './textboxModel';

/**
 * Types of the edit-marker recognition: what the preview shows, the plan that is applied, and the
 * stages in between (stroke statistics, delete candidates, text mutations).
 * The candidate types are generic over the element type, so the flow keeps its SDK elements in
 * them while the pure logic reads only what `textboxModel.ts` describes.
 */

export type EditMarkerOperationKind = 'delete' | 'replace';

/** What a change in the review does; an insertion comes only from a pen edit. */
/** 'split': a paragraph break from a < or > or a step mark on its own. */
export type ReviewOperationKind = EditMarkerOperationKind | 'insert' | 'split';

/**
 * Where a pen edit's text stands in the review (technical-design-pen-edits.md §3.6): recognizing
 * (or waiting for it), ready to apply, skipped for later, or recognized without usable text.
 */
export type PenOperationStatus = 'recognizing' | 'ready' | 'skipped' | 'failed' | 'empty';

export type EditMarkerHighlightRange = {
  start: number;
  end: number;
};

export type RecognizedEditOperation = {
  id: string;
  kind: ReviewOperationKind;
  markerUuid: string;
  markerNumInPage: number;
  consumedMarkerNums: number[];
  targetTextboxUuid: string;
  targetTextboxNumInPage: number;
  lineIndex: number;
  summary: string;
  detail: string;
  words: string[];
  replacementText?: string;
  /** Where the operation's first range starts in the textbox's original text (review jumps there). */
  textStart: number;
  /** Set for a change whose new text comes from a tagged snippet. */
  penEditId?: string;
  penEditNumber?: number;
  penStatus?: PenOperationStatus;
  /** An insertion at a caret: how its text joins the words around it. */
  insertMode?: CaretInsertMode;
  /** Set when the caret's place was a close call: why it is worth a look ("Check place"). */
  uncertain?: string;
  /** Set by the assembly for changes inside a textbox: the edge control's view. */
  edgeView?: EdgeView;
};

export type IgnoredEditMarker = {
  markerUuid: string;
  markerNumInPage: number;
  summary: string;
  reason: string;
  /** Set when the ignored item is a tagged snippet, not a marker stroke. */
  penEditNumber?: number;
  penEditId?: string;
  /**
   * The stroke numbers "Remove" deletes for a marker that landed on a textbox (with a replace
   * mark's verticals or loop). Unset for strokes that may be ordinary handwriting: those are
   * never offered for removal.
   */
  removableNums?: number[];
};

export type EditMarkerTextboxPreview = {
  uuid: string;
  numInPage: number;
  segments: TextSegment[];
  changeCount: number;
  /** Header for a textbox that doesn't exist yet (an insertion). */
  title?: string;
};

export type EditMarkerPreview = {
  selectedMarkerCount: number;
  selectedTextboxCount: number;
  recognizedOperationCount: number;
  selectionMessage: string;
  summaryMessage: string;
  /** The affected textboxes in reading order, as diff segments (domain/markerDiff.ts). */
  textboxes: EditMarkerTextboxPreview[];
  /** Set when a textbox font couldn't be read and word positions were measured in a standard font. */
  fontWarning: string | null;
  operations: RecognizedEditOperation[];
  ignoredMarkers: IgnoredEditMarker[];
  canApply: boolean;
  applyPlan: EditMarkerApplyPlan | null;
  /** The analysis the preview is assembled from; re-assembled when a pen edit's text changes. */
  base: MarkerPreviewBase | null;
  /** The pen edits in this review, in list order. */
  penEdits: PenEditView[];
  /** Pen edits still waiting for text, and those skipped for later. */
  pendingCount: number;
  skippedCount: number;
};

/** A pen edit's text as the review knows it. */
export type PenTextState = {
  status: RecognitionStatus | 'recognizing';
  text: string;
  correctedText: string | null;
  review: PenEditReview;
  /** Character nudges of the change's edges, stored with the pen edit. */
  edges: EdgeShift | null;
};

/**
 * Where a change sits in its textbox's text after the edge nudges, with the characters around its
 * edges for the edge control. A zero-length change (insertion, paragraph break) has one place.
 */
export type EdgeView = {
  start: number;
  end: number;
  zeroLength: boolean;
  startContext: {before: string; after: string};
  endContext: {before: string; after: string};
  /** The text right around the change as it will read. */
  result: string;
};

/** A tagged snippet as the review shows it. */
export type PenEditView = {
  id: string;
  kind: PenEditKind;
  number: number;
  pictureUri: string | null;
};

/** A recognized change before its pen-edit text is known: the operation and its text range. */
export type OperationDraft = {
  operation: RecognizedEditOperation;
  range: TextMutationRange;
};

/** An affected textbox as read for the preview (a TextMutationPlan without the new text). */
export type MarkerTextboxBase = Omit<TextMutationPlan, 'nextText' | 'nextTextRect'>;

/**
 * An insertion whose caret is in the space between two paragraphs: a new textbox there, styled
 * like the paragraph above (or below). Its top and the push of the paragraphs below are worked out
 * at apply, once its height is measured.
 */
export type InsertionDraft = {
  penEditId: string;
  number: number;
  left: number;
  width: number;
  style: TextboxData;
  aboveNumInPage: number | null;
  belowNumInPage: number | null;
  aboveRect: Rect | null;
  belowRect: Rect | null;
};

/** Everything the review needs that doesn't change while pen edits are recognized or corrected. */
export type MarkerPreviewBase = {
  notePath: string;
  page: number;
  selectedMarkerCount: number;
  selectedTextboxCount: number;
  drafts: OperationDraft[];
  ignored: IgnoredEditMarker[];
  textboxes: MarkerTextboxBase[];
  insertions: InsertionDraft[];
  penEdits: PenEditView[];
  /** The pen edits' text as stored when the page was read. */
  penStates: Record<string, PenTextState>;
};

/** A ready new paragraph as applied. */
export type InsertionPlan = {
  penEditId: string;
  text: string;
  left: number;
  width: number;
  style: TextboxData;
  aboveRect: Rect | null;
  belowRect: Rect | null;
};

export type EditMarkerPreviewScope = 'lasso' | 'page';

export type StrokeStats = {
  points: Array<{x: number; y: number}>;
  rect: Rect;
  width: number;
  height: number;
  pathLength: number;
  directDistance: number;
  straightness: number;
  angleDeg: number;
  firstPoint: {x: number; y: number};
  lastPoint: {x: number; y: number};
  center: {x: number; y: number};
};

export type TextMutationPlan = {
  uuid: string;
  numInPage: number;
  layerNum: number;
  originalText: string;
  nextText: string;
  textRect: Rect;
  nextTextRect: Rect;
  fontSize: number;
  fontPath: string | null;
  textAlign: number;
  textBold: number;
  textItalics: number;
  textFrameWidthType: number;
  textFrameStyle: number;
  textEditable: number;
};

export type EditMarkerApplyPlan = {
  notePath: string;
  page: number;
  selectedMarkerCount: number;
  operations: RecognizedEditOperation[];
  recognizedMarkerNums: number[];
  textMutations: TextMutationPlan[];
  /** Pen edits applied with this plan (their snippets, icons and numbers are removed). */
  penEditIds: string[];
  insertions: InsertionPlan[];
};

/**
 * Candidate recognized from a horizontal delete-style marker.
 *
 * These candidates are still pre-apply objects: replace detection, range conflict checks,
 * and final mutation planning all happen after this stage.
 */
export type MarkerDeleteCandidate<
  Marker extends PageElementData = PageElementData,
  Textbox extends TextElementData = TextElementData,
> = {
  marker: Marker;
  markerUuid: string;
  markerNumInPage: number;
  markerSortTop: number;
  markerSortLeft: number;
  strokeStats: StrokeStats;
  targetTextbox: Textbox;
  lineIndex: number;
  lineRect: Rect;
  words: WordCandidate[];
};

export type MarkerStrokeAnalysis<Marker extends PageElementData = PageElementData> = {
  marker: Marker;
  strokeStats: StrokeStats;
};

export type TextMutationRange = {
  kind: EditMarkerOperationKind;
  start: number;
  end: number;
  replacementText?: string;
  /** Shown only: a placeholder for a pen edit's text that isn't there yet. */
  pending?: boolean;
};

export type WordCandidate = PageWordCandidate;

export type EditMarkerCalibration = TextboxMeasurementCalibration;
