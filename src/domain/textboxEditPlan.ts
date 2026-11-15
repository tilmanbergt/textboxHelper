import {CLIPBOARD_PREVIEW_LIMIT} from './backupPayload';
import {
  cloneRect,
  intersectionRect,
  rectHeight,
  rectsOverlap,
  rectWidth,
  sortTextElementsByReadingOrder,
} from './geometry';
import {
  cleanupTextboxWhitespace,
  countWords,
  normalizeJoinBoundary,
  removeLineBreaks,
  splitIntoSentenceCandidates,
} from './textSplitting';
import {
  createEmptyAvailability,
  type TextboxActionAvailability,
  type TextboxActionKind,
} from './textboxActionKinds';
import {
  DEFAULT_FONT_SIZE,
  MAIN_LAYER,
  TEXT_TYPE_NORMAL,
  type PageElementData,
  type Rect,
  type TextElementData,
  type TextboxData,
} from './textboxModel';

/**
 * What a textbox action will do, worked out without the device: which actions the selection
 * allows, the before/after preview, the new textboxes' contents and rectangles, and the checks
 * that they fit on the page without covering other elements. Also the texts of "Log All
 * Textboxes".
 */

export type TextboxActionPreview = {
  selectedCount: number;
  beforeBlocks: string[];
  afterBlocks: string[];
  availableActions: TextboxActionAvailability;
  selectionMessage: string;
  hasOnlyTextboxes: boolean;
};

export type PreparedTextInsert = {
  textContentFull: string;
  textRect: Rect;
  fontSize: number;
  fontPath?: string;
  textAlign: number;
  textBold: number;
  textItalics: number;
  textFrameWidthType: number;
  textFrameStyle: number;
  textEditable: number;
};

type TextboxLogItem = {
  page: number;
  uuid: string;
  numInPage: number;
  layerNum: number;
  text: string;
  textPreview: string;
  rect: Rect;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontPath: string | null;
  textAlign: number;
  textBold: number;
  textItalics: number;
  textFrameWidthType: number;
  textFrameStyle: number;
  textEditable: number;
  textLength: number;
  wordCount: number;
  newlineCount: number;
};

const ORDER_GAP_RATIO = 0.25;

const MIN_TEXTBOX_WIDTH = 80;

export function buildTextInsert(base: TextboxData, textContentFull: string, textRect: Rect): PreparedTextInsert {
  return {
    textContentFull,
    textRect,
    fontSize: base.fontSize || DEFAULT_FONT_SIZE,
    ...(base.fontPath ? {fontPath: base.fontPath} : {}),
    textAlign: base.textAlign ?? 0,
    textBold: base.textBold ?? 0,
    textItalics: base.textItalics ?? 0,
    textFrameWidthType: base.textFrameWidthType ?? 0,
    textFrameStyle: base.textFrameStyle ?? 0,
    textEditable: base.textEditable ?? 0,
  };
}

export function isNormalTextElement<T extends PageElementData>(
  element: T,
): element is T & {textBox: NonNullable<T['textBox']>} {
  return (
    element.type === TEXT_TYPE_NORMAL &&
    element.layerNum === MAIN_LAYER &&
    !!element.textBox?.textContentFull &&
    !!element.textBox?.textRect
  );
}

export function sortTextElements<T extends TextElementData>(elements: T[]): T[] {
  return sortTextElementsByReadingOrder(elements);
}

export function ensureClearlyOrderedColumn(elements: TextElementData[]): void {
  const sorted = sortTextElements(elements);

  for (let index = 0; index < sorted.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < sorted.length; compareIndex += 1) {
      const upperRect = sorted[index].textBox.textRect;
      const lowerRect = sorted[compareIndex].textBox.textRect;
      const threshold =
        Math.min(rectHeight(upperRect), rectHeight(lowerRect)) * ORDER_GAP_RATIO;

      const topClearlyAbove = upperRect.top + threshold < lowerRect.top;
      const bottomClearlyAbove = upperRect.bottom + threshold < lowerRect.bottom;

      if (!topClearlyAbove || !bottomClearlyAbove) {
        throw new Error(
          'Selection is not clearly ordered from top to bottom in one loose column.',
        );
      }
    }
  }
}

function getObstacleRect(element: PageElementData): Rect | null {
  if (element.layerNum !== MAIN_LAYER) {
    return null;
  }

  if (element.type === TEXT_TYPE_NORMAL && element.textBox?.textRect) {
    return cloneRect(element.textBox.textRect);
  }

  if (element.title) {
    return {
      left: element.title.X,
      top: element.title.Y,
      right: element.title.X + element.title.width,
      bottom: element.title.Y + element.title.height,
    };
  }

  if (element.link) {
    return {
      left: element.link.X,
      top: element.link.Y,
      right: element.link.X + element.link.width,
      bottom: element.link.Y + element.link.height,
    };
  }

  if (element.picture?.rect) {
    return cloneRect(element.picture.rect);
  }

  return null;
}

