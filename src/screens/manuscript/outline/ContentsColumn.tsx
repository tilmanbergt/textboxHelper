/**
 * The Outline's left column (technical-design-outline-sections.md §3, §7.1): files and headings,
 * indented by depth, one line each. The open entry is filled black; ✎ n counts edits waiting in its
 * own text; planned changes show as a short mark ("was #", "set aside"); with a filter, entries
 * without matches are grey and their unmatched subheadings folded in ("▸ n"). In Move to mode each
 * entry the moving block can go to has a → at its right edge; the current one says "here".
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {ContentsRow} from '../../../domain/outlineContents';
import type {ChangeMark, MoveTarget, PlannedOrder} from '../../../domain/outlinePlan';
import {GLYPH} from '../../../ui/glyphs';
import PagedSection from '../../../ui/PagedSection';
import {COLORS, FONT, RADII, SPACING} from '../../../ui/theme';

/** Every Contents row: one line, padding and its bottom line (design-device-rendering.md §3). */
export const CONTENTS_ROW_HEIGHT = 40;
const INDENT = 20;

interface Props {
  rows: ContentsRow[];
  openKey: string | null;
  planned: PlannedOrder | null;
  onOpen: (key: string) => void;
  /** Move to mode: the target for an entry, or null where the block can't go. */
  moveTarget: ((entryKey: string) => MoveTarget | null) | null;
  /** The moving block's own entry. */
  hereKey: string | null;
  onMoveTo: (target: MoveTarget) => void;
  header: string;
}

export default function ContentsColumn({
  rows,
  openKey,
  planned,
  onOpen,
  moveTarget,
  hereKey,
  onMoveTo,
  header,
}: Props): React.JSX.Element {
  return (
    <PagedSection<ContentsRow>
      header={header}
      rows={rows}
      rowHeight={() => CONTENTS_ROW_HEIGHT}
      resetKey={rows.length}
      emptyHint="No headings."
      renderRow={row => {
        const target = moveTarget ? moveTarget(row.entry.key) : null;
        return (
          <ContentsLine
            key={row.entry.key}
            row={row}
            open={row.entry.key === openKey}
            mark={planned?.marks.get(row.entry.key) ?? null}
            was={planned?.levels.get(row.entry.key)?.from ?? null}
            onPress={() => onOpen(row.entry.key)}
            moving={!!moveTarget}
            here={moveTarget !== null && row.entry.key === hereKey}
            onMoveHere={target !== null ? () => onMoveTo(target) : null}
          />
        );
      }}
    />
  );
}

function markLabel(mark: ChangeMark | null, was: number | null): string | null {
  if (mark === 'level' && was !== null) {
    return was === 0 ? 'was ¶' : `was ${'#'.repeat(was)}`;
  }
  return mark === 'aside' ? 'set aside' : mark === 'delete' ? 'delete' : mark === 'moved' ? 'moved' : null;
}

function ContentsLine({
  row,
  open,
  mark,
  was,
  onPress,
  moving,
  here,
  onMoveHere,
}: {
  row: ContentsRow;
  open: boolean;
  mark: ChangeMark | null;
  was: number | null;
  onPress: () => void;
  moving: boolean;
  here: boolean;
  onMoveHere: (() => void) | null;
}): React.JSX.Element {
  const {entry} = row;
  const hashes = entry.kind === 'heading' ? `${'#'.repeat(entry.level)} ` : '';
  const pseudo = entry.kind === 'start' || entry.kind === 'orphans' || entry.kind === 'aside';
  const label = markLabel(mark, was);
  return (
    <View style={[styles.row, open && styles.open]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{selected: open}}
        accessibilityLabel={`${entry.kind === 'file' ? 'File' : entry.kind === 'heading' ? `Heading level ${entry.level}` : ''} ${entry.title}`}
        onPress={onPress}
        style={[styles.main, {paddingLeft: SPACING.sm + entry.depth * INDENT}]}>
        {entry.kind === 'file' ? <Text style={[styles.file, open && styles.openText]}>{GLYPH.file} </Text> : null}
        <Text
          numberOfLines={1}
          style={[
            styles.title,
            (entry.kind === 'file' || entry.kind === 'heading') && styles.bold,
            pseudo && styles.pseudo,
            (row.dim || mark === 'aside' || mark === 'delete') && styles.dim,
            mark === 'delete' && styles.struck,
            (mark === 'level' || mark === 'moved') && styles.underlined,
            open && styles.openText,
          ]}>
          {hashes ? <Text style={open ? styles.openHashes : styles.hashes}>{hashes}</Text> : null}
          {entry.title}
        </Text>
        {label ? <Text style={[styles.mark, open && styles.openMark]}>{label}</Text> : null}
        {entry.pendingOwn > 0 ? (
          <Text style={[styles.count, open && styles.openText]}>
            {GLYPH.edits} {entry.pendingOwn}
          </Text>
        ) : null}
        {row.folded > 0 ? (
          <Text style={[styles.count, open && styles.openText]}>
            {GLYPH.folded}
            {row.folded}
          </Text>
        ) : null}
      </Pressable>
      {moving ? (
        here ? (
          <Text style={[styles.here, open && styles.openText]}>here</Text>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Move to ${entry.title}`}
            accessibilityState={{disabled: !onMoveHere}}
            disabled={!onMoveHere}
            onPress={onMoveHere ?? undefined}
            style={styles.to}>
            <Text style={[styles.toText, !onMoveHere && styles.dim, open && styles.openText]}>{GLYPH.to}</Text>
          </Pressable>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    height: CONTENTS_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    borderRadius: RADII.md,
  },
  open: {
    backgroundColor: COLORS.accent,
  },
  main: {
    flex: 1,
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingRight: SPACING.sm,
  },
  title: {
    flex: 1,
    fontSize: FONT.medium,
    color: COLORS.text,
    includeFontPadding: false,
  },
  bold: {
    fontWeight: '700',
  },
  pseudo: {
    fontStyle: 'italic',
    fontWeight: '400',
  },
  dim: {
    color: COLORS.muted,
  },
  struck: {
    textDecorationLine: 'line-through',
  },
  underlined: {
    textDecorationLine: 'underline',
  },
  hashes: {
    color: COLORS.muted,
    fontWeight: '400',
  },
  openHashes: {
    color: COLORS.border,
    fontWeight: '400',
  },
  openText: {
    color: COLORS.accentText,
  },
  file: {
    fontSize: FONT.medium,
    fontWeight: '700',
    color: COLORS.text,
  },
  mark: {
    fontSize: FONT.small,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.text,
    borderRadius: RADII.sm,
    paddingHorizontal: SPACING.xs,
  },
  openMark: {
    color: COLORS.accentText,
    borderColor: COLORS.accentText,
  },
  count: {
    fontSize: FONT.small,
    color: COLORS.text,
  },
  here: {
    width: 52,
    textAlign: 'center',
    fontSize: FONT.small,
    color: COLORS.muted,
  },
  to: {
    width: 52,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderLeftWidth: 1,
    borderLeftColor: COLORS.border,
  },
  toText: {
    fontSize: FONT.large,
    fontWeight: '700',
    color: COLORS.text,
  },
});
