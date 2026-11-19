/**
 * The small card "Insertion or Replacement" opens only when something went wrong or needs a word
 * (technical-design-pen-edits.md §3.4, technical-design-pen-edits-2.md §4.3). A successful tag
 * opens nothing: the badges and numbers on the page are the confirmation. A snippet without a mark
 * is offered Select mark: the user draws or lassos the mark and taps the button again.
 */
import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {startSelectMark} from '../../actions/penEditReview';
import type {PenEditTagOutcome} from '../../actions/penEditTag';
import PillButton from '../../ui/PillButton';
import {COLORS, FONT, RADII, SPACING} from '../../ui/theme';
import {requestEinkRefresh} from '../../utils/screenRefresh';

function texts(outcome: PenEditTagOutcome): {title: string; body: string} {
  switch (outcome.kind) {
    case 'noMark':
      return {
        title: `No mark found for text ${outcome.number}`,
        body:
          'The text is tagged, but no replace mark or caret was found just before it. Select mark: ' +
          'draw the mark (or lasso the one you drew) and tap "Insertion or Replacement" again within ' +
          '5 minutes. Or fix it later: until then it shows under Ignored in the review.',
      };
    case 'markNotRead':
      return {
        title: `Not read as a mark for text ${outcome.number}`,
        body:
          'Lasso only the mark: a line through the words with a small loop at its end, or a caret ' +
          '(V, ∧, < or >). Then tap "Insertion or Replacement" again.',
      };
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

  // The card may open before the tag is stored; it redraws when the final outcome arrives.
  const saving = outcome.kind === 'noMark' && !!outcome.saving;
  useEffect(() => {
    requestEinkRefresh();
  }, [error, outcome]);

  const selectMark = () => {
    if (outcome.kind !== 'noMark' || outcome.saving) {
      return;
    }
    startSelectMark(outcome.id, 'tag')
      .then(onClose)
      .catch(caught => {
        console.warn('[PenEdit] select mark not stored', String(caught));
        setError('Could not remember the text for Select mark. Please try again.');
      });
  };

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        {body ? <Text style={styles.message}>{body}</Text> : null}
        {saving ? <Text style={styles.message}>Saving the tag…</Text> : null}
        {error ? <Text style={styles.message}>{error}</Text> : null}
        <View style={styles.buttons}>
          {outcome.kind === 'noMark' ? (
            <>
              <PillButton label="Fix in review" onPress={onClose} disabled={saving} />
              <PillButton label="Select mark now" primary onPress={selectMark} disabled={saving} />
            </>
          ) : (
            <PillButton label="OK" primary onPress={onClose} />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  buttons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: SPACING.sm,
  },
});
