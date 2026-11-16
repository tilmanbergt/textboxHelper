/* eslint-disable no-restricted-imports -- scrolls until the calmer-screens step replaces this screen */
import React from 'react';
import {
  ScrollView,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {UI_COLORS, styles} from '../ui/pluginUiStyles';
import {
  ACTION_LABELS,
  ACTION_ORDER,
  type TextboxActionKind,
} from '../domain/textboxActionKinds';
import type {TextboxActionPreview} from '../domain/textboxEditPlan';

type TextboxToolsViewProps = {
  preview: TextboxActionPreview | null;
  currentAction: TextboxActionKind | null;
  isBusy: boolean;
  isPreviewLoading: boolean;
  status: string;
  backupPath: string;
  canExecute: boolean;
  beforePreviewText: string;
  afterPreviewText: string;
  availableActionLabels: string[];
  onSelectAction: (action: TextboxActionKind) => void;
  onExecute: () => void;
  onClose: () => void;
  /** Temporary (calmer screens S1): opens the paging test screen; removed in step S3. */
  onOpenPagingTest?: () => void;
};

export function formatPreviewBlocks(
  blocks: string[],
  emptyMessage: string,
): string {
  if (blocks.length === 0) {
    return emptyMessage;
  }

  return blocks.map(block => block || '(empty)').join('\n----\n');
}

export function TextboxToolsView({
  preview,
  currentAction,
  isBusy,
  isPreviewLoading,
  status,
  backupPath,
  canExecute,
  beforePreviewText,
  afterPreviewText,
  availableActionLabels,
  onSelectAction,
  onExecute,
  onClose,
  onOpenPagingTest,
}: TextboxToolsViewProps): React.JSX.Element {
  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={UI_COLORS.white} />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>Textbox Tools</Text>

            <Text style={styles.title}>
              {preview?.selectionMessage || 'Loading selection...'}
            </Text>

            <Text style={styles.summaryText}>
              {availableActionLabels.length > 0
                ? `Available now: ${availableActionLabels.join(', ')}`
                : 'No actions are available for the current selection.'}
            </Text>
          </View>

          {onOpenPagingTest ? (
            <TouchableOpacity
              activeOpacity={0.75}
              style={styles.closeButton}
              onPress={onOpenPagingTest}>
              <Text style={styles.closeButtonText}>Paging test</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            activeOpacity={0.75}
            style={styles.closeButton}
            onPress={onClose}>
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.actionsGrid}>
          {ACTION_ORDER.map(action => {
            const isSelected = currentAction === action;
            const isAvailable = !!preview?.availableActions[action];

            return (
              <TouchableOpacity
                key={action}
                activeOpacity={0.75}
                style={[
                  styles.actionButton,
                  isSelected && styles.actionButtonSelected,
                  (!isAvailable || isPreviewLoading || isBusy) &&
                    styles.actionButtonDisabled,
                ]}
                onPress={() => onSelectAction(action)}
                disabled={!isAvailable || isPreviewLoading || isBusy}>
                <Text
                  style={[
                    styles.actionButtonText,
                    isSelected && styles.actionButtonTextSelected,
                  ]}>
                  {ACTION_LABELS[action]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.previewRow}>
          <View style={styles.previewCard}>
            <Text style={styles.previewTitle}>Before</Text>
            <Text style={styles.previewText}>{beforePreviewText}</Text>
          </View>

          <View style={styles.previewCard}>
            <Text style={styles.previewTitle}>
              {currentAction ? `After: ${ACTION_LABELS[currentAction]}` : 'After'}
            </Text>
            <Text style={styles.previewText}>{afterPreviewText}</Text>
          </View>
        </View>

        <TouchableOpacity
          activeOpacity={0.75}
          style={[
            styles.executeButton,
            !canExecute && styles.executeButtonDisabled,
          ]}
          onPress={onExecute}
          disabled={!canExecute}>
          <Text style={styles.executeButtonText}>
            {isBusy ? 'Executing...' : 'Execute'}
          </Text>
        </TouchableOpacity>

        {status ? <Text style={styles.statusText}>{status}</Text> : null}
        {backupPath ? <Text style={styles.backupText}>{backupPath}</Text> : null}
      </ScrollView>
    </View>
  );
}
