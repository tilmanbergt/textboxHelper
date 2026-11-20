import type {OutlineBlock} from './outlineModel';

/**
 * Planned changes in the Outline (technical-design-manuscript.md §5.3): moves, set aside and
 * delete, collected and applied together. Nothing on the page changes until then. A heading moves
 * with its section (the blocks up to the next heading). Pure.
 */

/** Where a moved block goes: before this block (its key), or to the end of the note. */
export type MoveTarget = string | 'end';

export type PlannedChange =
  | {kind: 'move'; key: string; before: MoveTarget}
  | {kind: 'aside'; key: string}
  | {kind: 'delete'; key: string};

export type ChangeMark = 'moved' | 'aside' | 'delete';

export type PlannedOrder = {
  /** The blocks that stay in the text, in their new order. */
  order: OutlineBlock[];
  /** Blocks set aside (onto a new page at the end), in planned order. */
  aside: OutlineBlock[];
  deleted: OutlineBlock[];
  /** How each changed block shows in the list. */
  marks: Map<string, ChangeMark>;
};

/** A heading and the blocks after it up to the next heading; any other block alone. */
export function sectionOf(order: OutlineBlock[], key: string): string[] {
  const start = order.findIndex(block => block.key === key);
  if (start < 0) {
    return [];
  }
  if (!order[start].heading) {
    return [key];
  }
  const keys = [key];
  for (
    let index = start + 1;
    index < order.length && !order[index].heading;
    index++
  ) {
    keys.push(order[index].key);
  }
  return keys;
}

export function plannedOrder(
  blocks: OutlineBlock[],
  plan: PlannedChange[],
): PlannedOrder {
  let order = [...blocks];
  const byKey = new Map(blocks.map(block => [block.key, block]));
  const aside: OutlineBlock[] = [];
  const deleted: OutlineBlock[] = [];
  const marks = new Map<string, ChangeMark>();
  for (const change of plan) {
    const block = byKey.get(change.key);
    if (!block || !order.includes(block)) {
      continue;
    }
    if (change.kind !== 'move') {
      order = order.filter(item => item !== block);
      (change.kind === 'aside' ? aside : deleted).push(block);
      marks.set(block.key, change.kind);
      continue;
    }
    const section = new Set(sectionOf(order, change.key));
    if (change.before !== 'end' && section.has(change.before)) {
      continue;
    }
    const moving = order.filter(item => section.has(item.key));
    const rest = order.filter(item => !section.has(item.key));
    const at =
      change.before === 'end'
        ? rest.length
        : rest.findIndex(item => item.key === change.before);
    if (at < 0) {
      continue;
    }
    order = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
    moving.forEach(item => marks.set(item.key, 'moved'));
  }
  return {order, aside, deleted, marks};
}

/** Whether moving `key` before `target` would change anything (not onto itself or its own place). */
export function canMoveBefore(
  order: OutlineBlock[],
  key: string,
  target: MoveTarget,
): boolean {
  const section = sectionOf(order, key);
  if (section.length === 0 || (target !== 'end' && section.includes(target))) {
    return false;
  }
  const keys = order.map(block => block.key);
  const after = keys[keys.indexOf(section[section.length - 1]) + 1] ?? 'end';
  return after !== target;
}

/** The plan without the changes of this block (Undo on a planned block). */
export function undoFor(plan: PlannedChange[], key: string): PlannedChange[] {
  return plan.filter(change => change.key !== key);
}

/** The plan without its last change. */
export function undoLast(plan: PlannedChange[]): PlannedChange[] {
  return plan.slice(0, -1);
}

/** "1 move (p.4) · 1 set aside (p.5) · 1 delete (p.6)" */
export function plannedSummary(
  blocks: OutlineBlock[],
  plan: PlannedChange[],
): string {
  const byKey = new Map(blocks.map(block => [block.key, block]));
  const groups: Array<[PlannedChange['kind'], string, string]> = [
    ['move', 'move', 'moves'],
    ['aside', 'set aside', 'set aside'],
    ['delete', 'delete', 'deletes'],
  ];
  return groups
    .map(([kind, one, many]) => {
      const changes = plan.filter(change => change.kind === kind);
      if (changes.length === 0) {
        return null;
      }
      const pages = [
        ...new Set(
          changes
            .map(change => byKey.get(change.key)?.page)
            .filter(page => page !== undefined),
        ),
      ]
        .sort((a, b) => (a as number) - (b as number))
        .map(page => (page as number) + 1);
      return `${changes.length} ${
        changes.length === 1 ? one : many
      } (p.${pages.join(', ')})`;
    })
    .filter(Boolean)
    .join(' · ');
}
