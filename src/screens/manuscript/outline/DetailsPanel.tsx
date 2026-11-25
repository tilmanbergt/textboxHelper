/**
 * The Outline's bottom panel (technical-design-outline-sections.md §3, §3.1, §7.1): whatever was
 * tapped last — an entry of the Contents (a file, a heading, Start, Not in a file, Set aside) or a
 * paragraph. Top to bottom: an info line with Go to page ›, one line with Level (and Status for a
 * paragraph), the text, and the action bar. Moves, levels and removals are planned, not done;
 * anything with edits waiting offers its review instead. Which actions a block gets, in the text
 * or in the aside area, comes from `domain/outlineActions.ts`.
 */
import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {HEADING_LEVELS, type HeadingLevel} from '../../../domain/headingText';
import {blockActions} from '../../../domain/outlineActions';
import {ASIDE, stepMoves, type Contents} from '../../../domain/outlineContents';
import {BLOCK_STATUSES, STATUS_GLYPH, STATUS_LABEL, type OutlineBlock} from '../../../domain/outlineModel';
import {blockedBy, type ChangeMark} from '../../../domain/outlinePlan';
import {plural} from '../../../domain/plural';
import ActionBar, {type BarAction, type BarItem} from '../../../ui/ActionBar';
import {GLYPH} from '../../../ui/glyphs';
import PagedText from '../../../ui/PagedText';
import TextChoices from '../../../ui/TextChoices';
import TextLink from '../../../ui/TextLink';
import {COLORS, FONT, SPACING} from '../../../ui/theme';
import LevelChoice from './LevelChoice';
import type {Outline} from './useOutline';
import type {OutlineView} from './useOutlineView';

interface Props {
  outline: Outline;
  view: OutlineView;
  disabled: boolean;
  onReviewPage: (page: number) => void;
  onGoToPage: (page: number) => void;
}

const LEVEL_CHOICES = [
  {key: 0, label: '¶', accessibilityLabel: 'Paragraph'},
  ...HEADING_LEVELS.map(level => ({key: level, label: '#'.repeat(level), accessibilityLabel: `Heading level ${level}`})),
];
const STATUS_CHOICES = BLOCK_STATUSES.map(status => ({key: status, label: `${STATUS_GLYPH[status]} ${STATUS_LABEL[status]}`}));

const UNDO_LABEL: Record<ChangeMark, string> = {
  moved: 'Undo move',
  level: 'Undo level',
  aside: 'Undo set aside',
  delete: 'Undo delete',
};

const PSEUDO_HINT: Record<string, string> = {
  start: 'The text before the first heading.',
  orphans: 'Text before the first file: it belongs to no file and is written nowhere. Move it into a file with Move to….',
  aside: 'Set aside earlier, before the “Set aside” heading existed: the next Apply in the Outline puts that heading on a page of its own before it. Move a paragraph back with Move back.',
};

const ASIDE_HINT =
  'Everything below this heading stays in the note and is never written to a file or exported. Sort it under your own headings typed on the page; Move back puts a paragraph into the text again.';

