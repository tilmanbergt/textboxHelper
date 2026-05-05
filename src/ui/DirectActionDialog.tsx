import React from 'react';
import {
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {UI_COLORS, styles} from './pluginUiStyles';
import type {TextboxActionKind} from '../textboxActions';

export type DirectDialogState = {
  action: TextboxActionKind | null;
  title: string;
  message: string;
  isBusy: boolean;
  canCancel: boolean;
  showOk: boolean;
  backupPath: string;
};

type DirectActionDialogProps = {
  dialog: DirectDialogState;
  onCancelOrClose: () => void;
  onOk: () => void;
};

export function createIdleDirectDialog(): DirectDialogState {
  return {
    action: null,
    title: 'Textbox Action',
    message: '',
    isBusy: false,
    canCancel: false,
    showOk: true,
    backupPath: '',
  };
}

export function DirectActionDialog({
  dialog,
  onCancelOrClose,
  onOk,
}: DirectActionDialogProps): React.JSX.Element {
  return (
    <View style={styles.dialogScreen}>
      <StatusBar barStyle="dark-content" backgroundColor={UI_COLORS.white} />

      <View style={styles.dialogCard}>
        <Text style={styles.dialogEyebrow}>Textbox Action</Text>
        <Text style={styles.dialogTitle}>{dialog.title}</Text>
        <Text style={styles.dialogMessage}>{dialog.message}</Text>

        {dialog.backupPath ? (
          <Text style={styles.dialogMeta}>{dialog.backupPath}</Text>
        ) : null}

        <View style={styles.dialogButtonRow}>
          <TouchableOpacity
            activeOpacity={0.75}
            style={styles.secondaryButton}
            onPress={onCancelOrClose}>
            <Text style={styles.secondaryButtonText}>
              {dialog.isBusy ? 'Cancel' : 'Close'}
            </Text>
          </TouchableOpacity>

          {dialog.showOk ? (
            <TouchableOpacity
              activeOpacity={0.75}
              style={styles.primaryButton}
              onPress={onOk}>
              <Text style={styles.primaryButtonText}>OK</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  );
}