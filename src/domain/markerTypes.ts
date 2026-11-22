import type {PageWordCandidate} from './hitTesting';
import type {TextboxMeasurementCalibration} from './textboxLayout';
import type {TextSegment} from './textPages';
import type {CaretInsertMode} from './penEditCaret';
import type {EdgeShift} from './edgeShift';
import type {RecognitionStatus} from './penEditModel';
import type {PenEditKind} from './penEditTags';
import type {SwapZones} from './swapMark';
import type {PunctuationChar} from './punctMark';
import type {PageElementData, Rect, TextElementData, TextboxData} from './textboxModel';

/**
 * Types of the edit-marker recognition: what the preview shows, the plan that is applied, and the
 * stages in between (stroke statistics, delete candidates, text mutations).
 * The candidate types are generic over the element type, so the flow keeps its SDK elements in
 * them while the pure logic reads only what `textboxModel.ts` describes.
 */

export type EditMarkerOperationKind = 'delete' | 'replace';

/**
 * What a change in the review does; an insertion comes only from a pen edit. 'split': a paragraph
 * break from a < or > or a step mark with its second upright; 'space': a caret with a cross;
 * 'swap': two parts side by side change places (technical-design-swap-space-marks.md);
 * 'closeUp': an arc removes the space between two words; 'punct': a caret with a filled circle
 * puts in a punctuation mark (technical-design-fine-marks.md).
 */
export type ReviewOperationKind =
  | EditMarkerOperationKind
  | 'insert'
  | 'split'
  | 'space'
  | 'swap'
  | 'closeUp'
  | 'punct'
  | 'join';

/**
 * Two paragraphs joined by two close-up arcs (technical-design-fine-marks.md §7): the operation's
 * textbox is the upper one; the lower one's text is added to it and the lower textbox goes.
 */
export type JoinInfo = {
  belowUuid: string;
  belowNumInPage: number;
  /** The dash ending the upper paragraph, which the "Also remove" toggle takes; '' when none. */
  hyphen: string;
  /** The user's choice in the review: the dash goes and no space is put between. */
  removeHyphen: boolean;
};

/** A close-up's gap, and the punctuation at it the "Also remove" toggle would take. */
export type CloseUpInfo = {
  gapStart: number;
  gapEnd: number;
  /** The punctuation run at the gap: `from`–`to` covers it and the gap; empty text when none. */
  punct: {from: number; to: number; text: string};
  /** The user's choice in the review. */
  removePunct: boolean;
};

/**
 * A punctuation circle: where its caret points, and what was read in it. `char` null: not read
 * (the row waits for the user's pick). 'own': the plugin's reading; 'recognizer': the handwriting
 * recognizer's; 'picked': the user's quick pick.
 */
export type PunctInfo = {
  offset: number;
  mode: CaretInsertMode;
  char: PunctuationChar | null;
  source: 'own' | 'recognizer' | 'picked' | 'none';
  /** The plugin couldn't tell `,` from `'`; the place decided. */
  tie: boolean;
};

/** A swap's parts in its textbox's original text, and how its text is made. */
export type SwapInfo = {
  zones: SwapZones;
  /** Move a sentence's capital to the new first word (the user's choice in the review). */
  fixCase: boolean;
  /** Whether "Fix capitals" applies to this swap; set by the assembly. */
  capsAvailable: boolean;
  /** Set by the assembly when the swap waits for a change inside it (its operation ids). */
  waitingFor?: string[];
};

/**
 * Where a pen edit's text stands in the review (technical-design-pen-edits.md §3.6): recognizing
 * (or waiting for it), ready to apply, or recognized without usable text.
 */
export type PenOperationStatus = 'recognizing' | 'ready' | 'failed' | 'empty';

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
  /** Set for a swap. */
  swap?: SwapInfo;
  /** Set by the assembly for a change made inside a swapped part (the swap's operation id). */
  insideSwap?: string;
  /** Set for a close-up arc. */
  closeUp?: CloseUpInfo;
  /** Set for a punctuation circle. */
  punct?: PunctInfo;
  /** Set for a join of two paragraphs. */
  join?: JoinInfo;
};

export type IgnoredEditMarker = {
  markerUuid: string;
  markerNumInPage: number;
  summary: string;
  reason: string;
  /** Set when the ignored item is a tagged snippet, not a marker stroke. */
  penEditNumber?: number;
  penEditId?: string;
  /** Set for tagged text without a usable mark: "Insert right here" is offered (fine-marks §8). */
  canPlaceHere?: boolean;
  /**
   * The stroke numbers "Remove" deletes for a marker that landed on a textbox (with a replace
   * mark's verticals or loop). Unset for strokes that may be ordinary handwriting: those are
   * never offered for removal.
   */
  removableNums?: number[];
};

/**
 * One change as the review lists it (technical-design-manuscript.md §4.3): the changed text in
 * full, with the text before and after it in its textbox as context.
 */
export type ChangeHunk = {
  operationId: string;
  /** "Delete", "Replace 2", "Insert 3", "Swap", "Paragraph break", "Space", "New paragraph 4". */
  label: string;
  /** The textbox's text before the change, from its start (the list shows its last words). */
  before: string;
  segments: TextSegment[];
  /** The textbox's text after the change, to its end. */
  after: string;
  /** Where it is: "Textbox 4 · line 3", "After textbox 6", with notes like "Check place". */
  meta: string;
};

export type EditMarkerPreview = {
  /** Every change in reading order (domain/markerHunks.ts). */
  hunks: ChangeHunk[];
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
  /** Pen edits still waiting for their text (being recognized, or not recognized). */
  pendingCount: number;
};

/** A pen edit's text as the review knows it. */
export type PenTextState = {
  status: RecognitionStatus | 'recognizing';
  text: string;
  correctedText: string | null;
  /** Character nudges of the change's edges, stored with the pen edit. */
  edges: EdgeShift | null;
};

/** One edge of a change for the edge control: its name and the characters on each side. */
export type EdgePoint = {label: string; before: string; after: string};

/**
 * A change's edges after the nudges (technical-design-manuscript.md §4.4): one (Place), two
 * (Start, End) or three for a swap (Start of A, A | B, End of B), and the text around it as it
 * will read.
 */
export type EdgeView = {
  edges: EdgePoint[];
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
  /** Set for "Insert right here": 'newBox' when it is a new textbox where the handwriting is. */
  here?: 'gap' | 'newBox';
};

/** Everything the review needs that doesn't change while pen edits are recognized or corrected. */
export type MarkerPreviewBase = {
  notePath: string;
  page: number;
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
  /**
   * Set when the range joins two words on purpose (a close-up, a hyphen put into a gap): no space
   * is put back between them (technical-design-fine-marks.md §2.1).
   */
  joins?: boolean;
};

export type WordCandidate = PageWordCandidate;

export type EditMarkerCalibration = TextboxMeasurementCalibration;