export function ensureLayoutFitsPage(
  newRects: Rect[],
  pageWidth: number,
  pageHeight: number,
): void {
  for (const rect of newRects) {
    if (rect.left < 0 || rect.top < 0 || rect.right > pageWidth || rect.bottom > pageHeight) {
      throw new Error('Result would not fit on the current page.');
    }

    if (rectWidth(rect) < MIN_TEXTBOX_WIDTH) {
      throw new Error('Textbox width is too small for a stable split/join result.');
    }
  }
}

export function ensureNoCollision(
  newRects: Rect[],
  pageElements: PageElementData[],
  selectedElements: TextElementData[],
): void {
  const originalSelectionRect = {
    left: Math.min(...selectedElements.map(element => element.textBox.textRect.left)),
    top: Math.min(...selectedElements.map(element => element.textBox.textRect.top)),
    right: Math.max(...selectedElements.map(element => element.textBox.textRect.right)),
    bottom: Math.max(...selectedElements.map(element => element.textBox.textRect.bottom)),
  };
  const selectedUuids = new Set(selectedElements.map(element => element.uuid));

  for (const pageElement of pageElements) {
    if (selectedUuids.has(pageElement.uuid)) {
      continue;
    }

    const obstacleRect = getObstacleRect(pageElement);
    if (!obstacleRect) {
      continue;
    }

    for (const newRect of newRects) {
      const overlapWithNewRect = intersectionRect(newRect, obstacleRect);
      if (!overlapWithNewRect) {
        continue;
      }

      const overlapInsideOriginal = intersectionRect(
        overlapWithNewRect,
        originalSelectionRect,
      );

      if (
        overlapInsideOriginal &&
        overlapInsideOriginal.left === overlapWithNewRect.left &&
        overlapInsideOriginal.top === overlapWithNewRect.top &&
        overlapInsideOriginal.right === overlapWithNewRect.right &&
        overlapInsideOriginal.bottom === overlapWithNewRect.bottom
      ) {
        continue;
      }

      console.log(
        '[TextboxActions] collision',
        JSON.stringify({
          obstacleUuid: pageElement.uuid,
          obstacleType: pageElement.type,
          obstacleRect,
          originalSelectionRect,
          newRect,
          overlapWithNewRect,
          overlapInsideOriginal,
        }),
      );

      if (rectsOverlap(newRect, obstacleRect)) {
        throw new Error(
          'Not enough free space around the selection. Please create more room and try again.',
        );
      }
    }
  }
}

export function buildJoinedTextboxText(elements: TextElementData[]): string {
  const sorted = sortTextElements(elements);
  let combinedText = '';
  for (const element of sorted) {
    combinedText = normalizeJoinBoundary(
      combinedText,
      element.textBox.textContentFull || '',
    );
  }

  return combinedText;
}

function getTextboxText(element: TextElementData): string {
  return element.textBox.textContentFull || '';
}

function computeActionOutputs(textElements: TextElementData[]): {
  beforeBlocks: string[];
  splitBlocks: string[];
  joinBlocks: string[];
  cleanBlocks: string[];
  unwrapBlocks: string[];
  logBlocks: string[];
  availableActions: TextboxActionAvailability;
} {
  const sortedTextElements = sortTextElements(textElements);
  const beforeBlocks = sortedTextElements.map(getTextboxText);
  const availableActions = createEmptyAvailability();

  let splitBlocks: string[] = [];
  let joinBlocks: string[] = [];
  let cleanBlocks: string[] = [];
  let unwrapBlocks: string[] = [];
  const logBlocks = ['Execute to log every textbox on this page.'];

  if (sortedTextElements.length === 1) {
    const sourceText = getTextboxText(sortedTextElements[0]);
    splitBlocks = splitIntoSentenceCandidates(sourceText);
    availableActions.split = true;

    cleanBlocks = [cleanupTextboxWhitespace(sourceText)];
    availableActions.clean = true;

    unwrapBlocks = [removeLineBreaks(sourceText)];
    availableActions.unwrap = true;
  }

  if (sortedTextElements.length >= 2) {
    try {
      ensureClearlyOrderedColumn(sortedTextElements);
      joinBlocks = [buildJoinedTextboxText(sortedTextElements)];
      availableActions.join = true;
    } catch {
      availableActions.join = false;
    }
  }

  return {
    beforeBlocks,
    splitBlocks,
    joinBlocks,
    cleanBlocks,
    unwrapBlocks,
    logBlocks,
    availableActions,
  };
}

