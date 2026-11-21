/**
 * The Manuscript card's Outline tab (technical-design-outline-sections.md §3, §7; design canvas
 * "Textbox Tools – Outline with sections"): three panes. Top left the Contents — linked files and
 * headings; top right the open entry's own paragraphs; below, the panel for what was tapped last.
 * A note without headings and files shows its paragraphs in one pane. Above the panes: Show (All ·
 * With edits · Not final), or in Move to mode what is moving and Cancel. Planned changes are named
 * in a line above the panel, with Undo last; the card's button applies them.
 */
import React, {useEffect} from 'react';
import {StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {
  followingEntries,
  moveFileBefore,
  moveToEntry,
  type ContentsEntry,
} from '../../../domain/outlineContents';
import {OUTLINE_FILTERS, type OutlineFilter} from '../../../domain/outlineModel';
import {plannedOrder, plannedSummary, type ChangeMark} from '../../../domain/outlinePlan';
import {plural} from '../../../domain/plural';
import TextChoices from '../../../ui/TextChoices';
import TextLink from '../../../ui/TextLink';
import {COLORS, FONT, SPACING} from '../../../ui/theme';
import ContentsColumn from './ContentsColumn';
import DetailsPanel from './DetailsPanel';
import ParagraphList from './ParagraphList';
import type {Outline} from './useOutline';
import {useOutlineView} from './useOutlineView';

const FILTER_LABELS: Record<OutlineFilter, string> = {
  all: 'All',
  edits: 'With edits',
  notFinal: 'Not final',
};

/** The panel's height: fixed, so nothing above it moves; lower while the planned line shows. */
const PANEL_HEIGHT = 420;
const PANEL_HEIGHT_PLANNED = 300;
/** The Contents column: a third of the width, at most 330 dp (A5 X). */
const CONTENTS_MAX_WIDTH = 330;

interface Props {
  outline: Outline;
  disabled: boolean;
  /** Switches to the Review, showing this page. */
  onReviewPage: (page: number) => void;
  /** Close the card and show a page of the note in NOTE. */
  onGoToPage: (page: number) => void;
}

export default function OutlineTab({outline, disabled, onReviewPage, onGoToPage}: Props): React.JSX.Element {
  const {blocks, loading, load, planned, plan} = outline;
  const view = useOutlineView(outline);
  const {width} = useWindowDimensions();
  // Read when the tab opens; the Outline keeps its blocks while the card is open.
  useEffect(() => {
    if (!blocks) {
      load();
    }
  }, [blocks, load]);

  const {contents, open, moving, moveContents, order} = view;
  const marks = planned?.marks ?? new Map<string, ChangeMark>();
  const movingBlock = moving ? view.shown.get(moving) ?? null : null;
  const moveTarget = movingBlock
    ? (entryKey: string) => {
        const entry = contents?.byKey.get(entryKey);
        if (!entry) {
          return null;
        }
        return movingBlock.kind === 'file'
          ? entry.kind === 'file'
            ? moveFileBefore(order, movingBlock.key, entryKey)
            : null
          : moveToEntry(moveContents, order, movingBlock.key, entryKey);
      }
    : null;
  const hereKey = movingBlock
    ? movingBlock.kind === 'file'
      ? movingBlock.key
      : contents?.ownerOf.get(movingBlock.key) ?? null
    : null;

  const ownHeader = open ? entryHeader(open, view.own.rows.length + view.own.hidden) : 'Paragraphs';
  const list = (
    <ParagraphList
      header={view.flat ? `${plural(open?.own.length ?? 0, 'paragraph')} · no headings` : ownHeader}
      rows={view.own.rows}
      hidden={view.own.hidden}
      following={contents && open ? followingEntries(contents, open) : []}
      selectedKey={view.subject?.kind === 'block' ? view.subject.key : null}
      marks={marks}
      onSelect={view.selectBlock}
      loading={loading || !blocks}
      resetKey={`${open?.key ?? ''}|${view.filter}`}
    />
  );

  return (
    <View style={styles.tab}>
      {movingBlock ? (
        <View style={styles.topLine}>
          <Text style={styles.moving} numberOfLines={1}>
            <Text style={styles.bold}>{movingBlock.kind === 'file' ? 'Move before: ' : 'Move to: '}</Text>
            tap → {movingBlock.kind === 'file' ? 'on a file' : 'on a heading'} · “{movingBlock.firstLine}”
          </Text>
          <TextLink label="Cancel" onPress={() => view.setMoving(null)} />
        </View>
      ) : (
        <View style={styles.topLine}>
          <TextChoices
            caption="Show"
            size="small"
            choices={OUTLINE_FILTERS.map(key => ({key, label: FILTER_LABELS[key]}))}
            value={view.filter}
            onChange={view.setFilter}
          />
        </View>
      )}
      <View style={styles.panes}>
        {view.flat ? (
          list
        ) : (
          <>
            <View style={[styles.contents, {width: Math.min(CONTENTS_MAX_WIDTH, Math.round(width / 3))}]}>
              <ContentsColumn
                header={movingBlock ? 'Contents · to the end of …' : planned ? 'Contents · as planned' : 'Contents'}
                rows={view.rows}
                openKey={open?.key ?? null}
                planned={planned}
                onOpen={view.openEntry}
                moveTarget={moveTarget}
                hereKey={hereKey}
                onMoveTo={target => {
                  if (moving) {
                    outline.move(moving, target);
                  }
                  view.setMoving(null);
                }}
              />
            </View>
            <View style={styles.own}>{list}</View>
          </>
        )}
      </View>
      {plan.length > 0 && blocks ? (
        <View style={styles.planned}>
          <Text style={styles.plannedText} numberOfLines={2}>
            <Text style={styles.bold}>Planned: </Text>
            {plannedSummary(blocks, plan, planned ?? plannedOrder(blocks, plan))}
            {outline.checking ? ' · checking the pages…' : checkNote(outline)}
          </Text>
          <TextLink label="Undo last" onPress={outline.undoLastChange} disabled={disabled} />
        </View>
      ) : null}
      <View style={[styles.panel, {height: plan.length > 0 ? PANEL_HEIGHT_PLANNED : PANEL_HEIGHT}]}>
        <DetailsPanel
          outline={outline}
          view={view}
          disabled={disabled || !!moving}
          onReviewPage={onReviewPage}
          onGoToPage={onGoToPage}
        />
      </View>
    </View>
  );
}

/** "# Paper and speed · 4 paragraphs" */
function entryHeader(entry: ContentsEntry, paragraphs: number): string {
  const hashes = entry.kind === 'heading' ? `${'#'.repeat(entry.level)} ` : '';
  return `${hashes}${entry.title} · ${plural(paragraphs, 'paragraph')}`;
}

/** What the check found: the pages rebuilt, or what stands in the way. */
function checkNote(outline: Outline): string {
  const check = outline.check;
  if (!check) {
    return '';
  }
  if (check.blockers.length > 0) {
    return ` · blocked: ${check.blockers.map(blocker => `p.${blocker.page + 1} ${blocker.reason}`).join('; ')}`;
  }
  return check.pages.length > 0 ? ` · ${check.pages.length === 1 ? 'page' : 'pages'} ${check.pages.map(page => page + 1).join(', ')} changed` : '';
}

const styles = StyleSheet.create({
  tab: {
    flex: 1,
  },
  topLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.base,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.xs,
    minHeight: 48,
  },
  moving: {
    flex: 1,
    fontSize: FONT.medium,
    color: COLORS.text,
  },
  bold: {
    fontWeight: '700',
  },
  panes: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
    paddingHorizontal: SPACING.xl,
    gap: SPACING.lg,
  },
  contents: {
    minHeight: 0,
  },
  own: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    borderLeftWidth: 1,
    borderLeftColor: COLORS.border,
    paddingLeft: SPACING.lg,
  },
  planned: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.base,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.xs,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  plannedText: {
    flex: 1,
    fontSize: FONT.small,
    lineHeight: 20,
    color: COLORS.text,
  },
  panel: {
    borderTopWidth: 2,
    borderTopColor: COLORS.accent,
  },
});
