/**
 * The rows of the Notes tab (technical-design-comments-images.md §5.2): the sign (bubble or
 * frame, never a circle), kind and paragraph ("Comment · ¶ 1", "Image · after ¶ 2"), and the
 * recognized text or "handwriting"; a comment checked off stays, greyed.
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {NoteEntry} from '../../domain/manuscriptPages';
import type {PenTextState} from '../../domain/markerTypes';
import {noteRowTitle} from '../../domain/notes/noteRows';
import {noteIsDone} from '../../domain/reviewLists';
import EmptyState from '../../ui/EmptyState';
import NoteSign from '../../ui/NoteSign';
import PagedSection from '../../ui/PagedSection';
import {COLORS, FONT, LINE_HEIGHT, RADII, SPACING} from '../../ui/theme';

/** A row: border, padding, the title line, one line of text, the meta line. */
const ROW_HEIGHT = 2 * 2 + 2 * SPACING.sm + LINE_HEIGHT.small * 2 + LINE_HEIGHT.medium;

/** What a row says under its title: the text read from the handwriting, or "handwriting". */
export function noteText(entry: NoteEntry, penStates: Record<string, PenTextState>): string {
  const state = penStates[entry.row.id];
  const text = state ? (state.correctedText ?? state.text).trim() : '';
  return text ? `"${text}"` : entry.row.kind === 'image' ? 'image' : 'handwriting';
}

interface Props {
  entries: NoteEntry[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  penStates: Record<string, PenTextState>;
  severalPages: boolean;
  resetKey: string;
}

export default function NotesList({entries, selectedKey, onSelect, penStates, severalPages, resetKey}: Props): React.JSX.Element {
  return (
    <PagedSection
      header="Comments and images"
      rows={entries}
      rowHeight={() => ROW_HEIGHT}
      resetKey={resetKey}
      viewportContent={
        entries.length === 0 ? (
          <EmptyState title="No comments or images" text="Lasso handwriting beside the text and tap Comment or Image." />
        ) : undefined
      }
      renderRow={entry => {
        const selected = entry.key === selectedKey;
        const done = noteIsDone(entry);
        const title = noteRowTitle(entry.row);
        return (
          <Pressable
            key={entry.key}
            accessibilityRole="button"
            accessibilityState={{selected}}
            accessibilityLabel={title}
            onPress={() => onSelect(entry.key)}
            style={[styles.row, selected && styles.rowSelected]}>
            <NoteSign kind={entry.row.kind} faint={done} />
            <View style={styles.body}>
              <Text style={[styles.kind, done && styles.done]}>{title}</Text>
              <Text style={[styles.text, done && styles.done]} numberOfLines={1}>
                {noteText(entry, penStates)}
              </Text>
              <Text style={styles.meta}>{[severalPages ? `p.${entry.page + 1}` : null, done ? 'done' : null].filter(Boolean).join(' · ')}</Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.md,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    borderWidth: 2,
    borderColor: 'transparent',
    borderBottomColor: COLORS.border,
    borderRadius: RADII.md,
  },
  rowSelected: {
    borderColor: COLORS.accent,
    borderBottomColor: COLORS.accent,
  },
  body: {
    flex: 1,
  },
  kind: {
    fontSize: FONT.small,
    lineHeight: LINE_HEIGHT.small,
    fontWeight: '700',
    color: COLORS.text,
  },
  text: {
    fontSize: FONT.medium,
    lineHeight: LINE_HEIGHT.medium,
    color: COLORS.text,
  },
  meta: {
    fontSize: FONT.small,
    lineHeight: LINE_HEIGHT.small,
    color: COLORS.muted,
  },
  done: {
    color: COLORS.muted,
  },
});
