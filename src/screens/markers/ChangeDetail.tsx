/**
 * The detail area under the selected change in the edit-marker review
 * (technical-design-pen-edits-2.md §5–§7): for a tagged snippet its picture and its text, which is
 * edited right here (the Supernote keyboard's handwriting input fills the field); for every change
 * inside a textbox the edge control, which moves its start and end (or its place) one character
 * at a time; and the actions. Drop asks first, in this same area: a tagged snippet's handwriting
 * can stay on the page or go.
 */
import React, {useEffect, useState} from 'react';
import {Image, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {loadPenEditStrokePoints} from '../../actions/penEditReview';
import type {
  EdgeView,
  PenEditView,
  PenOperationStatus,
  RecognizedEditOperation,
} from '../../domain/markerTypes';
import PillButton from '../../ui/PillButton';
import StrokeDrawing from '../../ui/StrokeDrawing';
import {COLORS, FONT, RADII, SPACING} from '../../ui/theme';

export type PenDetail = {
  view: PenEditView;
  status: PenOperationStatus;
  /** The text as it stands: the correction, else the recognition. */
  text: string;
};

interface Props {
  operation: RecognizedEditOperation;
  pen: PenDetail | null;
  editing: boolean;
  onEditing: (editing: boolean) => void;
  busy: boolean;
  onSaveText: (text: string | null) => void;
  onSkip: (skipped: boolean) => void;
  onRecognizeAgain: () => void;
  onNudge: (edge: 'start' | 'end', delta: number) => void;
  /** Null when the change can't be dropped (nothing of it may be removed from the page). */
  onDrop: (() => void) | null;
}

export default function ChangeDetail({
  operation,
  pen,
  editing,
  onEditing,
  busy,
  onSaveText,
  onSkip,
  onRecognizeAgain,
  onNudge,
  onDrop,
}: Props): React.JSX.Element {
  const [draft, setDraft] = useState(pen?.text ?? '');
  useEffect(() => {
    if (!editing) {
      setDraft(pen?.text ?? '');
    }
  }, [editing, pen?.text]);

  if (pen && editing) {
    return (
      <View style={styles.area}>
        <View style={styles.penRow}>
          <Handwriting view={pen.view} />
          <View style={styles.penInfo}>
            <Text style={styles.label}>Editing the text of {pen.view.number}</Text>
            <TextInput
              style={styles.field}
              value={draft}
              onChangeText={setDraft}
              multiline
              autoFocus
              textAlignVertical="top"
              accessibilityLabel={`Text of ${pen.view.number}`}
            />
          </View>
        </View>
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
          <Text style={styles.hint}>Only this text changes; the note page stays as it is.</Text>
        </View>
        {operation.edgeView ? <ResultLine view={operation.edgeView} /> : null}
      </View>
    );
  }

  const skipped = pen?.status === 'skipped';
  return (
    <View style={styles.area}>
      {pen ? (
        <View style={styles.penRow}>
          <Handwriting view={pen.view} />
          <View style={styles.penInfo}>
            <Text style={styles.label}>
              {pen.status === 'recognizing' ? 'Being recognized…' : 'Recognized · tap to edit'}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Edit the text of ${pen.view.number}`}
              disabled={busy || pen.status === 'recognizing'}
              onPress={() => onEditing(true)}
              style={styles.textButton}>
              <Text style={styles.penText} numberOfLines={3}>
                {pen.text || STATUS_HINT[pen.status]}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {operation.uncertain ? <Text style={styles.check}>Check the place: {operation.uncertain}</Text> : null}
      {operation.edgeView ? (
        <EdgeControl view={operation.edgeView} disabled={busy} onNudge={onNudge} />
      ) : null}
      <View style={styles.buttons}>
        {pen ? (
          <>
            <PillButton
              size="small"
              label={skipped ? 'Include' : 'Skip for later'}
              onPress={() => onSkip(!skipped)}
              disabled={busy}
            />
            <PillButton
              size="small"
              label="Recognize again"
              onPress={onRecognizeAgain}
              disabled={busy || pen.status === 'recognizing'}
            />
          </>
        ) : null}
        {onDrop ? <PillButton size="small" label="Drop" onPress={onDrop} disabled={busy} /> : null}
      </View>
    </View>
  );
}

const STATUS_HINT: Record<PenOperationStatus, string> = {
  recognizing: '…',
  ready: '',
  skipped: 'skipped for later',
  failed: 'Not recognized: tap to write the text',
  empty: 'No text recognized: tap to write the text',
};

/** The picture taken when tagging; without one, the handwriting drawn from its stored strokes. */
function Handwriting({view}: {view: PenEditView}): React.JSX.Element {
  const [strokes, setStrokes] = useState<number[][] | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    if (view.pictureUri) {
      return;
    }
    loadPenEditStrokePoints(view.id)
      .then(points => alive && setStrokes(points))
      .catch(error => {
        console.warn('[ChangeDetail] strokes not read', String(error));
        if (alive) {
          setStrokes(null);
        }
      });
    return () => {
      alive = false;
    };
  }, [view.id, view.pictureUri]);
  if (view.pictureUri) {
    return <Image source={{uri: view.pictureUri}} style={styles.picture} resizeMode="contain" />;
  }
  if (strokes && strokes.length > 0) {
    return <StrokeDrawing strokes={strokes} style={styles.picture} />;
  }
  return (
    <View style={[styles.picture, styles.noPicture]}>
      <Text style={styles.hint}>{strokes === undefined ? 'Reading…' : 'No picture kept.'}</Text>
    </View>
  );
}

/**
 * Start and End (or the one Place of an insertion or break): the characters around the edge with
 * a bar where it is, and ‹ › to move it by one character.
 */
function EdgeControl({
  view,
  disabled,
  onNudge,
}: {
  view: EdgeView;
  disabled: boolean;
  onNudge: (edge: 'start' | 'end', delta: number) => void;
}): React.JSX.Element {
  return (
    <View style={styles.edges}>
      <EdgeRow
        label={view.zeroLength ? 'Place' : 'Start'}
        context={view.startContext}
        disabled={disabled}
        onMove={delta => onNudge('start', delta)}
      />
      {view.zeroLength ? null : (
        <EdgeRow label="End" context={view.endContext} disabled={disabled} onMove={delta => onNudge('end', delta)} />
      )}
      <ResultLine view={view} />
    </View>
  );
}

function EdgeRow({
  label,
  context,
  disabled,
  onMove,
}: {
  label: string;
  context: {before: string; after: string};
  disabled: boolean;
  onMove: (delta: number) => void;
}): React.JSX.Element {
  return (
    <View style={styles.edgeRow}>
      <Text style={styles.edgeLabel}>{label}</Text>
      <PillButton
        size="small"
        label="‹"
        accessibilityLabel={`${label} one character earlier`}
        onPress={() => onMove(-1)}
        disabled={disabled}
      />
      <View style={styles.edgeText}>
        <Text style={styles.edgeChars} numberOfLines={1}>
          {context.before}
        </Text>
        <View style={styles.bar} />
        <Text style={styles.edgeChars} numberOfLines={1}>
          {context.after}
        </Text>
      </View>
      <PillButton
        size="small"
        label="›"
        accessibilityLabel={`${label} one character later`}
        onPress={() => onMove(1)}
        disabled={disabled}
      />
    </View>
  );
}

function ResultLine({view}: {view: EdgeView}): React.JSX.Element {
  return (
    <Text style={styles.result} numberOfLines={2}>
      {view.result}
    </Text>
  );
}

/**
 * Drop, asked in place: a tagged snippet's handwriting can stay or go; a plain mark only goes.
 * The change is not applied either way.
 */
export function DropConfirm({
  title,
  withHandwriting,
  busy,
  onDrop,
  onCancel,
}: {
  title: string;
  withHandwriting: boolean;
  busy: boolean;
  onDrop: (eraseHandwriting: boolean) => void;
  onCancel: () => void;
}): React.JSX.Element {
  return (
    <View style={[styles.area, styles.confirm]}>
      <Text style={styles.confirmTitle}>{title}</Text>
      <Text style={styles.hint}>
        {withHandwriting
          ? 'The text stays as it is. Keep: the numbers and the mark go, your writing stays. Erase: the writing goes too (a backup is written first).'
          : 'The text stays as it is; the mark is erased from the page.'}
      </Text>
      <View style={styles.buttons}>
        {withHandwriting ? (
          <>
            <PillButton size="small" label="Drop, keep handwriting" onPress={() => onDrop(false)} disabled={busy} />
            <PillButton size="small" label="Drop and erase handwriting" onPress={() => onDrop(true)} disabled={busy} />
          </>
        ) : (
          <PillButton size="small" label="Drop and erase the mark" onPress={() => onDrop(false)} disabled={busy} />
        )}
        <PillButton size="small" label="Cancel" onPress={onCancel} disabled={busy} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  area: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: SPACING.sm,
    marginTop: SPACING.sm,
    gap: SPACING.sm,
  },
  penRow: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  picture: {
    width: 220,
    height: 110,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  noPicture: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  penInfo: {
    flex: 1,
    gap: SPACING.xs,
  },
  label: {
    fontSize: FONT.small - 2,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: COLORS.muted,
  },
  textButton: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: COLORS.accent,
    borderRadius: RADII.md,
    padding: SPACING.sm,
  },
  penText: {
    fontSize: FONT.medium,
    fontWeight: '700',
    color: COLORS.text,
  },
  field: {
    height: 110,
    borderWidth: 2,
    borderColor: COLORS.accent,
    borderRadius: RADII.md,
    padding: SPACING.sm,
    fontSize: FONT.large,
    color: COLORS.text,
  },
  check: {
    fontSize: FONT.small,
    color: COLORS.text,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: COLORS.accent,
    borderRadius: RADII.md,
    padding: SPACING.sm,
  },
  edges: {
    gap: SPACING.xs,
  },
  edgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  edgeLabel: {
    width: 52,
    fontSize: FONT.small,
    color: COLORS.muted,
  },
  edgeText: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADII.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
  },
  edgeChars: {
    fontSize: FONT.large,
    color: COLORS.text,
  },
  bar: {
    width: 3,
    height: 28,
    marginHorizontal: 4,
    backgroundColor: COLORS.accent,
  },
  result: {
    fontSize: FONT.small,
    color: COLORS.text,
  },
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  hint: {
    fontSize: FONT.small,
    color: COLORS.muted,
  },
  confirm: {
    borderWidth: 2,
    borderColor: COLORS.accent,
    borderRadius: RADII.md,
    padding: SPACING.md,
  },
  confirmTitle: {
    fontSize: FONT.medium,
    fontWeight: '700',
    color: COLORS.text,
  },
});
