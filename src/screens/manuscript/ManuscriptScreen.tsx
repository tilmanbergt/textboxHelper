/**
 * The Manuscript card (technical-design-manuscript.md §6; canvas row "Manuscript"): one card for
 * the whole note, with two tabs. Review: the pen marks, shaping the text. Outline: the order of
 * the textboxes, shaping the document. Edits first, then structure: a page with edits waiting can't
 * be rebuilt, and the Outline's button leads to the Review of that page. The dashed slot for the later file (desk) part is not
 * built. Details (calibration, diagnostics) is a sub-screen with the Review's state.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {plural} from '../../domain/plural';
import CountTabs from '../../ui/CountTabs';
import ScreenFrame, {type FramePrimary} from '../../ui/ScreenFrame';
import {SPACING} from '../../ui/theme';
import ManuscriptDetailsScreen from './ManuscriptDetailsScreen';
import OutlineTab from './OutlineTab';
import ReviewTab, {reviewContext} from './ReviewTab';
import {useManuscriptReview} from './useManuscriptReview';
import {useOutline, type Outline} from './useOutline';

type Tab = 'review' | 'outline';

interface Props {
  onClose: () => void;
  /** The pen edit whose mark was just selected (Select mark): shown first. */
  focusPenEditId?: string | null;
}

export default function ManuscriptScreen({
  onClose,
  focusPenEditId = null,
}: Props): React.JSX.Element {
  const review = useManuscriptReview();
  const outline = useOutline(review.note, review.pages);
  const [view, setView] = useState<'card' | 'details'>('card');
  const [tab, setTab] = useState<Tab>('review');
  const [reviewBlocked, setReviewBlocked] = useState(false);
  const [showPage, setShowPage] = useState<number | null>(null);
  const onBlockedChange = useCallback(
    (blocked: boolean) => setReviewBlocked(blocked),
    [],
  );
  // An apply changes the textboxes: the Outline reads them again when it opens.
  const {clear: clearOutline} = outline;
  useEffect(() => {
    if (review.applied) {
      clearOutline();
    }
  }, [clearOutline, review.applied]);
  // And the Outline's changes move textboxes: the Review reads its pages again.
  const refreshReview = useRef(review.refresh);
  refreshReview.current = review.refresh;
  useEffect(() => {
    if (outline.applied) {
      refreshReview.current();
    }
  }, [outline.applied]);

  if (view === 'details') {
    return (
      <ManuscriptDetailsScreen
        review={review}
        onBack={() => setView('card')}
        onClose={onClose}
      />
    );
  }

  const {view: changes, loading, busy, applied} = review;
  const reviewPage = (page: number) => {
    setShowPage(page);
    setTab('review');
  };
  const primary =
    tab === 'outline'
      ? outlinePrimary(outline, onClose, reviewPage)
      : applied
      ? {label: 'Close', onPress: onClose}
      : {
          label:
            changes.readyCount > 0
              ? `Apply ${plural(changes.readyCount, 'edit')}`
              : 'Nothing to apply',
          onPress: review.apply,
          disabled: changes.plans.length === 0 || loading || reviewBlocked,
          busy,
          busyLabel: 'Applying…',
        };
  const focusNote =
    !focusPenEditId || loading
      ? null
      : changes.entries.some(
          entry => entry.operation.penEditId === focusPenEditId,
        )
      ? 'Mark found: the change is in the list now.'
      : changes.attention.some(item => item.marker.penEditId === focusPenEditId)
      ? 'Mark selected, but the text still needs attention: see the line above the list.'
      : null;
  const status =
    tab === 'outline'
      ? outline.status ?? review.status
      : review.status ?? (focusNote ? {text: focusNote} : null);

  return (
    <ScreenFrame
      title="Manuscript"
      context={reviewContext(review)}
      actions={[{label: 'Details', onPress: () => setView('details')}]}
      help={{title: 'Edit marks', marks: true}}
      onClose={onClose}
      status={status}
      primary={primary}
      screenKey={`manuscript-${tab}`}>
      <View style={styles.tabs}>
        <CountTabs<Tab>
          tabs={[
            {key: 'review', label: 'Review', count: changes.entries.length},
            {key: 'outline', label: 'Outline', count: outline.blocks?.length},
          ]}
          activeKey={tab}
          onChange={setTab}
        />
      </View>
      {tab === 'review' ? (
        <ReviewTab
          review={review}
          onClose={onClose}
          focusPenEditId={focusPenEditId}
          onBlockedChange={onBlockedChange}
          showPage={showPage}
        />
      ) : (
        <OutlineTab
          outline={outline}
          disabled={busy || loading}
          onReviewPage={reviewPage}
        />
      )}
    </ScreenFrame>
  );
}

/**
 * The Outline's button: Apply the planned changes; when edits wait on a page they touch, go to the
 * Review first; Close when nothing is planned (or after the apply).
 */
function outlinePrimary(
  outline: Outline,
  onClose: () => void,
  reviewPage: (page: number) => void,
): FramePrimary {
  const count = outline.plan.length;
  if (outline.applied || count === 0) {
    return {label: 'Close', onPress: onClose};
  }
  const blockers = outline.check?.blockers ?? [];
  const edits = blockers.find(
    blocker => blocker.kind === 'edits' || blocker.kind === 'unread',
  );
  if (edits) {
    return {
      label: `Review page ${edits.page + 1} first`,
      onPress: () => reviewPage(edits.page),
    };
  }
  return {
    label: `Apply ${plural(count, 'change')}`,
    onPress: outline.apply,
    disabled: outline.checking || !outline.check || blockers.length > 0,
    busy: outline.busy,
    busyLabel: 'Applying…',
  };
}

const styles = StyleSheet.create({
  tabs: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.sm,
  },
});
