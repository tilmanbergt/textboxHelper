import {cloneRect} from './geometry';
import type {EditMarkerApplyPlan} from './markerTypes';
import type {TextboxActionKind} from './textboxActionKinds';
import {DEFAULT_FONT_SIZE, type Rect, type TextElementData} from './textboxModel';

/**
 * The backup written before every change: the original textboxes as JSON, and the summary that
 * goes to the clipboard.
 */

/** One original textbox in a backup. */
export type BackupText = {
  uuid: string;
  numInPage: number;
  layerNum: number;
  textContentFull: string;
  textRect: Rect;
  fontSize: number;
  fontPath: string | null;
  textAlign: number;
  textBold: number;
  textItalics: number;
  textFrameWidthType: number;
  textFrameStyle: number;
  textEditable: number;
};

/** Backup of a textbox action (split, join, clean, …). */
export type TextboxBackupPayload = {
  action: TextboxActionKind;
  createdAt: string;
  notePath: string;
  page: number;
  selectedCount: number;
  texts: BackupText[];
};

/** Backup of applying edit markers. */
export type EditMarkerBackupPayload = {
  action: 'edit-markers';
  createdAt: string;
  notePath: string;
  page: number;
  selectedMarkerCount: number;
  recognizedOperationCount: number;
  texts: BackupText[];
};

export type BackupPayload = TextboxBackupPayload | EditMarkerBackupPayload;

export const CLIPBOARD_PREVIEW_LIMIT = 3000;

export function buildClipboardSummary(payload: BackupPayload): string {
  const lines = [
    `textboxHelper ${payload.action} backup`,
    `Created: ${payload.createdAt}`,
    `Note: ${payload.notePath}`,
    `Page: ${payload.page}`,
  ];
  if (payload.action === 'edit-markers') {
    lines.push(
      `Selected markers: ${payload.selectedMarkerCount}`,
      `Recognized operations: ${payload.recognizedOperationCount}`,
    );
  }
  lines.push('');

  payload.texts.forEach((text, index) => {
    lines.push(`#${index + 1}`);
    lines.push(text.textContentFull);
    lines.push('');
  });

  return lines.join('\n').slice(0, CLIPBOARD_PREVIEW_LIMIT);
}

export function createBackupPayload(
  action: TextboxActionKind,
  notePath: string,
  page: number,
  elements: TextElementData[],
): TextboxBackupPayload {
  return {
    action,
    createdAt: new Date().toISOString(),
    notePath,
    page,
    selectedCount: elements.length,
    texts: elements.map(element => ({
      uuid: element.uuid,
      numInPage: element.numInPage,
      layerNum: element.layerNum,
      textContentFull: element.textBox.textContentFull || '',
      textRect: cloneRect(element.textBox.textRect),
      fontSize: element.textBox.fontSize || DEFAULT_FONT_SIZE,
      fontPath: element.textBox.fontPath,
      textAlign: element.textBox.textAlign ?? 0,
      textBold: element.textBox.textBold ?? 0,
      textItalics: element.textBox.textItalics ?? 0,
      textFrameWidthType: element.textBox.textFrameWidthType ?? 0,
      textFrameStyle: element.textBox.textFrameStyle ?? 0,
      textEditable: element.textBox.textEditable ?? 0,
    })),
  };
}

export function createEditMarkerBackupPayload(plan: EditMarkerApplyPlan): EditMarkerBackupPayload {
  return {
    action: 'edit-markers',
    createdAt: new Date().toISOString(),
    notePath: plan.notePath,
    page: plan.page,
    selectedMarkerCount: plan.selectedMarkerCount,
    recognizedOperationCount: plan.operations.length,
    texts: plan.textMutations.map(text => ({
      uuid: text.uuid,
      numInPage: text.numInPage,
      layerNum: text.layerNum,
      textContentFull: text.originalText,
      textRect: cloneRect(text.textRect),
      fontSize: text.fontSize,
      fontPath: text.fontPath,
      textAlign: text.textAlign,
      textBold: text.textBold,
      textItalics: text.textItalics,
      textFrameWidthType: text.textFrameWidthType,
      textFrameStyle: text.textFrameStyle,
      textEditable: text.textEditable,
    })),
  };
}
