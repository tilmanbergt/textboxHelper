import type {PageWordCandidate} from './hitTesting';
import type {TextboxMeasurementCalibration} from './textboxLayout';
import type {PageElementData, Rect, TextElementData} from './textboxModel';

/**
 * Types of the edit-marker recognition: what the preview shows, the plan that is applied, and the
 * stages in between (stroke statistics, delete candidates, replacement lines, text mutations).
 * The candidate types are generic over the element type, so the flow keeps its SDK elements in
 * them while the pure logic reads only what `textboxModel.ts` describes.
 */

export type EditMarkerOperationKind = 'delete' | 'replace';

export type EditMarkerHighlightRange = {
  start: number;
  end: number;
};

export type EditMarkerPreviewBlock = {
  id: string;
  text: string;
  highlightRanges: EditMarkerHighlightRange[];
};

export type RecognizedEditOperation = {
  id: string;
  kind: EditMarkerOperationKind;
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
};

export type IgnoredEditMarker = {
  markerUuid: string;
  markerNumInPage: number;
  summary: string;
  reason: string;
};

export type EditMarkerPreview = {
  selectedMarkerCount: number;
  selectedTextboxCount: number;
  recognizedOperationCount: number;
  selectionMessage: string;
  summaryMessage: string;
  beforePreviewBlocks: EditMarkerPreviewBlock[];
  afterPreviewBlocks: EditMarkerPreviewBlock[];
  beforeBlocks: string[];
  afterBlocks: string[];
  operations: RecognizedEditOperation[];
  ignoredMarkers: IgnoredEditMarker[];
  canApply: boolean;
  applyPlan: EditMarkerApplyPlan | null;
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
  replacementSourceTextboxNums: number[];
  textMutations: TextMutationPlan[];
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

export type ReplacementTextLine = {
  sourceTextboxUuid: string;
  sourceTextboxNumInPage: number;
  sourceLineIndex: number;
  sortTop: number;
  sortLeft: number;
  text: string;
  rawLine: string;
};

export type TextMutationRange = {
  kind: EditMarkerOperationKind;
  start: number;
  end: number;
  replacementText?: string;
};

export type WordCandidate = PageWordCandidate;

export type EditMarkerCalibration = TextboxMeasurementCalibration;
