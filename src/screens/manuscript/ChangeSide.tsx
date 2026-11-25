/**
 * The side bar of the Manuscript Review (technical-design-manuscript.md §6): the selected change.
 * From the top: its name and place; for a tagged snippet the recognized text, edited right here
 * (high up, so the writing pad never covers it) with the handwriting below; the change in its
 * text; a swap's options; the edges, each moved one character at a time (one for an insertion,
 * two for a delete or replace, three for a swap); the actions. Drop asks first, in place of the
 * actions: a tagged snippet's handwriting can stay on the page or go.
 */
import React, {useEffect, useState} from 'react';
import {Image, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {loadPenEditStrokePoints} from '../../actions/penEditReview';
import {firstWords, lastWords} from '../../domain/markerHunks';
import type {
  ChangeHunk,
  EdgePoint,
  EdgeView,
  PenEditView,
  PenOperationStatus,
  RecognizedEditOperation,
} from '../../domain/markerTypes';
import Checkbox from '../../ui/Checkbox';
import PagedText from '../../ui/PagedText';
import PillButton from '../../ui/PillButton';
import StrokeDrawing from '../../ui/StrokeDrawing';
import {COLORS, FONT, RADII, SPACING} from '../../ui/theme';
import {PUNCTUATION_CHARS, type PunctuationChar} from '../../domain/marks/shapes/punct';
import {penEditNumberText} from '../../domain/penEditTags';

export type PenDetail = {
  view: PenEditView;
  status: PenOperationStatus;
  /** The text as it stands: the correction, else the recognition. */
  text: string;
};

/** Words of context the side bar shows on each side of a change. */
const SIDE_CONTEXT_WORDS = 24;

interface Props {
  operation: RecognizedEditOperation;
  hunk: ChangeHunk;
  pen: PenDetail | null;
  editing: boolean;
  onEditing: (editing: boolean) => void;
  busy: boolean;
  onSaveText: (text: string | null) => void;
  onRecognizeAgain: () => void;
  onNudge: (edge: number, delta: number) => void;
  /** A swap's "Fix capitals" switched on or off. */
  onFixCase: (fixCase: boolean) => void;
  /** A close-up's "Also remove" switched on or off. */
  onRemovePunct: (removePunct: boolean) => void;
  /** A punctuation circle's mark picked. */
  onPunctChar: (char: PunctuationChar) => void;
  /** Null when the change can't be dropped (nothing of it may be removed from the page). */
  onDrop: (() => void) | null;
  /** Drop's question, shown in place of the actions while it is asked. */
  dropConfirm: React.ReactNode;
}

export default function ChangeSide({
  operation,
  hunk,
  pen,
  editing,
  onEditing,
  busy,
  onSaveText,
  onRecognizeAgain,
  onNudge,
  onFixCase,
  onRemovePunct,
  onPunctChar,
  onDrop,
  dropConfirm,
}: Props): React.JSX.Element {
  return (
    <View style={styles.side}>
      <View>
        <Text style={styles.title}>{hunk.label}</Text>
        <Text style={styles.meta}>{hunk.meta}</Text>
      </View>
      {pen ? (
        <PenText
          pen={pen}
          editing={editing}
          onEditing={onEditing}
          busy={busy}
          onSaveText={onSaveText}
        />
      ) : null}
      {operation.uncertain ? <Text style={styles.check}>Check the place: {operation.uncertain}</Text> : null}
      {operation.insideSwap ? (
        <Text style={styles.hint}>Inside a swap: this change is made first, then the parts change places.</Text>
      ) : null}
      <Text style={styles.label}>In its text</Text>
      <View style={styles.context}>
        <PagedText
          segments={[
            {text: lastWords(hunk.before, SIDE_CONTEXT_WORDS)},
            ...hunk.segments,
            {text: firstWords(hunk.after, SIDE_CONTEXT_WORDS)},
          ]}
          resetKey={hunk.operationId}
        />
      </View>
      {operation.swap ? <SwapDetail operation={operation} disabled={busy} onFixCase={onFixCase} /> : null}
      {operation.join?.hyphen ? (
        <Checkbox
          label={`Also remove "${operation.join.hyphen}" (no space between)`}
          checked={operation.join.removeHyphen}
          onChange={onRemovePunct}
          disabled={busy}
        />
      ) : null}
      {operation.closeUp?.punct.text ? (
        <Checkbox
          label={`Also remove "${operation.closeUp.punct.text}"`}
          checked={operation.closeUp.removePunct}
          onChange={onRemovePunct}
          disabled={busy}
        />
      ) : null}
      {operation.punct ? (
        <QuickPicks chosen={operation.punct.char} disabled={busy} onPick={onPunctChar} />
      ) : pen && !editing && pen.text.trim().length > 0 && pen.text.trim().length <= 2 ? (
        // Short recognized text is often punctuation misread: one tap sets it (fine-marks §9.7).
        <QuickPicks chosen={null} disabled={busy} onPick={onSaveText} />
      ) : null}
      {operation.edgeView ? <EdgeControl view={operation.edgeView} disabled={busy} onNudge={onNudge} /> : null}
      {dropConfirm ?? (
        <View style={styles.buttons}>
          {pen ? (
            <PillButton
              size="small"
              label="Recognize again"
              onPress={onRecognizeAgain}
              disabled={busy || pen.status === 'recognizing'}
            />
          ) : null}
          {onDrop ? <PillButton size="small" label="Drop…" onPress={onDrop} disabled={busy} /> : null}
        </View>
      )}
    </View>
  );
}

/** A tagged snippet's text: tap to edit (the Supernote's handwriting input fills the field). */
function PenText({
  pen,
  editing,
  onEditing,
  busy,
  onSaveText,
}: {
  pen: PenDetail;
  editing: boolean;
  onEditing: (editing: boolean) => void;
  busy: boolean;
  onSaveText: (text: string | null) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(pen.text);
  useEffect(() => {
    if (!editing) {
      setDraft(pen.text);
    }
  }, [editing, pen.text]);

  return (
    <View style={styles.pen}>
      {editing ? (
        <>
          <Text style={styles.label}>Text of {penEditNumberText(pen.view.number)}</Text>
          <TextInput
            style={styles.field}
            value={draft}
            onChangeText={setDraft}
            multiline
            autoFocus
            textAlignVertical="top"
            accessibilityLabel={`Text of ${penEditNumberText(pen.view.number)}`}
          />
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
        </>
      ) : (
        <>
          <Text style={styles.label}>
            {pen.status === 'recognizing' ? 'Being recognized…' : 'Recognized · tap to correct'}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Correct the text of ${penEditNumberText(pen.view.number)}`}
            disabled={busy || pen.status === 'recognizing'}
            onPress={() => onEditing(true)}
            style={styles.textButton}>
            <Text style={styles.penText} numberOfLines={4}>
              {pen.text || STATUS_HINT[pen.status]}
            </Text>
          </Pressable>
          <Handwriting view={pen.view} />
        </>
      )}
    </View>
  );
}

const STATUS_HINT: Record<PenOperationStatus, string> = {
  recognizing: '…',
  ready: '',
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

/** One button per punctuation mark: a tap sets it (technical-design-fine-marks.md §9.7). */
function QuickPicks({
  chosen,
  disabled,
  onPick,
}: {
  chosen: PunctuationChar | null;
  disabled: boolean;
  onPick: (char: PunctuationChar) => void;
}): React.JSX.Element {
  return (
    <View style={styles.buttons}>
      {PUNCTUATION_CHARS.map(char => (
        <PillButton
          key={char}
          size="small"
          label={char}
          accessibilityLabel={`Use ${char}`}
          primary={char === chosen}
          onPress={() => onPick(char)}
          disabled={disabled}
        />
      ))}
    </View>
  );
}

/** A swap: the parts in their new order, whether it waits, and "Fix capitals" where it applies. */
function SwapDetail({
  operation,
  disabled,
  onFixCase,
}: {
  operation: RecognizedEditOperation;
  disabled: boolean;
  onFixCase: (fixCase: boolean) => void;
}): React.JSX.Element | null {
  const swap = operation.swap;
  if (!swap) {
    return null;
  }
  if (swap.waitingFor && swap.waitingFor.length > 0) {
    return (
      <Text style={styles.check}>
        Waits for the change inside it: once that text is recognized (or included again), the parts
        swap with it made first.
      </Text>
    );
  }
  return (
    <View style={styles.edges}>
      <Text style={styles.result} numberOfLines={3}>
        New order: {operation.replacementText ?? ''}
      </Text>
      {swap.capsAvailable ? (
        <Checkbox
          label="Fix capitals (the new first word starts the sentence)"
          checked={swap.fixCase}
          onChange={onFixCase}
          disabled={disabled}
        />
      ) : null}
    </View>
  );
}

/** Each edge of the change (Place; Start and End; or a swap's three) with ‹ › to move it. */
function EdgeControl({
  view,
  disabled,
  onNudge,
}: {
  view: EdgeView;
  disabled: boolean;
  onNudge: (edge: number, delta: number) => void;
}): React.JSX.Element {
  return (
    <View style={styles.edges}>
      {view.edges.map((edge, index) => (
        <EdgeRow key={edge.label} edge={edge} disabled={disabled} onMove={delta => onNudge(index, delta)} />
      ))}
      {view.result ? <ResultLine view={view} /> : null}
    </View>
  );
}

function EdgeRow({
  edge,
  disabled,
  onMove,
}: {
  edge: EdgePoint;
  disabled: boolean;
  onMove: (delta: number) => void;
}): React.JSX.Element {
  return (
    <View style={styles.edgeRow}>
      <Text style={styles.edgeLabel}>{edge.label}</Text>
      <PillButton
        size="small"
        label="‹"
        accessibilityLabel={`${edge.label} one character earlier`}
        onPress={() => onMove(-1)}
        disabled={disabled}
      />
      <View style={styles.edgeText}>
        <Text style={styles.edgeChars} numberOfLines={1}>
          {edge.before}
        </Text>
        <View style={styles.bar} />
        <Text style={styles.edgeChars} numberOfLines={1}>
          {edge.after}
        </Text>
      </View>
      <PillButton
        size="small"
        label="›"
        accessibilityLabel={`${edge.label} one character later`}
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
    <View style={styles.confirm}>
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
  pen: {
    gap: SPACING.xs,
  },
  context: {
    flex: 1,
    minHeight: 80,
  },
  picture: {
    alignSelf: 'stretch',
    height: 90,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  noPicture: {
    alignItems: 'center',
    justifyContent: 'center',
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
    width: 84,
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
    gap: SPACING.sm,
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
