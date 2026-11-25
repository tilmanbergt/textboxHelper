/**
 * The side of a To decide item (technical-design-mark-dialogue.md §5.3), in three kinds:
 *
 * - Place open: the mark's picture, why it didn't place, Place ‹ › from the nearest place found
 *   (running over line ends), the result line, Here · Drop.
 * - "?" (text without a mark): its handwriting and recognized text (Correct), where it is on the
 *   page, Select mark ›, Insert right here, keep as Comment or Image
 *   (technical-design-comments-images.md §5.3), Drop.
 * - Unclear: its picture, the words under it, why; one button per reading pass 1 found, then that
 *   reading's edges, result and Here; Ignore, and Remove for strokes on the text.
 * - A comment or image without a paragraph on its page (technical-design-comments-images.md
 *   §5.3): where it is, ‹ Paragraph above · Paragraph below › from the pages beside it, Drop.
 */
import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {DecideEntry} from '../../domain/manuscriptPages';
import {nudgeShift, type EdgeShift} from '../../domain/edgeShift';
import {decideView} from '../../domain/marks/decide';
import type {PenEditView} from '../../domain/markerTypes';
import type {NoteKind} from '../../domain/penEditTags';
import PageMap from '../../ui/PageMap';
import PillButton from '../../ui/PillButton';
import StrokeDrawing from '../../ui/StrokeDrawing';
import {COLORS, FONT, RADII, SPACING} from '../../ui/theme';
import {EdgeControl, PenText, type PenDetail} from './ChangeSide';

interface Props {
  entry: DecideEntry;
  /** The page's textboxes, for the page map. */
  pageRects: Array<{left: number; top: number; right: number; bottom: number}>;
  /** The text's view and its text, for place open and "?". */
  pen: PenDetail | null;
  /** The new text a place open puts in (the pen text), for its result line. */
  insert: string;
  busy: boolean;
  editing: boolean;
  onEditing: (editing: boolean) => void;
  onSaveText: (text: string | null) => void;
  onHere: (edges: EdgeShift | null, option?: number) => void;
  onSelectMark: () => void;
  onPlaceHere: () => void;
  /** "?" kept as a comment or an image. */
  onKeepAs: (kind: NoteKind) => void;
  /** A note without a paragraph: choose the one before or after it on the pages beside it. */
  onStepParagraph: (direction: 'above' | 'below') => void;
  onIgnore: () => void;
  /** Null when there is nothing to drop or remove. */
  onDrop: (() => void) | null;
  /** Drop's question, shown in place of the actions while it is asked. */
  dropConfirm: React.ReactNode;
}

