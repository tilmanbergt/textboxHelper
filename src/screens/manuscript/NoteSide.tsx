/**
 * The side of a comment or an image in the Notes tab (technical-design-comments-images.md §5.2;
 * canvas artboards 8 and 9). Every action writes at once; nothing waits for Apply.
 *
 * - Comment: its handwriting large; "Read as" with Read (recognized only when asked) and Correct;
 *   Belongs to: the page map with the note and its paragraph framed, the paragraph's first words,
 *   ‹ Paragraph above · Paragraph below ›; Done ✓ (toggles; the row greys) · Use as text › (back
 *   to "?") · Drop (the sign goes, the handwriting stays).
 * - Image: its picture; Belongs to with ‹ ›; Place: Before ¶ n · After ¶ n; "Written to the file
 *   in a later version"; Update image (the picture from its strokes as they are now) · Drop.
 */
import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import type {NoteEntry} from '../../domain/manuscriptPages';
import type {PenTextState} from '../../domain/markerTypes';
import {noteRowTitle, paragraphLabel} from '../../domain/notes/noteRows';
import type {Rect} from '../../domain/textboxModel';
import PageMap from '../../ui/PageMap';
import PillButton from '../../ui/PillButton';
import {COLORS, FONT, RADII, SPACING} from '../../ui/theme';
import {Handwriting} from './ChangeSide';

interface Props {
  entry: NoteEntry;
  /** The textboxes of the note's page, for the page map. */
  pageRects: Rect[];
  /** Its recognized text, for a comment. */
  penState: PenTextState | null;
  busy: boolean;
  editing: boolean;
  onEditing: (editing: boolean) => void;
  onRead: () => void;
  onSaveText: (text: string | null) => void;
  onStep: (direction: 'above' | 'below') => void;
  onDone: (done: boolean) => void;
  onPlace: (place: 'before' | 'after') => void;
  onUseAsText: () => void;
  onUpdateImage: () => void;
  onDrop: () => void;
}

export default function NoteSide({
  entry,
  pageRects,
  penState,
  busy,
  editing,
  onEditing,
  onRead,
  onSaveText,
  onStep,
  onDone,
  onPlace,
  onUseAsText,
  onUpdateImage,
  onDrop,
}: Props): React.JSX.Element {
  const {row} = entry;
  const comment = row.kind === 'comment';
  const [asking, setAsking] = useState(false);
  useEffect(() => setAsking(false), [entry.key]);
  const gone = 'gone' in row.paragraph && row.paragraph.gone;

  return (
    <View style={styles.side}>
      <View>
        <Text style={styles.title}>{noteRowTitle(row)}</Text>
        <Text style={styles.meta}>{`Page ${entry.page + 1}${comment && row.note.done ? ' · done' : ''}`}</Text>
      </View>
      <Handwriting key={`${row.id}:${row.pictureUri ?? 'strokes'}`} view={{id: row.id, kind: row.kind, number: null, pictureUri: row.pictureUri}} />
      {comment ? (
        <ReadAs penState={penState} busy={busy} editing={editing} onEditing={onEditing} onRead={onRead} onSaveText={onSaveText} />
      ) : null}
      <View>
        <Text style={styles.label}>Belongs to</Text>
        <View style={styles.mapRow}>
          <PageMap rects={pageRects} frame={row.rect} second={row.at && row.at.page === entry.page ? row.at.rect : null} width={90} height={120} />
          <View style={styles.belongs}>
            <Text style={styles.words} numberOfLines={3}>
              {row.at ? `${paragraphLabel(row)}: "${row.at.words}"` : 'No paragraph on this page.'}
            </Text>
            {gone ? <Text style={styles.hint}>Your paragraph is gone: nearest one shown.</Text> : null}
            <View style={styles.buttons}>
              <PillButton size="small" label="‹ Paragraph above" onPress={() => onStep('above')} disabled={busy} />
              <PillButton size="small" label="Paragraph below ›" onPress={() => onStep('below')} disabled={busy} />
            </View>
          </View>
        </View>
      </View>
      {!comment && row.at ? (
        <View>
          <Text style={styles.label}>Place</Text>
          <View style={styles.buttons}>
            <PillButton size="small" label={`Before ¶ ${row.at.number}`} primary={row.note.place === 'before'} onPress={() => onPlace('before')} disabled={busy} />
            <PillButton size="small" label={`After ¶ ${row.at.number}`} primary={row.note.place !== 'before'} onPress={() => onPlace('after')} disabled={busy} />
          </View>
          <Text style={styles.hint}>Written to the file in a later version.</Text>
        </View>
      ) : null}
      {asking ? (
        <NoteDropConfirm
          kind={row.kind}
          busy={busy}
          onDrop={() => {
            setAsking(false);
            onDrop();
          }}
          onCancel={() => setAsking(false)}
        />
      ) : (
        <View style={styles.buttons}>
          {comment ? (
            <>
              <PillButton size="small" primary label={row.note.done ? 'Done ✓' : 'Done'} onPress={() => onDone(!row.note.done)} disabled={busy} />
              <PillButton size="small" label="Use as text ›" onPress={onUseAsText} disabled={busy} />
            </>
          ) : (
            <PillButton size="small" label="Update image" onPress={onUpdateImage} disabled={busy} />
          )}
          <PillButton size="small" label="Drop" onPress={() => setAsking(true)} disabled={busy} />
        </View>
      )}
    </View>
  );
}