export default function DetailsPanel({outline, view, disabled, onReviewPage, onGoToPage}: Props): React.JSX.Element {
  const {subject, shown, order, moveContents} = view;
  const [levelAsk, setLevelAsk] = useState<{key: string; level: 0 | HeadingLevel} | null>(null);
  useEffect(() => setLevelAsk(null), [subject?.key]);

  if (!subject || !view.contents) {
    return <View style={styles.panel} />;
  }
  const marks = outline.planned?.marks ?? new Map<string, ChangeMark>();
  const entry = subject.kind === 'entry' ? view.contents.byKey.get(subject.key) ?? null : null;
  const block = shown.get(subject.key) ?? null;
  const section = entry ? entry.section.map(key => shown.get(key)).filter((item): item is OutlineBlock => !!item) : [];
  const busy = disabled || outline.busy;

  if (entry && (entry.kind === 'start' || entry.kind === 'orphans' || entry.key === ASIDE)) {
    return (
      <View style={styles.panel}>
        <Text style={styles.info}>
          {entry.title} · {plural(entry.own.length, 'paragraph')}
          {entry.pendingAll > 0 ? ` · ${plural(entry.pendingAll, 'edit')} waiting` : ''}
        </Text>
        <Text style={styles.hint}>{PSEUDO_HINT[entry.kind]}</Text>
      </View>
    );
  }
  if (!block) {
    return <View style={styles.panel} />;
  }
  const mark = marks.get(block.key) ?? null;
  const undo: BarItem[] = mark
    ? ['spacer', {key: 'undo', label: UNDO_LABEL[mark], onPress: () => outline.undo(block.key), disabled: busy}]
    : ['spacer'];
  const firstPending = (blocks: OutlineBlock[]) => blocks.find(item => (item.pendingEdits ?? 0) > 0)?.page ?? block.page;

  // --- The aside area's divider: it stays where it is.
  if (entry?.kind === 'aside') {
    return (
      <View style={styles.panel}>
        <InfoLine
          text={`Set aside · ${pagesOf(section)} · ${plural(entry.own.length, 'paragraph')}${entry.children.length ? `, ${plural(entry.children.length, 'heading')}` : ''} · in no file`}
          page={block.page}
          onGoToPage={onGoToPage}
          disabled={busy}
        />
        <View style={styles.body}>
          <Text style={styles.title}>{entry.title}</Text>
          <Text style={styles.hint}>{ASIDE_HINT}</Text>
        </View>
      </View>
    );
  }

  // --- A file's divider.
  if (entry?.kind === 'file') {
    const steps = stepMoves(moveContents, order, block.key);
    const move = (target: string | null) => target !== null && outline.move(block.key, target);
    return (
      <View style={styles.panel}>
        <InfoLine text={`File · ${pagesOf(section)} · ${plural(entry.own.length, 'paragraph')} before its first heading`} page={block.page} onGoToPage={onGoToPage} disabled={busy} />
        <View style={styles.body}>
          <Text style={styles.title}>{entry.title}</Text>
          <Text style={styles.hint}>A file moves with all its text; its title and index.txt follow.</Text>
        </View>
        <ActionBar
          resetKey={block.key}
          items={[
            {key: 'up', label: `${GLYPH.up} Up`, onPress: () => move(steps.up), disabled: busy || steps.up === null},
            {key: 'down', label: `${GLYPH.down} Down`, onPress: () => move(steps.down), disabled: busy || steps.down === null},
            'separator',
            {key: 'before', label: `${GLYPH.to} Move before…`, onPress: () => view.setMoving(block.key), disabled: busy},
            ...undo,
          ]}
        />
      </View>
    );
  }

  // --- A heading.
  if (entry?.kind === 'heading') {
    const edits = blockedBy(section);
    const subheadings = entry.children.length;
    const chooseLevel = (level: 0 | HeadingLevel) => {
      if (subheadings > 0) {
        setLevelAsk({key: block.key, level});
      } else {
        outline.setLevel(block.key, level, false);
      }
    };
    const first = entry.own.map(key => shown.get(key)).find(Boolean);
    return (
      <View style={styles.panel}>
        <InfoLine
          text={`Heading · ${pagesOf(section)} · ${plural(entry.own.length, 'paragraph')}${subheadings ? `, ${plural(subheadings, 'subheading')}` : ''}${edits ? ` · ${plural(edits, 'edit')} waiting` : ''}`}
          page={block.page}
          onGoToPage={onGoToPage}
          disabled={busy}
        />
        <View style={styles.choices}>
          <TextChoices
            caption="Level"
            choices={LEVEL_CHOICES}
            value={levelAsk?.level ?? block.level ?? 0}
            onChange={level => chooseLevel(level as 0 | HeadingLevel)}
            disabled={busy || (block.pendingEdits ?? 0) > 0}
          />
          {levelAsk ? <Text style={styles.askHint}>It has subheadings: how should they change?</Text> : null}
        </View>
        <View style={styles.body}>
          {levelAsk ? (
            <LevelChoice
              order={order}
              plan={outline.plan}
              headingKey={block.key}
              level={levelAsk.level}
              onChoose={withSubheadings => {
                outline.setLevel(block.key, levelAsk.level, withSubheadings);
                setLevelAsk(null);
              }}
            />
          ) : (
            <>
              <Text style={styles.title} numberOfLines={2}>
                {block.text}
              </Text>
              {first ? (
                <Text style={styles.preview} numberOfLines={3}>
                  {first.text}
                </Text>
              ) : null}
            </>
          )}
        </View>
        {levelAsk ? (
          <ActionBar resetKey={block.key} items={['spacer', {key: 'cancel', label: 'Cancel', onPress: () => setLevelAsk(null)}]} />
        ) : (
          <ActionBar
            resetKey={block.key}
            items={[
              ...(edits > 0
                ? [{key: 'review', label: `${GLYPH.edits} Review its ${plural(edits, 'edit')} ${GLYPH.next}`, onPress: () => onReviewPage(firstPending(section))}, 'separator' as const]
                : []),
              ...(blockActions(block, view.flat).includes('setAside')
                ? [{key: 'aside', label: 'Set aside section', onPress: () => outline.setAside(block.key), disabled: busy || edits > 0}]
                : []),
              ...undo,
            ]}
            more={[{key: 'delete', label: `Delete section (${plural(section.length, 'block')})`, onPress: () => outline.remove(block.key), disabled: busy || edits > 0}]}
            note={edits > 0 ? 'Setting aside and deleting come after the edits.' : undefined}
          />
        )}
      </View>
    );
  }

  // --- A paragraph.
  const owner = view.contents.byKey.get(view.contents.ownerOf.get(block.key) ?? '');
  const position = owner ? owner.own.indexOf(block.key) + 1 : 0;
  const edits = block.pendingEdits ?? 0;
  const original = outline.blocks?.find(item => item.key === block.key) ?? block;
  return (
    <View style={styles.panel}>
      <InfoLine
        text={`Paragraph${owner && position ? ` ${position} of ${owner.own.length}` : ''} · page ${block.page + 1} · ${
          block.pendingEdits === null ? 'edits not read yet' : edits ? `${plural(edits, 'edit')} waiting` : 'no edits waiting'
        }${notesInfo(block)}`}
        page={block.page}
        onGoToPage={onGoToPage}
        disabled={busy}
      />
      <View style={[styles.choices, styles.choicesRow]}>
        <TextChoices
          caption="Level"
          choices={LEVEL_CHOICES}
          value={block.level ?? 0}
          onChange={level => outline.setLevel(block.key, level as 0 | HeadingLevel, false)}
          disabled={busy || edits > 0}
        />
        <TextChoices
          caption="Status"
          choices={STATUS_CHOICES}
          value={block.status}
          onChange={status => outline.setStatus(original, status)}
          disabled={busy}
        />
      </View>
      <View style={styles.body}>
        <PagedText segments={[{text: block.text}]} resetKey={block.key} />
      </View>
      <ActionBar resetKey={block.key} {...paragraphActions({outline, view, block, moveContents, edits, busy, undo, onReviewPage})} />
    </View>
  );
}