export default function ToDecideSide({
  entry,
  pageRects,
  pen,
  insert,
  busy,
  editing,
  onEditing,
  onSaveText,
  onHere,
  onSelectMark,
  onPlaceHere,
  onKeepAs,
  onStepParagraph,
  onIgnore,
  onDrop,
  dropConfirm,
}: Props): React.JSX.Element {
  const {item, page} = entry;
  const [edges, setEdges] = useState<EdgeShift | null>(null);
  const [option, setOption] = useState<number | null>(null);
  useEffect(() => {
    setEdges(null);
    setOption(item.options && item.options.length === 1 ? 0 : null);
  }, [entry.key, item.options]);

  const nudge = (edge: number, delta: number) => setEdges(current => nudgeShift(current, edge, delta));
  const chosen = option !== null ? item.options?.[option] ?? null : null;
  const place = item.kind === 'unclear' ? chosen?.at ?? null : item.guess;
  const text = item.kind === 'unclear' ? chosen?.text ?? '' : item.text ?? '';
  const view = place && text ? decideView(text, place, edges, item.kind === 'placeOpen' ? insert : '') : null;
  const where = [`Page ${page + 1}`, item.paragraph ? `paragraph ${item.paragraph}` : null].filter(Boolean).join(' · ');

  return (
    <View style={styles.side}>
      <View>
        <Text style={styles.title}>
          {item.kind === 'noMark' ? `${item.summary}: no mark` : item.kind === 'noParagraph' ? `${item.summary} without a paragraph` : item.summary}
        </Text>
        <Text style={styles.meta}>{where}</Text>
      </View>
      {item.kind === 'noMark' && pen ? (
        <PenText pen={pen} editing={editing} onEditing={onEditing} busy={busy} onSaveText={onSaveText} />
      ) : null}
      {item.kind !== 'noMark' && item.strokes.length > 0 ? <StrokeDrawing strokes={item.strokes} style={styles.picture} /> : null}
      {item.kind === 'unclear' && item.words ? <Text style={styles.words}>Under it: "{item.words}"</Text> : null}
      <Text style={styles.reason}>{item.reason}</Text>
      {item.kind === 'noMark' ? (
        <View style={styles.mapRow}>
          <PageMap rects={pageRects} frame={item.rect} />
          <Text style={styles.hint}>The text is kept with a ? and waits here for its mark.</Text>
        </View>
      ) : null}
      {item.kind === 'noParagraph' ? (
        <View style={styles.mapRow}>
          <PageMap rects={pageRects} frame={item.rect} />
          <Text style={styles.hint}>It belongs to a paragraph; this page has none.</Text>
        </View>
      ) : null}
      {item.kind === 'unclear' && item.options && item.options.length > 0 ? (
        <View>
          <Text style={styles.label}>Read it as</Text>
          <View style={styles.buttons}>
            {item.options.map((choice, index) => (
              <PillButton
                key={choice.label + index}
                size="small"
                label={choice.label}
                primary={index === option}
                onPress={() => {
                  setOption(index);
                  setEdges(null);
                }}
                disabled={busy}
              />
            ))}
          </View>
          {chosen?.reason ? <Text style={styles.hint}>{chosen.reason}</Text> : null}
        </View>
      ) : null}
      {view ? (
        <View>
          <Text style={styles.label}>Place</Text>
          <EdgeControl view={view} disabled={busy} onNudge={nudge} />
        </View>
      ) : null}
      {dropConfirm ?? (
        <View style={styles.buttons}>
          {item.kind === 'placeOpen' ? (
            <PillButton size="small" primary label="Here" onPress={() => onHere(edges)} disabled={busy || !item.guess} />
          ) : null}
          {item.kind === 'unclear' && chosen?.draft ? (
            <PillButton size="small" primary label="Here" onPress={() => onHere(edges, option ?? undefined)} disabled={busy} />
          ) : null}
          {item.kind === 'noMark' ? (
            <>
              <PillButton size="small" primary label="Select mark ›" onPress={onSelectMark} disabled={busy} />
              <PillButton size="small" label="Insert right here" onPress={onPlaceHere} disabled={busy} />
              <PillButton size="small" label="Comment" onPress={() => onKeepAs('comment')} disabled={busy} />
              <PillButton size="small" label="Image" onPress={() => onKeepAs('image')} disabled={busy} />
            </>
          ) : null}
          {item.kind === 'placeOpen' && item.canPlaceHere ? (
            <PillButton size="small" label="Insert right here" onPress={onPlaceHere} disabled={busy} />
          ) : null}
          {item.kind === 'noParagraph' ? (
            <>
              <PillButton size="small" label="‹ Paragraph above" onPress={() => onStepParagraph('above')} disabled={busy} />
              <PillButton size="small" label="Paragraph below ›" onPress={() => onStepParagraph('below')} disabled={busy} />
            </>
          ) : null}
          {item.kind === 'unclear' && item.ignore ? <PillButton size="small" label="Ignore" onPress={onIgnore} disabled={busy} /> : null}
          {onDrop ? (
            <PillButton size="small" label={item.kind === 'unclear' ? 'Remove strokes' : 'Drop'} onPress={onDrop} disabled={busy} />
          ) : null}
        </View>
      )}
    </View>
  );
}

/** The text's view for the side's pen text, when the item is a pen edit's. */
export function penOf(views: PenEditView[], id: string | undefined): PenEditView | null {
  return id ? views.find(view => view.id === id) ?? null : null;
}

const styles = StyleSheet.create({
  side: {
    flex: 1,
    gap: SPACING.sm,
  },
  title: {
    fontSize: FONT.medium,
    fontWeight: '700',
    color: COLORS.text,
  },
  meta: {
    fontSize: FONT.small,
    color: COLORS.muted,
  },
  picture: {
    height: 140,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADII.sm,
  },
  words: {
    fontSize: FONT.medium,
    color: COLORS.text,
  },
  reason: {
    fontSize: FONT.small,
    color: COLORS.text,
  },
  mapRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.md,
  },
  label: {
    fontSize: FONT.small - 2,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: COLORS.muted,
  },
  hint: {
    flex: 1,
    fontSize: FONT.small,
    color: COLORS.muted,
  },
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: SPACING.sm,
  },
});
