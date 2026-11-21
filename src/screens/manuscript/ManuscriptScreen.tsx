/**
 * The Manuscript card (technical-design-manuscript.md §6; canvas row "Manuscript"): one card for
 * the whole note, with two tabs. Review: the pen marks, shaping the text. Outline: the order of
 * the textboxes, shaping the document. Edits first, then structure: a page with edits waiting can't
 * be rebuilt, and the Outline's button leads to the Review of that page. Details (the linked file,
 * calibration, diagnostics) is a sub-screen with the Review's state.
 *
 * A note with linked text files (technical-design-linked-files.md §3) names them in the header.
 * Apply also updates the files that changed ("Also update …", on every time the card opens); with
 * no edits waiting but files differing from the note, the button is "Update …". Protected blocks
 * deleted on the page are asked about above the tabs before they leave their files.
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {plural} from '../../domain/plural';
import {filesHeldBack, type LinkedFile} from '../../actions/linkedFiles';
import {FILE_STATE_LABEL} from '../../domain/fileState';
import {blockName} from '../../domain/sourceBlocks';
import {sourceFileName} from '../../domain/sourceRecord';
import Checkbox from '../../ui/Checkbox';
import CountTabs from '../../ui/CountTabs';
import PillButton from '../../ui/PillButton';
import {jumpToNotePage} from '../../supernote/noteElements';
import ScreenFrame, {type FramePrimary, type FrameStatus} from '../../ui/ScreenFrame';
import {COLORS, FONT, SPACING} from '../../ui/theme';
import ManuscriptDetailsScreen from './ManuscriptDetailsScreen';
import OutlineTab from './outline/OutlineTab';
import ReviewTab, {reviewContext} from './ReviewTab';
import {useManuscriptReview} from './useManuscriptReview';
import {useOutline, type Outline} from './outline/useOutline';
import {useLinkedFiles, type LinkedFiles} from './useLinkedFiles';

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
  const source = useLinkedFiles(review.note, !review.loading);
  const records = useMemo(
    () => source.note?.files.map(file => file.record) ?? [],
    [source.note],
  );
  const outline = useOutline(review.note, review.pages, records);
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
      if (link.note && link.alsoUpdate) {
        link.write();
      } else if (link.note) {
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
        outline={outline}
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
  const files = filesLabel(source);
  const toWrite = source.toWrite;
  const primary: FramePrimary =
    tab === 'outline'
      ? outlinePrimary(outline, onClose, reviewPage)
      : applied || source.added
      ? {label: 'Close', onPress: onClose, busy: source.busy, busyLabel: 'Writing the files…'}
      : changes.readyCount === 0 && (toWrite.length > 0 || source.indexStale)
      ? {
          label: updateLabel(toWrite),
          onPress: source.write,
          disabled: loading || source.finding || !!source.confirm,
          busy: source.busy,
          busyLabel: 'Writing the files…',
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
    tab === 'review' && !applied && source.note && changes.readyCount > 0 ? (
      <Checkbox
        label={source.note.files.length === 1 ? `Also update ${files}` : 'Also update changed files'}
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
      context={[reviewContext(review), files].filter(Boolean).join(' · ')}
      actions={[{label: 'Details', onPress: () => setView('details')}]}
      help={{title: 'Edit marks', marks: true}}
      onClose={onClose}
      status={status}
      primary={primary}
      accessory={accessory}
      screenKey={`manuscript-${tab}`}>
      <WriteQuestion source={source} />
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

/** The header's name for the linked files: the file's name, or how many there are. */
function filesLabel(source: LinkedFiles): string | null {
  const files = source.note?.files ?? [];
  const folder = source.note?.folder;
  if (folder) {
    return `${folder.name} · ${plural(files.length, 'file')}`;
  }
  if (files.length === 0) {
    return null;
  }
  return files.length === 1 ? sourceFileName(files[0].record) : plural(files.length, 'file');
}

