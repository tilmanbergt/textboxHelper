import type {Element} from 'sn-plugin-lib';
import {createEditMarkerBackupPayload} from '../domain/backupPayload';
import {NOTE_SYSTEM_FONT_PATH} from '../domain/fontPaths';
import {rectHeight, rectWidth} from '../domain/geometry';
import {cloneTextElementForMutation} from '../domain/markerText';
import type {EditMarkerPreview, TextMutationPlan} from '../domain/markerTypes';
import {SPLIT_SIGN, splitParagraphParts} from '../domain/paragraphMarks';
import {
  placeGapParagraphs,
  planReflow,
  type ReflowEvent,
  type ReflowItem,
} from '../domain/penEditCaret';
import {shiftRect} from '../domain/penEditMatching';
import {plural} from '../domain/plural';
import {isNormalTextElement} from '../domain/textboxEditPlan';
import {DEFAULT_FONT_SIZE, type Rect, type TextboxData} from '../domain/textboxModel';
import {writeBackupFile} from '../storage/backupFile';
import {
  deletePageElements,
  modifyPageElements,
  readPageElements,
  recycleElements,
  saveCurrentNoteForConsistency,
} from '../supernote/noteElements';
import {insertTextboxesIntoFile, type StyledTextboxInsert} from '../supernote/noteTextInsertion';
import {buildResizedTextboxRect, estimateTextboxHeight} from '../supernote/textboxMetrics';
import {logEditMarker} from '../utils/editMarkerLog';
import {getEditMarkerCalibration} from './markerCalibration';
import {markPenEditsApplied, penEditBackupData, penEditElementNums} from './penEditReview';

/**
 * Applying an edit-marker preview to its page: the textboxes' new text and size, paragraph breaks
 * and new paragraphs, the paragraphs below pushed down, the marks and applied pen edits removed.
 * A backup is written first; the note is saved before anything changes.
 */

export type EditMarkerProgressUpdate = {
  message: string;
  canCancel: boolean;
};

export type EditMarkerApplyResult = {
  message: string;
  backupPath: string;
  clipboardSummary: string;
  appliedOperationCount: number;
  removedMarkerCount: number;
  affectedTextboxCount: number;
};

type EditMarkerApplyOptions = {
  onProgress?: (update: EditMarkerProgressUpdate) => void;
};

function reportProgress(
  options: EditMarkerApplyOptions | undefined,
  message: string,
  canCancel: boolean,
): void {
  options?.onProgress?.({message, canCancel});
}

/** The style a new textbox copies, with NOTE's defaults for what the source doesn't set. */
function insertStyle(style: TextboxData): StyledTextboxInsert['style'] {
  return {
    fontSize: style.fontSize || DEFAULT_FONT_SIZE,
    fontPath: style.fontPath,
    textAlign: style.textAlign ?? 0,
    textBold: style.textBold ?? 0,
    textItalics: style.textItalics ?? 0,
    textFrameWidthType: style.textFrameWidthType ?? 0,
    textFrameStyle: style.textFrameStyle ?? 0,
    textEditable: style.textEditable ?? 0,
  };
}

