/**
 * The small card of "Comment or Image" (technical-design-comments-images.md §3.1): the lassoed
 * handwriting is kept as a Comment or an Image, or nothing is written (Cancel). A choice writes the
 * entry and the sign and closes the card; if that fails, the result card says why.
 */
import React, {useEffect, useState} from 'react';
import {Text, View} from 'react-native';
import type {NoteKind} from '../../domain/penEditTags';
import type {PenEditTagOutcome} from '../../actions/penEditTag';
import PillButton from '../../ui/PillButton';
import {requestEinkRefresh} from '../../utils/screenRefresh';
import {cardStyles} from './PenEditOutcomeScreen';

interface Props {
  onChoose: (kind: NoteKind) => Promise<PenEditTagOutcome | null>;
  onCancel: () => void;
  /** The sign is on the page: the card closes. */
  onDone: () => void;
  /** The choice failed: its outcome is shown instead. */
  onFailed: (outcome: PenEditTagOutcome) => void;
}

export default function NoteKindCard({onChoose, onCancel, onDone, onFailed}: Props): React.JSX.Element {
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    requestEinkRefresh();
  }, [saving]);

  const choose = (kind: NoteKind) => {
    setSaving(true);
    onChoose(kind)
      .then(outcome => (outcome ? onFailed(outcome) : onDone()))
      .catch(error => onFailed({kind: 'failed', detail: error instanceof Error ? error.message : String(error)}));
  };

  return (
    <View style={cardStyles.screen}>
      <View style={cardStyles.card}>
        <Text style={cardStyles.title}>Keep this handwriting as</Text>
        <Text style={cardStyles.message}>Comment and Image belong to the paragraph beside them. They never change the text.</Text>
        {saving ? <Text style={cardStyles.message}>Saving the tag…</Text> : null}
        <View style={cardStyles.buttons}>
          <PillButton label="Cancel" onPress={onCancel} disabled={saving} />
          <PillButton label="Image" primary onPress={() => choose('image')} disabled={saving} />
          <PillButton label="Comment" primary onPress={() => choose('comment')} disabled={saving} />
        </View>
      </View>
    </View>
  );
}