/** "Update Essay.txt · 3 changed blocks", "Update 2 files" or "Update index.txt". */
function updateLabel(toWrite: LinkedFile[]): string {
  if (toWrite.length === 0) {
    return 'Update index.txt';
  }
  if (toWrite.length > 1) {
    return `Update ${plural(toWrite.length, 'file')}`;
  }
  const file = toWrite[0];
  if (file.diff.changedBlocks === 0) {
    return `Update ${sourceFileName(file.record)}`;
  }
  return file.state === 'new'
    ? `Create ${sourceFileName(file.record)}`
    : `Update ${sourceFileName(file.record)} · ${plural(file.diff.changedBlocks, 'changed block')}`;
}

/**
 * The Review's status line: the review's own (an apply, an error) with the files' after it, or the
 * files' alone; with nothing else to say, whether the files are up to date.
 */
function reviewStatus(
  own: FrameStatus | null,
  source: LinkedFiles,
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
  const shown =
    own ??
    source.status ??
    (focusNote ? {text: focusNote} : null) ??
    (source.note && source.note.crossings > 0 && !loading
      ? {text: `${plural(source.note.crossings, 'block')} under another file's title: Update asks whether to move them.`}
      : null);
  if (shown || !source.note || loading || readyCount > 0 || source.toWrite.length > 0 || source.indexStale) {
    return shown;
  }
  const folder = source.note.folder;
  if (folder && folder.newFiles.length > 0) {
    return {text: `${plural(folder.newFiles.length, 'new file')} in ${folder.name}: Details → Add.`};
  }
  if (folder?.index === 'changedOutside') {
    return {text: 'index.txt was changed in Obsidian: Details → Rewrite index.txt.'};
  }
  const held = filesHeldBack(source.note);
  if (held.length > 0) {
    return {text: `${plural(held.length, 'file')} changed here but can't be written (${FILE_STATE_LABEL[held[0].state].toLowerCase()}): see Details.`};
  }
  return {text: source.note.files.length === 1 ? `${filesLabel(source)} is up to date.` : 'All files are up to date.'};
}

/**
 * The write's question above the tabs: textboxes moved under another file's title (Move them /
 * Keep apart), or protected blocks deleted on the page (Remove / Keep).
 */
function WriteQuestion({source}: {source: LinkedFiles}): React.JSX.Element | null {
  const question = source.confirm;
  if (!question) {
    return null;
  }
  let text: string;
  let yes: string;
  let no: string;
  if (question.kind === 'moves') {
    const count = question.moves.reduce((sum, move) => sum + move.count, 0);
    const move = question.moves[0];
    const gone = question.moves.find(item => item.titleGone);
    text = gone
      ? `The title of ${gone.from} was deleted, so its text now belongs to ${gone.to}. Move it into ${gone.to}? (${gone.from} stays as it is.)`
      : question.moves.length === 1
      ? `${move.count === 1 ? `"${move.names[0]}"` : plural(move.count, 'block')} of ${move.from} is now under ${move.to}. Move it to ${move.to} in the files too?`
      : `${plural(count, 'block')} are now under another file's title (${question.moves
          .map(item => `${item.from} → ${item.to}`)
          .join(', ')}). Move them in the files too?`;
    yes = count > 1 ? 'Move them' : 'Move it';
    no = 'Keep apart';
  } else {
    const pending = question.pending;
    const count = pending.reduce((sum, file) => sum + file.blocks.length, 0);
    const names = pending.flatMap(file => file.blocks.map(block => blockName(block))).join(', ');
    const files = pending.map(file => file.fileName).join(', ');
    text =
      count > 1
        ? `${count} protected blocks were deleted on the page: ${names}. Remove them from ${files} too?`
        : `${names} was deleted on the page. Remove it from ${files} too?`;
    yes = count > 1 ? 'Remove all' : 'Remove';
    no = count > 1 ? 'Keep all' : 'Keep it';
  }
  return (
    <View style={styles.question}>
      <Text style={styles.questionText}>{text}</Text>
      <PillButton size="small" label={yes} disabled={source.busy} onPress={() => source.answer(true)} />
      <PillButton size="small" label={no} disabled={source.busy} onPress={() => source.answer(false)} />
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