/** Drop's question for a comment or image: its sign goes, its handwriting stays (§5.4). */
export function NoteDropConfirm({
  kind,
  busy,
  onDrop,
  onCancel,
}: {
  kind: 'comment' | 'image';
  busy: boolean;
  onDrop: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.confirm}>
      <Text style={styles.confirmTitle}>{`Drop ${kind}? The handwriting stays.`}</Text>
      <View style={styles.buttons}>
        <PillButton size="small" label="Drop" onPress={onDrop} disabled={busy} />
        <PillButton size="small" label="Cancel" onPress={onCancel} disabled={busy} />
      </View>
    </View>
  );
}

/** "Read as …": a comment is recognized only when asked (Read); its text can be corrected. */
function ReadAs({
  penState,
  busy,
  editing,
  onEditing,
  onRead,
  onSaveText,
}: {
  penState: PenTextState | null;
  busy: boolean;
  editing: boolean;
  onEditing: (editing: boolean) => void;
  onRead: () => void;
  onSaveText: (text: string | null) => void;
}): React.JSX.Element {
  const text = penState ? (penState.correctedText ?? penState.text).trim() : '';
  const [draft, setDraft] = useState(text);
  useEffect(() => {
    if (!editing) {
      setDraft(text);
    }
  }, [editing, text]);
  const reading = penState?.status === 'recognizing';
  if (editing) {
    return (
      <View>
        <Text style={styles.label}>Read as</Text>
        <TextInput style={styles.field} value={draft} onChangeText={setDraft} multiline autoFocus textAlignVertical="top" accessibilityLabel="Text of the comment" />
        <View style={styles.buttons}>
          <PillButton
            size="small"
            primary
            label="Done"
            onPress={() => {
              onSaveText(draft.trim() ? draft : null);
              onEditing(false);
            }}
          />
          <PillButton size="small" label="Cancel" onPress={() => onEditing(false)} />
        </View>
      </View>
    );
  }
  return (
    <View>
      <Text style={styles.label}>Read as</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Correct the text of the comment" disabled={busy || !text} onPress={() => onEditing(true)}>
        <Text style={styles.words} numberOfLines={3}>
          {reading ? 'Reading…' : text ? `"${text}"` : 'Not read yet.'}
        </Text>
      </Pressable>
      <View style={styles.buttons}>
        <PillButton size="small" label="Read" onPress={onRead} disabled={busy || reading} />
        <PillButton size="small" label="Correct" onPress={() => onEditing(true)} disabled={busy || reading} />
      </View>
    </View>
  );
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
  label: {
    fontSize: FONT.small - 2,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: COLORS.muted,
  },
  words: {
    fontSize: FONT.medium,
    color: COLORS.text,
  },
  hint: {
    fontSize: FONT.small,
    color: COLORS.muted,
  },
  mapRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.md,
  },
  belongs: {
    flex: 1,
    gap: SPACING.xs,
  },
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  field: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: COLORS.accent,
    borderRadius: RADII.sm,
    padding: SPACING.sm,
    fontSize: FONT.medium,
    color: COLORS.text,
  },
  confirm: {
    gap: SPACING.sm,
    padding: SPACING.sm,
    borderWidth: 2,
    borderColor: COLORS.accent,
    borderRadius: RADII.sm,
  },
  confirmTitle: {
    fontSize: FONT.medium,
    fontWeight: '700',
    color: COLORS.text,
  },
});
