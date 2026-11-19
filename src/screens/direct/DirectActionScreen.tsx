/**
 * A toolbar action on the lasso selection, run right away (technical-design-calmer-screens.md
 * §3.6). No preview: the tap on the selection is the explicit act, and the backup is written
 * before anything changes (DEVELOPMENT-POLICY §2). A small card shows the progress; Cancel works
 * until the first change, and the plugin closes 0.7 s after success. An error stays open with
 * Close.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {performTextboxAction, TEXTBOX_ACTION_CANCELLED_MESSAGE} from '../../actions/textboxEdits';
import {ACTION_LABELS, ACTION_PROGRESS_LABELS, type TextboxActionKind} from '../../domain/textboxActionKinds';
import {fileNameOf, userMessage} from '../../domain/userMessage';
import PillButton from '../../ui/PillButton';
import {COLORS, FONT, RADII, SPACING} from '../../ui/theme';
import {requestEinkRefresh} from '../../utils/screenRefresh';

const CLOSE_AFTER_SUCCESS_MS = 700;

type Phase = 'running' | 'cancelling' | 'done' | 'failed';

interface Props {
  action: TextboxActionKind;
  onClose: () => void;
}

export default function DirectActionScreen({action, onClose}: Props): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('running');
  const [message, setMessage] = useState(ACTION_PROGRESS_LABELS[action]);
  const [canCancel, setCanCancel] = useState(true);
  const [backup, setBackup] = useState('');
  const cancelRequested = useRef(false);

  useEffect(() => {
    let closeTimer: ReturnType<typeof setTimeout> | null = null;
    let active = true;
    performTextboxAction(action, {
      isCancelled: () => cancelRequested.current,
      onProgress: update => {
        if (active) {
          setMessage(update.message);
          setCanCancel(update.canCancel);
        }
      },
    })
      .then(result => {
        if (!active) {
          return;
        }
        setPhase('done');
        setMessage(result.message);
        setBackup(result.backupPath ? fileNameOf(result.backupPath) : '');
        closeTimer = setTimeout(onClose, CLOSE_AFTER_SUCCESS_MS);
      })
      .catch(error => {
        if (!active) {
          return;
        }
        const cancelled = error instanceof Error && error.message === TEXTBOX_ACTION_CANCELLED_MESSAGE;
        if (!cancelled) {
          console.warn('[DirectAction] failed', action, String(error));
        }
        setPhase('failed');
        setMessage(cancelled ? 'Cancelled before making changes.' : userMessage(error, 'The action could not be applied.'));
      });
    return () => {
      active = false;
      if (closeTimer) {
        clearTimeout(closeTimer);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per opened screen
  }, []);

  useEffect(() => {
    requestEinkRefresh();
  }, [phase]);

  const onButton = useCallback(() => {
    if (phase === 'running' && canCancel) {
      cancelRequested.current = true;
      setPhase('cancelling');
      setMessage('Cancelling before changes are applied…');
      return;
    }
    if (phase === 'done' || phase === 'failed') {
      onClose();
    }
  }, [canCancel, onClose, phase]);

  const running = phase === 'running' || phase === 'cancelling';
  const buttonLabel = running ? (canCancel && phase === 'running' ? 'Cancel' : 'Working…') : 'Close';

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.title}>{ACTION_LABELS[action]}</Text>
        <Text style={[styles.message, phase === 'failed' && styles.messageError]}>{message}</Text>
        <Text style={styles.backup}>{backup ? `Backup: ${backup}` : ' '}</Text>
        <View style={styles.buttons}>
          <PillButton
            label={buttonLabel}
            primary={!running}
            disabled={running && (!canCancel || phase === 'cancelling')}
            onPress={onButton}
          />
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
    width: 520,
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
    minHeight: 52,
  },
  messageError: {
    fontWeight: '700',
  },
  backup: {
    fontSize: FONT.small,
    color: COLORS.muted,
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
});
