/**
 * The frame every screen uses (technical-design-calmer-screens.md §3.1, after Kept GTD's
 * WizardFrame): one header line, a body that never scrolls, and a footer.
 *
 * - Header: "‹ Back" (sub-screens), title, short context, the screen's own buttons (Details,
 *   Rules), "?" when the screen has help, Close.
 * - Body: `flex: 1` and bounded, so paged children (PagedSection, PagedText) can measure the room
 *   they have. Help opens as a layer over the body.
 * - Footer: the status line left, the one primary button right. A busy primary keeps its place
 *   and shows its busy label, disabled.
 *
 * Header and footer have fixed minimum heights, so nothing in the body moves when the status or
 * the button label changes. A change of `screenKey`, the status text or the button label requests an
 * e-ink refresh: progress arrives without a touch, and e-ink doesn't redraw by itself.
 */
import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import HelpOverlay from './HelpOverlay';
import PillButton from './PillButton';
import {COLORS, FONT, SPACING} from './theme';
import {requestEinkRefresh} from '../utils/screenRefresh';

export interface FrameButton {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
}

export interface FramePrimary {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
}

export interface FrameStatus {
  text: string;
  kind?: 'info' | 'error';
}

interface Props {
  title: string;
  context?: string;
  back?: {label: string; onPress: () => void};
  actions?: FrameButton[];
  help?: {title: string; text: string};
  onClose?: () => void;
  status?: FrameStatus | null;
  primary?: FramePrimary;
  screenKey?: string;
  children: React.ReactNode;
}

export default function ScreenFrame({
  title,
  context,
  back,
  actions,
  help,
  onClose,
  status,
  primary,
  screenKey,
  children,
}: Props): React.JSX.Element {
  const [helpOpen, setHelpOpen] = useState(false);

  // Status and button changes during a long run come without a touch, so they ask for a redraw.
  const primaryLabel = primary ? (primary.busy ? primary.busyLabel ?? primary.label : primary.label) : '';
  useEffect(() => {
    requestEinkRefresh();
  }, [screenKey, helpOpen, status?.text, primaryLabel]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        {back && (
          <Pressable accessibilityRole="button" onPress={back.onPress} hitSlop={8} style={styles.back}>
            <Text style={styles.backText}>‹ {back.label}</Text>
          </Pressable>
        )}
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.context} numberOfLines={1}>
          {context ?? ''}
        </Text>
        <View style={styles.headerButtons}>
          {(actions ?? []).map(action => (
            <PillButton
              key={action.label}
              label={action.label}
              accessibilityLabel={action.accessibilityLabel}
              disabled={action.disabled}
              onPress={action.onPress}
            />
          ))}
          {help && <PillButton label="?" accessibilityLabel="Help" onPress={() => setHelpOpen(true)} />}
          {onClose && <PillButton label="Close" onPress={onClose} />}
        </View>
      </View>
      <View style={styles.body}>
        {children}
        {help && helpOpen && (
          <HelpOverlay title={help.title} text={help.text} onClose={() => setHelpOpen(false)} />
        )}
      </View>
      <View style={styles.footer}>
        <Text
          style={[styles.status, status?.kind === 'error' && styles.statusError]}
          numberOfLines={2}
          accessibilityLiveRegion="polite">
          {status?.text ?? ''}
        </Text>
        {primary && (
          <PillButton
            primary
            label={primary.busy ? primary.busyLabel ?? primary.label : primary.label}
            disabled={primary.disabled || primary.busy}
            onPress={primary.onPress}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
    borderBottomWidth: 2,
    borderBottomColor: COLORS.accent,
  },
  back: {
    marginRight: SPACING.base,
  },
  backText: {
    fontSize: FONT.medium,
    color: COLORS.text,
    textDecorationLine: 'underline',
  },
  title: {
    fontSize: FONT.large,
    fontWeight: '700',
    color: COLORS.text,
    marginRight: SPACING.base,
  },
  context: {
    flex: 1,
    fontSize: FONT.small,
    color: COLORS.muted,
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginLeft: SPACING.sm,
  },
  body: {
    flex: 1,
    overflow: 'hidden',
  },
  footer: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
    borderTopWidth: 2,
    borderTopColor: COLORS.accent,
    gap: SPACING.base,
  },
  status: {
    flex: 1,
    fontSize: FONT.small,
    color: COLORS.muted,
  },
  statusError: {
    color: COLORS.text,
    fontWeight: '700',
  },
});
