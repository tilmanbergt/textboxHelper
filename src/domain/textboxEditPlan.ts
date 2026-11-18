import {CLIPBOARD_PREVIEW_LIMIT} from './backupPayload';
import {isPenEditElement, looksLikePenEditNumber} from './penEditTags';
import {plural} from './plural';
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
  splitIntoParagraphCandidates,
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
  /** The result of each action that applies to the selection. */
  afterBlocksByAction: Partial<Record<TextboxActionKind, string[]>>;
  /** For the toolbar (direct) actions: the selection has the right textboxes for the action. */
  availableActions: TextboxActionAvailability;
  /** Why an action can't be chosen on the lasso screen ("needs exactly 1 textbox"). */
  reasons: Partial<Record<TextboxActionKind, string>>;
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
    !!element.textBox?.textRect &&
    !isPenEditNumberElement(element)
  );
}

/**
 * The small number textboxes pen edits put on the page (technical-design-pen-edits.md §3.2) are
 * not text: every textbox tool, the edit markers and the export skip them. Recognized by their
 * `userData`, and by their look in case the host dropped it.
 */
export function isPenEditNumberElement(element: PageElementData): boolean {
  return (
    isPenEditElement(element) ||
    (element.type === TEXT_TYPE_NORMAL &&
      looksLikePenEditNumber(element.textBox?.textContentFull, element.textBox?.fontSize))
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

/** The actions the lasso screen offers, each with its result for the current selection. */
type ScreenAction = Exclude<TextboxActionKind, 'log'>;

/**
 * Every action's result for one selection, plus why an action can't be chosen on the lasso screen.
 * `availableActions` keeps the meaning the toolbar (direct) actions use: the selection has the
 * right number and layout of textboxes. A reason is also given when an action would change
 * nothing (one sentence, nothing to clean), so the screen greys it out
 * (technical-design-calmer-screens.md §3.5).
 */
function computeActionOutputs(textElements: TextElementData[]): {
  beforeBlocks: string[];
  afterBlocksByAction: Partial<Record<TextboxActionKind, string[]>>;
  availableActions: TextboxActionAvailability;
  reasons: Partial<Record<TextboxActionKind, string>>;
} {
  const sortedTextElements = sortTextElements(textElements);
  const beforeBlocks = sortedTextElements.map(getTextboxText);
  const availableActions = createEmptyAvailability();
  const afterBlocksByAction: Partial<Record<TextboxActionKind, string[]>> = {};
  const reasons: Partial<Record<TextboxActionKind, string>> = {};
  const single: ScreenAction[] = ['split', 'splitParagraphs', 'clean', 'unwrap'];

  if (sortedTextElements.length === 1) {
    const sourceText = beforeBlocks[0];
    const outputs: Record<Exclude<ScreenAction, 'join'>, string[]> = {
      split: splitIntoSentenceCandidates(sourceText),
      splitParagraphs: splitIntoParagraphCandidates(sourceText),
      clean: [cleanupTextboxWhitespace(sourceText)],
      unwrap: [removeLineBreaks(sourceText)],
    };
    for (const action of single as Array<Exclude<ScreenAction, 'join'>>) {
      availableActions[action] = true;
      afterBlocksByAction[action] = outputs[action];
    }
    if (outputs.split.length < 2) {
      reasons.split = 'only one sentence';
    }
    if (outputs.splitParagraphs.length < 2) {
      reasons.splitParagraphs = 'only one paragraph';
    }
    if (outputs.clean[0] === sourceText) {
      reasons.clean = 'nothing to clean';
    }
    if (outputs.unwrap[0] === sourceText) {
      reasons.unwrap = 'no line breaks';
    }
  } else {
    for (const action of single) {
      reasons[action] = 'needs exactly 1 textbox';
    }
  }

  if (sortedTextElements.length >= 2) {
    try {
      ensureClearlyOrderedColumn(sortedTextElements);
      afterBlocksByAction.join = [buildJoinedTextboxText(sortedTextElements)];
      availableActions.join = true;
    } catch {
      reasons.join = 'textboxes are not in one column';
    }
  } else {
    reasons.join = 'needs 2 or more textboxes';
  }

  return {beforeBlocks, afterBlocksByAction, availableActions, reasons};
}

/** The preview of every action for the lasso selection (one read, then switching is instant). */
export function buildActionPreview(lassoElements: PageElementData[]): TextboxActionPreview {
  const textElements = lassoElements.filter(isNormalTextElement);
  const selectedCount = textElements.length;
  const selectionMessage = plural(selectedCount, 'textbox', 'textboxes') + ' selected';

  if (lassoElements.length === 0 || textElements.length !== lassoElements.length) {
    const reason =
      lassoElements.length === 0 ? 'select textboxes with the lasso' : 'only textboxes can be in the lasso';
    return {
      selectedCount,
      beforeBlocks: sortTextElements(textElements).map(getTextboxText),
      afterBlocksByAction: {},
      availableActions: createEmptyAvailability(),
      reasons: {split: reason, splitParagraphs: reason, join: reason, clean: reason, unwrap: reason},
      selectionMessage,
      hasOnlyTextboxes: lassoElements.length === textElements.length,
    };
  }

  return {
    selectedCount,
    ...computeActionOutputs(textElements),
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


export function formatTextboxLogPreviewItem(item: TextboxLogItem): string {
  const shortText = item.text.replace(/\s+/g, ' ').trim().slice(0, 70) || '(empty)';
  return [
    `#${item.numInPage} "${shortText}"`,
    `x=${item.x}, y=${item.y}, w=${item.width}, h=${item.height}`,
    `fontSize=${item.fontSize}, font=${item.fontPath || '(default)'}`,
  ].join('\n');
}


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
