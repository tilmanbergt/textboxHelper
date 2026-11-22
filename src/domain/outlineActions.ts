/**
 * Which actions the Outline's panel offers for a block (technical-design-aside-area.md §2.4): one
 * place for the rules, so the text and the aside area differ only here and the panel just draws
 * them. Edits waiting on a block are handled before this (the panel offers their review instead).
 * Pure.
 *
 * - A paragraph in the text: Up/Down/Top/End, Move to…, Set aside, Delete.
 * - A paragraph in the aside area: Move back (to a place in the text), Up/Down/Top/End, Move to…
 *   (within the area), Delete.
 * - A heading: Level, Set aside section (not in the aside area), Delete section.
 * - The aside divider: nothing (it stays where it is).
 * Move to… needs headings to choose from: not in a view without them (`flat`).
 */
import type {OutlineBlock} from './outlineModel';

export type BlockAction = 'steps' | 'moveTo' | 'moveBack' | 'setAside' | 'level' | 'delete';

export function blockActions(block: Pick<OutlineBlock, 'kind' | 'aside'>, flat: boolean): BlockAction[] {
  if (block.kind === 'aside' || block.kind === 'file') {
    // A file's divider has its own bar (Up, Down, Move before…), the aside divider none.
    return [];
  }
  if (block.kind === 'heading') {
    return block.aside ? ['level', 'delete'] : ['level', 'setAside', 'delete'];
  }
  const moveTo: BlockAction[] = flat ? [] : ['moveTo'];
  return block.aside
    ? ['moveBack', 'steps', ...moveTo, 'delete']
    : ['steps', ...moveTo, 'setAside', 'delete'];
}
