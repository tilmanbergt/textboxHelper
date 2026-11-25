/**
 * The small card "Insertion or Replacement" opens only when something went wrong or needs a word
 * (technical-design-mark-dialogue.md §4.3). A successful tag opens nothing: the badges and
 * numbers on the page are the confirmation. Text without a mark keeps a "?" and is offered Select
 * mark (the user draws or lassos the mark and taps the button again) or Later (it waits in the
 * review under To decide), or kept as a Comment or an Image (technical-design-comments-images.md
 * §3.4). A selected mark that isn't clear shows its strokes and why, and offers to keep the waiting
 * text - never the strokes just selected - as a Comment or an Image.
 */
import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {loadPenEditStrokePoints, startSelectMark, stopSelectMark} from '../../actions/penEditReview';
import type {PenEditTagOutcome} from '../../actions/penEditTag';
import {convertSidemark} from '../../actions/sidemarkConvert';
import type {NoteKind} from '../../domain/penEditTags';
import PillButton from '../../ui/PillButton';
import StrokeDrawing from '../../ui/StrokeDrawing';
import {COLORS, FONT, RADII, SPACING} from '../../ui/theme';
import {requestEinkRefresh} from '../../utils/screenRefresh';

function texts(outcome: PenEditTagOutcome): {title: string; body: string} {
  switch (outcome.kind) {
    case 'noMark':
      return {
        title: 'No mark found for this text',
        body: 'It is kept with a ? and waits in the review under To decide.',
      };
    case 'markNotClear':
      return {title: 'Not a clear mark', body: outcome.reason};
    case 'empty':
      return {title: 'Nothing to tag', body: 'Lasso handwriting to tag it as an insertion or replacement.'};
    case 'failed':
      return {title: 'Not tagged', body: outcome.detail};
    default:
      return {title: 'Tagged', body: ''};
  }
}

interface Props {
  outcome: PenEditTagOutcome;
  onClose: () => void;
}

export default function PenEditOutcomeScreen({outcome, onClose}: Props): React.JSX.Element {
  const {title, body} = texts(outcome);
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  // The waiting text's handwriting, for "Or keep the waiting text as".
  const [waiting, setWaiting] = useState<number[][] | null>(null);
  const waitingId = outcome.kind === 'markNotClear' ? outcome.id : null;
  useEffect(() => {
    if (!waitingId) {
      return;
    }
    let active = true;
    loadPenEditStrokePoints(waitingId)
      .then(points => active && setWaiting(points))
      .catch(caught => console.warn('[PenEdit] waiting text not read', String(caught)));
    return () => {
      active = false;
    };
  }, [waitingId]);

  // The card may open before the tag is stored; it redraws when the final outcome arrives.
  const saving = outcome.kind === 'noMark' && !!outcome.saving;
  useEffect(() => {
    requestEinkRefresh();
  }, [error, outcome, waiting, converting]);

  const selectMark = () => {
    if ((outcome.kind !== 'noMark' && outcome.kind !== 'markNotClear') || (outcome.kind === 'noMark' && outcome.saving)) {
      return;
    }
    // Select mark now, and Try again: the text waits for the mark the user draws or lassos next.
    startSelectMark(outcome.id, 'tag')
      .then(onClose)
      .catch(caught => {
        console.warn('[PenEdit] select mark not stored', String(caught));
        setError('Could not remember the text for Select mark. Please try again.');
      });
  };

  // Comment · Image: the text (the waiting one, for "Not a clear mark") is kept as a note.
  const keepAs = (kind: NoteKind) => {
    if ((outcome.kind !== 'noMark' && outcome.kind !== 'markNotClear') || saving) {
      return;
    }
    setConverting(true);
    convertSidemark(outcome.id, kind)
      .then(onClose)
      .catch(caught => {
        console.warn('[PenEdit] not kept as a note', String(caught));
        setError(caught instanceof Error ? caught.message : String(caught));
        setConverting(false);
      });
  };
  const noteButtons = (
    <>
      <PillButton label="Comment" onPress={() => keepAs('comment')} disabled={saving || converting} />
      <PillButton label="Image" onPress={() => keepAs('image')} disabled={saving || converting} />
    </>
  );

  const cancel = () => {
    if (outcome.kind !== 'markNotClear') {
      onClose();
      return;
    }
    stopSelectMark(outcome.id)
      .catch(caught => console.warn('[PenEdit] select mark not stopped', String(caught)))
      .finally(onClose);
  };

  return (
    <View style={cardStyles.screen}>
      <View style={cardStyles.card}>
        <Text style={cardStyles.title}>{title}</Text>
        {outcome.kind === 'markNotClear' ? <StrokeDrawing strokes={outcome.strokes} style={cardStyles.picture} /> : null}
        {body ? <Text style={cardStyles.message}>{body}</Text> : null}
        {outcome.kind === 'markNotClear' ? <Text style={cardStyles.message}>The text keeps its ?.</Text> : null}
        {outcome.kind === 'noMark' ? (
          <Text style={cardStyles.message}>Comment and Image belong to the paragraph beside them.</Text>
        ) : null}
        {converting ? <Text style={cardStyles.message}>Changing the sign…</Text> : null}
        {saving ? <Text style={cardStyles.message}>Saving the tag…</Text> : null}
        {error ? <Text style={cardStyles.message}>{error}</Text> : null}
        <View style={cardStyles.buttons}>
          {outcome.kind === 'noMark' ? (
            <>
              <PillButton label="Later" onPress={onClose} disabled={saving || converting} />
              {noteButtons}
              <PillButton label="Select mark now" primary onPress={selectMark} disabled={saving || converting} />
            </>
          ) : outcome.kind === 'markNotClear' ? (
            <>
              <PillButton label="Cancel" onPress={cancel} disabled={converting} />
              <PillButton label="Try again" primary onPress={selectMark} disabled={converting} />
            </>
          ) : (
            <PillButton label="OK" primary onPress={onClose} />
          )}
        </View>
        {outcome.kind === 'markNotClear' ? (
          <View style={cardStyles.group}>
            <Text style={cardStyles.message}>Or keep the waiting text as:</Text>
            {waiting ? <StrokeDrawing strokes={waiting} style={cardStyles.small} /> : null}
            <View style={cardStyles.buttons}>{noteButtons}</View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** The card's frame, shared with `NoteKindCard`. */
export const cardStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: 620,
    borderWidth: 2,
    borderColor: COLORS.accent,
    borderRadius: RADII.md,
    padding: SPACING.xl,
    gap: SPACING.md,
    backgroundColor: COLORS.background,
  },
  title: {
    fontSize: FONT.large,
    fontWeight: '700',
    color: COLORS.text,
  },
  message: {
    fontSize: FONT.medium,
    color: COLORS.text,
  },
  picture: {
    height: 160,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADII.sm,
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: SPACING.sm,
  },
  group: {
    gap: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  small: {
    height: 90,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADII.sm,
  },
});
