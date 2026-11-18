/**
 * The small card the "Replacement" and "Insertion" lasso buttons open only when something went
 * wrong or needs a word (technical-design-pen-edits.md §3.4). A successful tag opens nothing: the
 * icon and number on the page are the confirmation.
 */
import React, {useEffect} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {PenEditTagOutcome} from '../../actions/penEditTag';
import PillButton from '../../ui/PillButton';
import {COLORS, FONT, RADII, SPACING} from '../../ui/theme';
import {requestEinkRefresh} from '../../utils/screenRefresh';

function texts(outcome: PenEditTagOutcome): {title: string; body: string} {
  switch (outcome.kind) {
    case 'noMark':
      return {
        title: `Replacement ${outcome.number} tagged`,
        body:
          'No replace mark was found just before this text. Write the replacement right after its ' +
          'mark (strike through, then two short lines across). Until then it shows under Ignored in the review.',
      };
    case 'empty':
      return {title: 'Nothing to tag', body: 'Lasso handwriting to tag it as a replacement or insertion.'};
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

  useEffect(() => {
    requestEinkRefresh();
  }, []);

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        {body ? <Text style={styles.message}>{body}</Text> : null}
        <View style={styles.buttons}>
          <PillButton label="OK" primary onPress={onClose} />
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
  },
});