export async function applyEditMarkerPreview(
  preview: EditMarkerPreview,
  options?: EditMarkerApplyOptions,
): Promise<EditMarkerApplyResult> {
  const plan = preview.applyPlan;
  if (!plan || !preview.canApply) {
    throw new Error('No recognized edit marker operations are ready to apply.');
  }

  let pageElements: Element[] = [];
  const calibration = getEditMarkerCalibration();

  try {
    reportProgress(options, 'Refreshing page state...', true);
    pageElements = await readPageElements(
      plan.notePath,
      plan.page,
      `Could not read page ${plan.page} elements before applying edit markers.`,
    );

    const pageTextboxByNum = new Map(
      pageElements
        .filter(isNormalTextElement)
        .map(element => [element.numInPage, element]),
    );

    plan.textMutations.forEach(mutation => {
      const currentTextbox = pageTextboxByNum.get(mutation.numInPage);
      if (!currentTextbox) {
        throw new Error(
          `Textbox ${mutation.numInPage} is no longer available. Refresh the preview and try again.`,
        );
      }

      const currentText = currentTextbox.textBox.textContentFull || '';
      if (currentText !== mutation.originalText) {
        throw new Error(
          `Textbox ${mutation.numInPage} changed after preview. Refresh the review before applying.`,
        );
      }
    });

    // Paragraph breaks: a textbox's new text is cut at the split signs; the first part stays,
    // every further part becomes a new paragraph right below it (technical-design-paragraph-marks.md).
    const splitTails = new Map<number, string[]>();
    const cutMutations = plan.textMutations.map(mutation => {
      if (!mutation.nextText.includes(SPLIT_SIGN)) {
        return mutation;
      }
      const [head = '', ...tail] = splitParagraphParts(mutation.nextText);
      splitTails.set(mutation.numInPage, tail);
      return {...mutation, nextText: head};
    });

    // The new heights are measured now, once the pen edits' text is final.
    const textMutations: TextMutationPlan[] = await Promise.all(
      cutMutations.map(async mutation => ({
        ...mutation,
        nextTextRect: await buildResizedTextboxRect(
          mutation.textRect,
          mutation.nextText,
          mutation.fontSize,
          mutation.fontPath || undefined,
          calibration,
        ),
      })),
    );

    reportProgress(options, 'Creating backup...', true);
    const penBackup =
      plan.penEditIds.length > 0
        ? await penEditBackupData(plan.penEditIds)
        : null;
    const backupPayload = {
      ...createEditMarkerBackupPayload({...plan, textMutations}),
      ...(penBackup ? {penEdits: penBackup} : {}),
    };
    const {backupPath, clipboardSummary} = await writeBackupFile(backupPayload);

    reportProgress(options, 'Saving current note...', false);
    await saveCurrentNoteForConsistency('applying edit markers');

    reportProgress(options, 'Applying recognized markers...', false);
    // New paragraphs, measured now: insertions in the gaps between paragraphs, and the parts of
    // split paragraphs, which follow their paragraph's new (shorter) text.
    type NewParagraph = {
      key: string;
      group: string;
      text: string;
      left: number;
      width: number;
      style: TextboxData;
      above: Rect | null;
      below: Rect | null;
    };
    const textboxBelow = (rect: Rect): Rect | null =>
      [...pageTextboxByNum.values()]
        .map(textbox => textbox.textBox.textRect)
        .filter(
          other =>
            other.top >= rect.bottom - 2 &&
            Math.min(other.right, rect.right) > Math.max(other.left, rect.left),
        )
        .sort((left, right) => left.top - right.top)[0] ?? null;
    const newParagraphs: NewParagraph[] = [
      ...plan.insertions.map(insertion => ({
        key: `new:${insertion.penEditId}`,
        group: `${insertion.aboveRect?.bottom ?? 'top'}:${
          insertion.belowRect?.top ?? 'end'
        }:${insertion.left}`,
        text: insertion.text,
        left: insertion.left,
        width: insertion.width,
        style: insertion.style,
        above: insertion.aboveRect,
        below: insertion.belowRect,
      })),
      ...textMutations.flatMap(mutation => {
        const textbox = pageTextboxByNum.get(mutation.numInPage);
        return (splitTails.get(mutation.numInPage) ?? []).map(
          (text, index) => ({
            key: `split:${mutation.numInPage}:${index}`,
            group: `split:${mutation.numInPage}`,
            text,
            left: mutation.textRect.left,
            width: rectWidth(mutation.textRect),
            style: {
              ...(textbox?.textBox ?? {}),
              fontSize: mutation.fontSize,
              fontPath: mutation.fontPath,
            } as TextboxData,
            above: mutation.nextTextRect,
            below: textboxBelow(mutation.textRect),
          }),
        );
      }),
    ];
    const gapParagraphs = await Promise.all(
      newParagraphs.map(async paragraph => {
        const style = {
          ...paragraph.style,
          fontPath: paragraph.style.fontPath || NOTE_SYSTEM_FONT_PATH,
        };
        const height = await estimateTextboxHeight(
          paragraph.text,
          paragraph.width,
          style.fontSize || DEFAULT_FONT_SIZE,
          style.fontPath,
          calibration,
        );
        return {paragraph, style, height};
      }),
    );
    const placedGaps = placeGapParagraphs(
      gapParagraphs.map(({paragraph, height}) => ({
        key: paragraph.key,
        group: paragraph.group,
        left: paragraph.left,
        width: paragraph.width,
        height,
        above: paragraph.above,
        below: paragraph.below,
      })),
    );

    // Paragraphs that got longer, and new paragraphs, push the paragraphs below them down.
    const mutationByNum = new Map(
      textMutations.map(mutation => [mutation.numInPage, mutation]),
    );
    const growthEvents: ReflowEvent[] = textMutations.map(mutation => ({
      y: mutation.textRect.bottom,
      left: mutation.textRect.left,
      right: mutation.textRect.right,
      delta: rectHeight(mutation.nextTextRect) - rectHeight(mutation.textRect),
      sourceKeys: [`n:${mutation.numInPage}`],
    }));
    const reflowItems: ReflowItem[] = [
      ...[...pageTextboxByNum.values()].map(textbox => ({
        key: `n:${textbox.numInPage}`,
        rect: textbox.textBox.textRect,
      })),
      ...[...placedGaps.rects].map(([key, rect]) => ({key, rect})),
    ];
    const shifts = planReflow(reflowItems, [
      ...growthEvents,
      ...placedGaps.events,
    ]);

    const modifiedTextboxes: Element[] = [];
    for (const textbox of pageTextboxByNum.values()) {
      const mutation = mutationByNum.get(textbox.numInPage);
      const dy = shifts.get(`n:${textbox.numInPage}`) ?? 0;
      if (mutation) {
        if (mutation.nextText.length > 0) {
          modifiedTextboxes.push(
            cloneTextElementForMutation(textbox, {
              ...mutation,
              nextTextRect: shiftRect(mutation.nextTextRect, 0, dy),
            }),
          );
        }
      } else if (dy > 0) {
        modifiedTextboxes.push({
          ...textbox,
          textBox: {
            ...textbox.textBox,
            textRect: shiftRect(textbox.textBox.textRect, 0, dy),
          },
        } as Element);
      }
    }
    const emptyTargetTextboxNums = textMutations
      .filter(mutation => mutation.nextText.length === 0)
      .map(mutation => mutation.numInPage);
    const penEditNums = penEditElementNums(
      plan.penEditIds,
      penBackup?.entries ?? [],
      pageElements,
    );
    logEditMarker('applyReflow', {
      shifts: Object.fromEntries(shifts),
      newParagraphs: Object.fromEntries(placedGaps.rects),
    });

    await modifyPageElements(plan.notePath, plan.page, modifiedTextboxes);
    await deletePageElements(plan.notePath, plan.page, [
      ...plan.recognizedMarkerNums,
      ...emptyTargetTextboxNums,
      ...penEditNums,
    ]);

    // New textboxes last, into the file like the changes above: inserting may renumber elements.
    if (gapParagraphs.length > 0) {
      reportProgress(options, 'Inserting new paragraphs...', false);
      await insertTextboxesIntoFile(
        plan.notePath,
        plan.page,
        gapParagraphs.map(({paragraph, style}) => {
          const key = paragraph.key;
          const rect = placedGaps.rects.get(key) as Rect;
          return {
            text: paragraph.text,
            rect: shiftRect(rect, 0, shifts.get(key) ?? 0),
            style: insertStyle(style),
          };
        }),
      );
    }

    try {
      await markPenEditsApplied(plan.penEditIds);
    } catch (error) {
      console.warn(
        '[EditMarkerActions] pen edits not marked applied',
        String(error),
      );
    }


    const movedCount = [...shifts.keys()].filter(key =>
      key.startsWith('n:'),
    ).length;
    const movedNote =
      movedCount > 0
        ? ` Moved ${plural(movedCount, 'paragraph')} below down to make room.`
        : '';
    const left = preview.pendingCount;
    const leftNote =
      left > 0 ? ` ${plural(left, 'pen edit')} left for later.` : '';
    return {
      message: `Applied ${plural(
        plan.operations.length,
        'change',
      )} and removed ${plural(
        plan.recognizedMarkerNums.length,
        'marker',
      )}.${leftNote}${movedNote}`,
      backupPath,
      clipboardSummary,
      appliedOperationCount: plan.operations.length,
      removedMarkerCount: plan.recognizedMarkerNums.length,
      affectedTextboxCount: textMutations.length,
    };
  } finally {
    await recycleElements(pageElements);
  }
}
