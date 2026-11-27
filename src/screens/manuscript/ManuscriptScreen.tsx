/**
 * The Manuscript card (technical-design-manuscript.md §6; canvas row "Manuscript"): one card for
 * the whole note, with three tabs. Review: the pen marks, shaping the text. Outline: the order of
 * the textboxes, shaping the document. Files (technical-design-settings-layout-files.md §4): the
 * linked files, Import and Export DOCX as sub-screens; an empty note opens here. Edits first, then
 * structure: a page with edits waiting can't be rebuilt, and the Outline's button leads to the
 * Review of that page. Settings (Outline, layout, export rules, calibration, diagnostics) is a
 * sub-screen with the card's state. After an import the card starts over, so everything is read
 * from the changed note.
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
import TextLink from '../../ui/TextLink';
import {jumpToNotePage} from '../../supernote/noteElements';
import ScreenFrame, {type FramePrimary, type FrameStatus} from '../../ui/ScreenFrame';
import {COLORS, FONT, SPACING} from '../../ui/theme';
import {noteHasTextboxes} from '../../actions/noteContent';
import {runHousekeepingOnce} from '../../actions/housekeeping';
import {getSettings, updateSettings} from '../../storage/settingsFile';
import {putCheatSheetOnPage} from '../../actions/cheatSheet';
import {CHEAT_SHEET} from '../../ui/generated/markImages';
import ExportScreen from '../export/ExportScreen';
import ImportScreen from '../import/ImportScreen';
import UrlImportScreen from '../import/UrlImportScreen';
import type {Downloaded} from '../../actions/urlImport';
import FilesTab from './files/FilesTab';
import SettingsScreen, {type SettingsTab} from './settings/SettingsScreen';
import OutlineTab from './outline/OutlineTab';
import ReviewTab, {reviewContext} from './ReviewTab';
import {useManuscriptReview} from './useManuscriptReview';
import {useOutline, type Outline} from './outline/useOutline';
import {useLinkedFiles, type LinkedFiles} from './useLinkedFiles';

type Tab = 'review' | 'outline' | 'files';

interface Props {
  onClose: () => void;
  /** The pen edit whose mark was just selected (Select mark): shown first. */
  focusPenEditId?: string | null;
}

/** The card; after an import it starts over on the Files tab with the import's message. */
const HOUSEKEEPING_DELAY_MS = 3000;

export default function ManuscriptScreen(props: Props): React.JSX.Element {
  const [round, setRound] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <ManuscriptCard
      key={round}
      {...props}
      focusPenEditId={round === 0 ? props.focusPenEditId : null}
      initialTab={round === 0 ? undefined : 'files'}
      notice={notice}
      onImported={message => {
        setNotice(message);
        setRound(current => current + 1);
      }}
    />
  );
}

interface CardProps extends Props {
  initialTab?: Tab;
  /** Shown in the status line until something else is (an import's result). */
  notice: string | null;
  onImported: (message: string | null) => void;
}

