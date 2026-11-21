/**
 * The Manuscript card (technical-design-manuscript.md §6; canvas row "Manuscript"): one card for
 * the whole note, with two tabs. Review: the pen marks, shaping the text. Outline: the order of
 * the textboxes, shaping the document. Edits first, then structure: a page with edits waiting can't
 * be rebuilt, and the Outline's button leads to the Review of that page. Details (the linked file,
 * calibration, diagnostics) is a sub-screen with the Review's state.
 *
 * A note imported linked to its text file (technical-design-source-link.md §4) names the file in
 * the header. Apply also updates the file ("Also update <file>", on every time the card opens);
 * with no edits waiting but the note differing from the file, the button is "Update <file>". A
 * protected block deleted on the page is asked about above the tabs before it leaves the file.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {plural} from '../../domain/plural';
import {blockName} from '../../domain/sourceBlocks';
import {sourceFileName} from '../../domain/sourceRecord';
import Checkbox from '../../ui/Checkbox';
import CountTabs from '../../ui/CountTabs';
import PillButton from '../../ui/PillButton';
import {jumpToNotePage} from '../../supernote/noteElements';
import ScreenFrame, {type FramePrimary, type FrameStatus} from '../../ui/ScreenFrame';
import {COLORS, FONT, SPACING} from '../../ui/theme';
import ManuscriptDetailsScreen from './ManuscriptDetailsScreen';
import OutlineTab from './OutlineTab';
import ReviewTab, {reviewContext} from './ReviewTab';
import {useManuscriptReview} from './useManuscriptReview';
import {useOutline, type Outline} from './useOutline';
import {useSourceLink, type SourceLink} from './useSourceLink';

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
  const source = useSourceLink(review.note, !review.loading);
  const [view, setView] = useState<'card' | 'details'>('card');
  const [tab, setTab] = useState<Tab>('review');
  const [reviewBlocked, setReviewBlocked] = useState(false);
  const [showPage, setShowPage] = useState<number | null>(null);
  const [jumpError, setJumpError] = useState<string | null>(null);
  // Go to a page: NOTE shows it, and the card closes so it can be seen.
  const goToPage = useCallback(
    (page: number) => {
      setJumpError(null);
      jumpToNotePage(page).then(onClose, (error: unknown) =>
        setJumpError(
          error instanceof Error
            ? error.message
            : `Could not go to page ${page + 1}.`,
        ),
      );
    },
    [onClose],
  );
  const onBlockedChange = useCallback(
    (blocked: boolean) => setReviewBlocked(blocked),
    [],
  );
  // An apply changes the textboxes: the Outline reads them again when it opens, and the linked
  // file is written (or compared again when "Also update" is off).
  const {clear: clearOutline} = outline;
  const sourceAfterApply = useRef(source);
  sourceAfterApply.current = source;
  useEffect(() => {
    if (review.applied) {
      clearOutline();
      const link = sourceAfterApply.current;
      if (link.linked && link.alsoUpdate) {
        link.write('file');
      } else if (link.linked) {
        link.refind();
      }
    }
  }, [clearOutline, review.applied]);
  // And the Outline's changes move textboxes: the Review checks its pages again (pages the
  // Outline didn't touch keep their analysis).
  const refreshReview = useRef(review.recheck);
  refreshReview.current = review.recheck;
  useEffect(() => {
    if (outline.applied) {
      refreshReview.current();
      sourceAfterApply.current.refind();
    }
  }, [outline.applied]);

  if (view === 'details') {
    return (
      <ManuscriptDetailsScreen
        review={review}
        source={source}
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
  const fileName = source.linked ? sourceFileName(source.linked.record) : null;
  const fileDiffers = !!source.linked?.diff.differs;
  const primary: FramePrimary =
    tab === 'outline'
      ? outlinePrimary(outline, onClose, reviewPage)
      : applied
      ? {label: 'Close', onPress: onClose, busy: source.busy, busyLabel: `Writing ${fileName}…`}
      : changes.readyCount === 0 && fileName && fileDiffers
      ? {
          label: `Update ${fileName} · ${plural(source.linked?.diff.changedBlocks ?? 1, 'changed block')}`,
          onPress: () => source.write('file'),
          disabled: loading || source.finding || !!source.confirm,
          busy: source.busy,
          busyLabel: `Writing ${fileName}…`,
        }
      : {
          label:
            changes.readyCount > 0
              ? `Apply ${plural(changes.readyCount, 'edit')}`
              : 'Nothing to apply',
          onPress: review.apply,
          disabled: changes.plans.length === 0 || loading || reviewBlocked || source.busy,
          busy,
          busyLabel: 'Applying…',
        };
  const accessory =
    tab === 'review' && !applied && fileName && changes.readyCount > 0 ? (
      <Checkbox
        label={`Also update ${fileName}`}
        checked={source.alsoUpdate}
        disabled={busy}
        onChange={source.setAlsoUpdate}
      />
    ) : undefined;
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
  const status = jumpError
    ? {kind: 'error' as const, text: jumpError}
    : tab === 'outline'
    ? outline.status ?? review.status
    : reviewStatus(review.status, source, focusNote, changes.readyCount, loading);

  return (
    <ScreenFrame
      title="Manuscript"
      context={[reviewContext(review), fileName].filter(Boolean).join(' · ')}
      actions={[{label: 'Details', onPress: () => setView('details')}]}
      help={{title: 'Edit marks', marks: true}}
      onClose={onClose}
      status={status}
      primary={primary}
      accessory={accessory}
      screenKey={`manuscript-${tab}`}>
      {source.confirm && <ProtectedQuestion source={source} fileName={fileName ?? 'the file'} />}
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
          onGoToPage={goToPage}
        />
      ) : (
        <OutlineTab
          outline={outline}
          disabled={busy || loading}
          onReviewPage={reviewPage}
          onGoToPage={goToPage}
        />
      )}
    </ScreenFrame>
  );
}

/**
 * The Review's status line: the review's own (an apply, an error) with the file's after it, or the
 * file's alone; with nothing else to say, that the file is up to date.
 */