function paragraphActions({
  outline,
  view,
  block,
  moveContents,
  edits,
  busy,
  undo,
  onReviewPage,
}: {
  outline: Outline;
  view: OutlineView;
  block: OutlineBlock;
  moveContents: Contents;
  edits: number;
  busy: boolean;
  undo: BarItem[];
  onReviewPage: (page: number) => void;
}): {items: BarItem[]; more?: BarAction[]; note?: string} {
  if (edits > 0) {
    return {
      items: [
        {key: 'review', label: `${GLYPH.edits} Review its ${plural(edits, 'edit')} ${GLYPH.next}`, onPress: () => onReviewPage(block.page)},
        'spacer',
      ],
      note: 'Moving and removing come after the edits.',
    };
  }
  const steps = stepMoves(moveContents, view.order, block.key);
  const move = (target: string | null) => target !== null && outline.move(block.key, target);
  const items: BarItem[] = [];
  const more: BarAction[] = [];
  for (const action of blockActions(block, view.flat)) {
    if (action === 'moveBack') {
      items.push({key: 'back', label: `↩ Move back ${GLYPH.next}`, onPress: () => view.setMoving(block.key, true), disabled: busy}, 'separator');
    } else if (action === 'steps') {
      items.push(
        {key: 'up', label: `${GLYPH.up} Up`, onPress: () => move(steps.up), disabled: busy || steps.up === null},
        {key: 'down', label: `${GLYPH.down} Down`, onPress: () => move(steps.down), disabled: busy || steps.down === null},
      );
      if (!block.aside) {
        items.push(
          {key: 'top', label: `${GLYPH.top} Top`, onPress: () => move(steps.top), disabled: busy || steps.top === null},
          {key: 'end', label: `${GLYPH.end} End`, onPress: () => move(steps.end), disabled: busy || steps.end === null},
        );
      }
    } else if (action === 'moveTo') {
      items.push('separator', {key: 'to', label: `${GLYPH.to} Move to…`, onPress: () => view.setMoving(block.key), disabled: busy});
    } else if (action === 'setAside') {
      items.push('separator', {key: 'aside', label: 'Set aside', onPress: () => outline.setAside(block.key), disabled: busy});
    } else if (action === 'delete') {
      more.push({key: 'delete', label: 'Delete', onPress: () => outline.remove(block.key), disabled: busy});
    }
  }
  return {items: [...items, ...undo], more};
}