export function buildActionPreview(
  lassoElements: PageElementData[],
  action: TextboxActionKind | null,
): TextboxActionPreview {
  const textElements = lassoElements.filter(isNormalTextElement);
  const selectedCount = textElements.length;
  const selectionMessage =
    selectedCount === 1 ? '1 textbox selected' : `${selectedCount} textboxes selected`;

  if (lassoElements.length === 0) {
    return {
      selectedCount: 0,
      beforeBlocks: [],
      afterBlocks: [],
      availableActions: createEmptyAvailability(),
      selectionMessage: '0 textboxes selected',
      hasOnlyTextboxes: true,
    };
  }

  if (textElements.length !== lassoElements.length) {
    return {
      selectedCount,
      beforeBlocks: sortTextElements(textElements).map(getTextboxText),
      afterBlocks: [],
      availableActions: createEmptyAvailability(),
      selectionMessage,
      hasOnlyTextboxes: false,
    };
  }

  const outputs = computeActionOutputs(textElements);
  let afterBlocks: string[] = [];

  if (action === 'split' && outputs.availableActions.split) {
    afterBlocks =
      outputs.splitBlocks.length >= 2 ? outputs.splitBlocks : outputs.beforeBlocks;
  } else if (action === 'join' && outputs.availableActions.join) {
    afterBlocks = outputs.joinBlocks;
  } else if (action === 'clean' && outputs.availableActions.clean) {
    afterBlocks = outputs.cleanBlocks.length > 0 ? outputs.cleanBlocks : outputs.beforeBlocks;
  } else if (action === 'unwrap' && outputs.availableActions.unwrap) {
    afterBlocks = outputs.unwrapBlocks.length > 0 ? outputs.unwrapBlocks : outputs.beforeBlocks;
  } else if (action === 'log' && outputs.availableActions.log) {
    afterBlocks = outputs.logBlocks;
  }

  return {
    selectedCount,
    beforeBlocks: outputs.beforeBlocks,
    afterBlocks,
    availableActions: outputs.availableActions,
    selectionMessage,
    hasOnlyTextboxes: true,
  };
}

// "Log All Textboxes": every textbox of the current page with its rectangle and font size,
// logged and summarized on the clipboard, to check sizes and positions against the device.

export function buildTextboxLogItems(page: number, pageElements: PageElementData[]): TextboxLogItem[] {
  return sortTextElements(pageElements.filter(isNormalTextElement)).map(element => {
    const text = element.textBox.textContentFull || '';
    const rect = cloneRect(element.textBox.textRect);
    const width = rectWidth(rect);
    const height = rectHeight(rect);

    return {
      page,
      uuid: element.uuid,
      numInPage: element.numInPage,
      layerNum: element.layerNum,
      text,
      textPreview: text.slice(0, 160),
      rect,
      x: rect.left,
      y: rect.top,
      width,
      height,
      fontSize: element.textBox.fontSize || DEFAULT_FONT_SIZE,
      fontPath: element.textBox.fontPath || null,
      textAlign: element.textBox.textAlign ?? 0,
      textBold: element.textBox.textBold ?? 0,
      textItalics: element.textBox.textItalics ?? 0,
      textFrameWidthType: element.textBox.textFrameWidthType ?? 0,
      textFrameStyle: element.textBox.textFrameStyle ?? 0,
      textEditable: element.textBox.textEditable ?? 0,
      textLength: text.length,
      wordCount: countWords(text),
      newlineCount: (text.match(/\n/g) || []).length,
    };
  });
}

// "Log All Textboxes": every textbox of the current page with its rectangle and font size,
// logged and summarized on the clipboard, to check sizes and positions against the device.

export function formatTextboxLogPreviewItem(item: TextboxLogItem): string {
  const shortText = item.text.replace(/\s+/g, ' ').trim().slice(0, 70) || '(empty)';
  return [
    `#${item.numInPage} "${shortText}"`,
    `x=${item.x}, y=${item.y}, w=${item.width}, h=${item.height}`,
    `fontSize=${item.fontSize}, font=${item.fontPath || '(default)'}`,
  ].join('\n');
}

// "Log All Textboxes": every textbox of the current page with its rectangle and font size,
// logged and summarized on the clipboard, to check sizes and positions against the device.

export function formatTextboxLogClipboard(items: TextboxLogItem[], notePath: string, page: number): string {
  const lines = [
    'textboxHelper textbox coordinate log',
    `Created: ${new Date().toISOString()}`,
    `Note: ${notePath}`,
    `Page: ${page}`,
    `Textboxes: ${items.length}`,
    '',
  ];

  items.forEach(item => {
    lines.push(`#${item.numInPage} ${item.uuid}`);
    lines.push(`Text: ${item.text}`);
    lines.push(
      `Rect: left=${item.rect.left}, top=${item.rect.top}, right=${item.rect.right}, bottom=${item.rect.bottom}, width=${item.width}, height=${item.height}`,
    );
    lines.push(
      `Font: size=${item.fontSize}, path=${item.fontPath || '(default)'}, align=${item.textAlign}, bold=${item.textBold}, italics=${item.textItalics}`,
    );
    lines.push(
      `Frame: widthType=${item.textFrameWidthType}, style=${item.textFrameStyle}, editable=${item.textEditable}`,
    );
    lines.push(`Text metrics: length=${item.textLength}, words=${item.wordCount}, newlines=${item.newlineCount}`);
    lines.push('');
  });

  return lines.join('\n').slice(0, CLIPBOARD_PREVIEW_LIMIT);
}
