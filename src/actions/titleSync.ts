import {asideTitleTag, formatBlockTag, headingTitleTag, titleTag} from '../domain/blockTag';
import type {HeadingLevel} from '../domain/headingText';
import {planTitles, type TitleWanted} from '../domain/noteTitlesPlan';
import type {PageElementData} from '../domain/textboxModel';
import {getSettings} from '../storage/settingsFile';
import {plural} from '../domain/plural';
import {
  deletePageElements,
  readPageElements,
  recycleElements,
  saveCurrentNoteForConsistency,
} from '../supernote/noteElements';
import {insertTitles} from '../supernote/noteTitles';

/**
 * Puts our NOTE titles right on the given pages (technical-design-outline-sections.md §4): over
 * every linked file's divider, the aside divider and every heading of a titled level; adds the missing ones and
 * removes ours that cover nothing they belong to any more. The same call after an import, an
 * Outline apply and on Restore titles; it is safe to run again. Titles made by the user or another
 * plugin stay as they are.
 *
 * It writes the note file; the caller saves the note afterwards (as after any file-API write).
 * Returns how many titles were added and removed.
 */
export async function syncTitles(
  notePath: string,
  pages: number[],
): Promise<{added: number; removed: number}> {
  const settings = getSettings();
  const {titleLevels, titleStyles} = settings.outline;
  // The aside divider's title looks like a file's (technical-design-aside-area.md §3.3).
  const styleOf = (want: TitleWanted) =>
    want.sourceId !== null || want.aside ? settings.import.fileTitleStyle : titleStyles[want.level as HeadingLevel] ?? 1;
  const tagOf = (want: TitleWanted, now: Date) =>
    want.sourceId !== null ? titleTag(want.sourceId, now) : want.aside ? asideTitleTag(now) : headingTitleTag(want.level, now);
  let added = 0;
  let removed = 0;
  for (const page of [...new Set(pages)].sort((a, b) => a - b)) {
    let plan = await planPage(notePath, page, titleLevels);
    if (plan.remove.length > 0) {
      await deletePageElements(notePath, page, plan.remove);
      removed += plan.remove.length;
      // Deleting renumbers the page: read the textboxes' numbers again before covering them.
      plan = await planPage(notePath, page, titleLevels);
    }
    if (plan.insert.length > 0) {
      const now = new Date();
      await insertTitles(
        notePath,
        page,
        plan.insert.map(want => ({
          textBoxNum: want.numInPage,
          rect: want.rect,
          style: styleOf(want),
          userData: formatBlockTag(tagOf(want, now)),
        })),
      );
      added += plan.insert.length;
    }
  }
  if (added + removed > 0) {
    console.log('[TitleSync] synced', JSON.stringify({pages: pages.length, added, removed}));
  }
  return {added, removed};
}

async function planPage(notePath: string, page: number, titleLevels: number[]) {
  const elements = await readPageElements(notePath, page, `Could not read page ${page + 1}.`);
  try {
    return planTitles(elements as unknown as PageElementData[], titleLevels);
  } finally {
    await recycleElements(elements);
  }
}

/**
 * Puts our titles right on every page of the note (Restore titles): over every divider and titled
 * heading, and removes ours left over anywhere (a deleted textbox may have left its title on any
 * page), then saves the note.
 */
export async function restoreTitles(notePath: string, pageCount: number): Promise<string> {
  const pages = Array.from({length: pageCount}, (_, page) => page);
  const {added, removed} = await syncTitles(notePath, pages);
  if (added + removed > 0) {
    await saveCurrentNoteForConsistency('restoring the titles');
  }
  return added + removed > 0
    ? `${plural(added, 'title')} added${removed ? `, ${removed} removed` : ''}.`
    : 'Every file and heading has its title.';
}