/** "pages 2–4" / "page 5". */
function pagesOf(blocks: OutlineBlock[]): string {
  const pages = blocks.map(item => item.page + 1);
  if (pages.length === 0) {
    return 'no pages';
  }
  const from = Math.min(...pages);
  const to = Math.max(...pages);
  return from === to ? `page ${from}` : `pages ${from}–${to}`;
}

function InfoLine({
  text,
  page,
  onGoToPage,
  disabled,
}: {
  text: string;
  page: number;
  onGoToPage: (page: number) => void;
  disabled: boolean;
}): React.JSX.Element {
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.info, styles.flex]} numberOfLines={1}>
        {text}
      </Text>
      <TextLink label={`Go to page ${page + 1} ${GLYPH.next}`} onPress={() => onGoToPage(page)} disabled={disabled} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.md,
    gap: SPACING.sm,
  },
  flex: {
    flex: 1,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.base,
  },
  info: {
    fontSize: FONT.small,
    color: COLORS.muted,
  },
  hint: {
    fontSize: FONT.small,
    color: COLORS.muted,
    lineHeight: 20,
  },
  choices: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: SPACING.xs,
  },
  choicesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  askHint: {
    fontSize: FONT.small,
    color: COLORS.muted,
    paddingBottom: SPACING.xs,
  },
  body: {
    flex: 1,
    minHeight: 0,
    gap: SPACING.sm,
  },
  title: {
    fontSize: FONT.large,
    fontWeight: '700',
    color: COLORS.text,
  },
  preview: {
    fontSize: FONT.medium,
    lineHeight: 22,
    color: COLORS.muted,
  },
});

/** " · 2 comments · 1 image" for a block's comments and images (technical-design-comments-images.md §6). */
function notesInfo(block: OutlineBlock): string {
  const count = block.notes;
  if (!count) {
    return '';
  }
  return [count.comments > 0 ? plural(count.comments, 'comment') : null, count.images > 0 ? plural(count.images, 'image') : null]
    .filter(Boolean)
    .map(part => ` · ${part}`)
    .join('');
}