function reviewStatus(
  own: FrameStatus | null,
  source: SourceLink,
  focusNote: string | null,
  readyCount: number,
  loading: boolean,
): FrameStatus | null {
  if (own && source.status) {
    return {
      kind: own.kind === 'error' || source.status.kind === 'error' ? 'error' : 'info',
      text: `${own.text} ${source.status.text}`,
    };
  }
  const shown = own ?? source.status ?? (focusNote ? {text: focusNote} : null);
  if (shown || !source.linked || loading || readyCount > 0) {
    return shown;
  }
  return source.linked.diff.differs ? null : {text: `${sourceFileName(source.linked.record)} is up to date.`};
}

/** Protected blocks deleted on the page: remove them from the file too, or keep them. */
function ProtectedQuestion({source, fileName}: {source: SourceLink; fileName: string}): React.JSX.Element {
  const blocks = source.confirm ?? [];
  const several = blocks.length > 1;
  const names = blocks.map(block => blockName(block)).join(', ');
  return (
    <View style={styles.question}>
      <Text style={styles.questionText}>
        {several
          ? `${blocks.length} protected blocks were deleted on the page: ${names}. Remove them from ${fileName} too?`
          : `${names} was deleted on the page. Remove it from ${fileName} too?`}
      </Text>
      <PillButton
        size="small"
        label={several ? 'Remove all' : 'Remove'}
        disabled={source.busy}
        onPress={() => source.answer(true)}
      />
      <PillButton
        size="small"
        label={several ? 'Keep all' : 'Keep it'}
        disabled={source.busy}
        onPress={() => source.answer(false)}
      />
    </View>
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
  question: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginHorizontal: SPACING.xl,
    marginTop: SPACING.sm,
    padding: SPACING.md,
    borderWidth: 2,
    borderColor: COLORS.accent,
  },
  questionText: {
    flex: 1,
    fontSize: FONT.medium,
    color: COLORS.text,
  },
  tabs: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.sm,
  },
});
