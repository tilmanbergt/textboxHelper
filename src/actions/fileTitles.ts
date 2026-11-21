import {titleTag, formatBlockTag} from '../domain/blockTag';
import {planFileTitles} from '../domain/fileTitles';
import type {PageElementData} from '../domain/textboxModel';
import {getSettings} from '../storage/settingsFile';
import {deletePageElements, readPageElements, recycleElements} from '../supernote/noteElements';
import {insertTitles} from '../supernote/noteTitles';

/**
 * Puts the NOTE titles over linked files' dividers right on the given pages
 * (technical-design-linked-files.md §1.5): adds the missing ones, removes ours that cover no
 * divider any more. The same call after an import, an Outline apply and on Restore titles; it is
 * safe to run again. Titles made by the user or another plugin stay as they are.
 *
 * It writes the note file; the caller saves the note afterwards (as after any file-API write).
 * Returns how many titles were added and removed.
 */
export async function syncFileTitles(
  notePath: string,
  pages: number[],
): Promise<{added: number; removed: number}> {
  const style = getSettings().import.fileTitleStyle;
  let added = 0;
  let removed = 0;
  for (const page of [...new Set(pages)].sort((a, b) => a - b)) {
    const elements = await readPageElements(notePath, page, `Could not read page ${page + 1}.`);
    let plan;
    try {
      plan = planFileTitles(elements as unknown as PageElementData[]);
    } finally {
      await recycleElements(elements);
    }
    if (plan.remove.length > 0) {
      await deletePageElements(notePath, page, plan.remove);
      removed += plan.remove.length;
    }
    if (plan.insert.length > 0) {
      // Deleting renumbers the page: read the dividers' numbers again before covering them.
      const fresh = plan.remove.length > 0 ? await renumbered(notePath, page, plan.insert) : plan.insert;
      const now = new Date();
      await insertTitles(
        notePath,
        page,
        fresh.map(divider => ({
          textBoxNum: divider.numInPage,
          rect: divider.rect,
          style,
          userData: formatBlockTag(titleTag(divider.sourceId, now)),
        })),
      );
      added += fresh.length;
    }
  }
  if (added + removed > 0) {
    console.log('[FileTitles] synced', JSON.stringify({pages: pages.length, added, removed}));
  }
  return {added, removed};
}

async function renumbered(
  notePath: string,
  page: number,
  dividers: ReturnType<typeof planFileTitles>['insert'],
): Promise<ReturnType<typeof planFileTitles>['insert']> {
  const elements = await readPageElements(notePath, page, `Could not read page ${page + 1}.`);
  try {
    return planFileTitles(elements as unknown as PageElementData[]).insert.filter(item =>
      dividers.some(divider => divider.sourceId === item.sourceId),
    );
  } finally {
    await recycleElements(elements);
  }
}