function ManuscriptCard({
  onClose,
  focusPenEditId = null,
  initialTab,
  notice,
  onImported,
}: CardProps): React.JSX.Element {
  const review = useManuscriptReview();
  const source = useLinkedFiles(review.note, !review.loading);
  const records = useMemo(
    () => source.note?.files.map(file => file.record) ?? [],
    [source.note],
  );
  const outline = useOutline(review.note, review.pages, records);
  const [view, setView] = useState<'card' | 'settings' | 'import' | 'url' | 'export'>('card');
  // The file Import from URL just saved; the Import screen names where it came from.
  const [downloaded, setDownloaded] = useState<Downloaded | null>(null);
  const firstStart = useRef(!getSettings().onboarding.seen);
  const markOnboardingSeen = useCallback(() => {
    updateSettings(settings => ({...settings, onboarding: {seen: true}}));
  }, []);
  // "Put cheat sheet on this page" in Getting started (technical-design-release-readiness.md §6.2).
  const [cheatSheetStatus, setCheatSheetStatus] = useState<FrameStatus | null>(null);
  const putCheatSheet = useCallback(() => {
    setCheatSheetStatus({text: 'Putting the cheat sheet on the page…'});
    putCheatSheetOnPage(CHEAT_SHEET.uri.replace(/^data:image\/png;base64,/, ''))
      .then(result => setCheatSheetStatus({kind: result.placed ? 'info' : 'error', text: result.message}))
      .catch(error => {
        console.warn('[CheatSheet] failed', String(error));
        setCheatSheetStatus({kind: 'error', text: 'The cheat sheet could not be put on the page or saved to EXPORT.'});
      });
  }, []);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('outline');
  const [importFolder, setImportFolder] = useState(false);
  const [tab, setTabState] = useState<Tab>(initialTab ?? 'review');
  // An empty note opens on Files, unless a tab was chosen meanwhile.
  const tabChosen = useRef(!!initialTab || !!focusPenEditId);
  const setTab = useCallback((next: Tab) => {
    tabChosen.current = true;
    setCheatSheetStatus(null);
    setTabState(next);
  }, []);
  const notePath = review.note?.notePath ?? null;
  const pageCount = review.note?.pageCount ?? 0;
  useEffect(() => {
    if (!notePath || tabChosen.current) {
      return;
    }
    noteHasTextboxes(notePath, pageCount)
      .then(has => {
        if (!has && !tabChosen.current) {
          setTabState('files');
        }
      })
      .catch(error => console.warn('[Manuscript] note content not read', String(error)));
  }, [notePath, pageCount]);
  // Housekeeping (technical-design-housekeeping.md) waits until the first list is shown, so it
  // never competes with the first page read; it runs once per JS context.
  const firstListShown = !review.loading;
  useEffect(() => {
    if (!firstListShown) {
      return;
    }
    const timer = setTimeout(() => {
      runHousekeepingOnce().catch(error => console.warn('[Housekeeping] not run', String(error)));
    }, HOUSEKEEPING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [firstListShown]);
  const openSettings = useCallback((at: SettingsTab) => {
    setSettingsTab(at);
    setView('settings');
  }, []);
  const [reviewBlocked, setReviewBlocked] = useState(false);
  const [showPage, setShowPage] = useState<number | null>(null);
  // The page the Review shows: Apply applies its edits (technical-design-mark-dialogue.md §5.6).
  const [shownPage, setShownPage] = useState<number | null>(null);
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

  if (view === 'import') {
    return (
      <ImportScreen
        wholeFolder={importFolder}
        downloaded={downloaded}
        onClose={onClose}
        onOpenLayout={() => openSettings('layout')}
        onBack={(imported, message) => {
          setDownloaded(null);
          return imported ? onImported(message) : setView('card');
        }}
      />
    );
  }

  if (view === 'url') {
    return (
      <UrlImportScreen
        onClose={onClose}
        onBack={() => setView('card')}
        onDownloaded={file => {
          setDownloaded(file);
          setImportFolder(false);
          setView('import');
        }}
      />
    );
  }

  if (view === 'export') {
    return <ExportScreen onClose={onClose} onBack={() => setView('card')} onOpenRules={() => openSettings('export')} />;
  }

  if (view === 'settings') {
    return (
      <SettingsScreen
        initialTab={settingsTab}
        review={review}
        source={source}
        outline={outline}
        onCleanUpPlanned={() => {
          setTab('outline');
          setView('card');
        }}
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
  // Apply per page by default; all pages as a quieter second action when others have edits too.
  const pagePlan = shownPage !== null ? changes.plans.find(plan => plan.page === shownPage) ?? null : null;
  const otherPages = pagePlan !== null && changes.plans.some(plan => plan.page !== pagePlan.page);
  const primary: FramePrimary =
    tab === 'files'
      ? filesPrimary(source, onClose)
      : tab === 'outline'
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
      : pagePlan
      ? {
          label: `Apply ${plural(pagePlan.operations.length, 'edit')} on page ${pagePlan.page + 1}`,
          onPress: () => review.applyPage(pagePlan.page),
          disabled: loading || reviewBlocked || source.busy,
          busy,
          busyLabel: 'Applying…',
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
  const allPages =
    tab === 'review' && !applied && otherPages ? (
      <TextLink
        label={`All pages · ${plural(changes.readyCount, 'edit')}`}
        onPress={review.apply}
        disabled={loading || reviewBlocked || source.busy || busy}
      />
    ) : null;
  const alsoUpdate =
    tab === 'review' && !applied && source.note && changes.readyCount > 0 ? (
      <Checkbox
        label={source.note.files.length === 1 ? `Also update ${files}` : 'Also update changed files'}
        checked={source.alsoUpdate}
        disabled={busy}
        onChange={source.setAlsoUpdate}
      />
    ) : null;
  const accessory =
    allPages || alsoUpdate ? (
      <View style={styles.accessory}>
        {allPages}
        {alsoUpdate}
      </View>
    ) : undefined;
  const focusNote =
    !focusPenEditId || loading
      ? null
      : changes.entries.some(
          entry => entry.operation.penEditId === focusPenEditId,
        )
      ? 'Mark found: the change is in the list now.'
      : changes.toDecide.some(item => item.item.penEditId === focusPenEditId)
      ? 'Mark selected, but its place is still open: see To decide.'
      : null;
  const status = cheatSheetStatus
    ? cheatSheetStatus
    : jumpError
    ? {kind: 'error' as const, text: jumpError}
    : tab === 'outline'
    ? outline.status ?? review.status
    : tab === 'files'
    ? source.status ?? (notice ? {text: notice} : null)
    : reviewStatus(review.status, source, focusNote, changes.readyCount, loading);

  return (
    <ScreenFrame
      title="Manuscript"
      context={[reviewContext(review), files].filter(Boolean).join(' · ')}
      actions={[{label: 'Settings', onPress: () => openSettings('outline')}]}
      help={{
        title: 'Help',
        marks: true,
        // Getting started opens once, on the first start (technical-design-release-readiness.md §5.2).
        firstStart: firstStart.current,
        onFirstStartDone: markOnboardingSeen,
        onCheatSheet: putCheatSheet,
      }}
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
            {key: 'files', label: 'Files', count: source.note?.files.length || undefined},
          ]}
          activeKey={tab}
          onChange={setTab}
        />
      </View>
      {tab === 'files' ? (
        <FilesTab
          source={source}
          disabled={busy || source.busy}
          onImport={folder => {
            setImportFolder(folder);
            setView('import');
          }}
          onImportUrl={() => setView('url')}
          onExport={() => setView('export')}
        />
      ) : tab === 'review' ? (
        <ReviewTab
          review={review}
          onClose={onClose}
          focusPenEditId={focusPenEditId}
          onBlockedChange={onBlockedChange}
          showPage={showPage}
          onGoToPage={goToPage}
          onPageShown={setShownPage}
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
    return {text: `${plural(folder.newFiles.length, 'new file')} in ${folder.name}: Files → Add.`};
  }
  if (folder?.index === 'changedOutside') {
    return {text: 'index.txt was changed in Obsidian: Files → Rewrite index.txt.'};
  }
  const held = filesHeldBack(source.note);
  if (held.length > 0) {
    return {text: `${plural(held.length, 'file')} changed here but can't be written (${FILE_STATE_LABEL[held[0].state].toLowerCase()}): see Files.`};
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

/** The Files tab's button: write the files that changed here, else Close. */
function filesPrimary(source: LinkedFiles, onClose: () => void): FramePrimary {
  if (source.toWrite.length > 0 || source.indexStale) {
    return {
      label: updateLabel(source.toWrite),
      onPress: source.write,
      disabled: source.finding || !!source.confirm,
      busy: source.busy,
      busyLabel: 'Writing the files…',
    };
  }
  return {label: 'Close', onPress: onClose, busy: source.busy, busyLabel: 'Writing the files…'};
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
    label: count === 1 && outline.planned?.cleanup ? 'Apply clean up' : `Apply ${plural(count, 'change')}`,
    onPress: outline.apply,
    disabled: outline.checking || !outline.check || blockers.length > 0,
    busy: outline.busy,
    busyLabel: 'Applying…',
  };
}

const styles = StyleSheet.create({
  accessory: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.lg,
  },
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
