import {formatBlockTag, newBlockId} from '../domain/blockTag';
import type {BlockStatus, OutlineBlock} from '../domain/outlineModel';
import {isNormalTextElement} from '../domain/textboxEditPlan';
import {writeBlockStatus} from '../storage/blockStatusStore';
import {
  modifyPageElements,
  readPageElements,
  recycleElements,
  saveCurrentNoteForConsistency,
} from '../supernote/noteElements';

/**
 * Setting a block's status in the Outline (technical-design-manuscript.md §5.2). A block without a
 * tag gets one first: its textbox is found again by number and text, and the tag is written into
 * its `userData` (the note is saved before, as for every file-API change). Returns the block's id.
 */
export async function setBlockStatus(
  notePath: string,
  block: OutlineBlock,
  status: BlockStatus,
): Promise<{id: string; statuses: Record<string, BlockStatus>}> {
  const id = block.tagId ?? (await tagBlock(notePath, block));
  const statuses = await writeBlockStatus(id, status);
  return {id, statuses};
}

async function tagBlock(notePath: string, block: OutlineBlock): Promise<string> {
  await saveCurrentNoteForConsistency('marking a block');
  const elements = await readPageElements(notePath, block.page, `Could not read page ${block.page + 1}.`);
  try {
    const textbox = elements.find(
      element =>
        isNormalTextElement(element) &&
        element.numInPage === block.numInPage &&
        (element.textBox.textContentFull ?? '').trim() === block.text,
    );
    if (!textbox) {
      throw new Error('This textbox changed since the outline was read. Read the outline again.');
    }
    const id = newBlockId(new Date());
    textbox.userData = formatBlockTag({v: 1, id});
    await modifyPageElements(notePath, block.page, [textbox]);
    console.log('[BlockStatus] tagged', JSON.stringify({page: block.page, num: block.numInPage, id}));
    return id;
  } finally {
    await recycleElements(elements);
  }
}
