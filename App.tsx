/**
 * @format
 */

/**
 * Main plugin UI shell.
 *
 * Responsibilities:
 * - react to Supernote button presses
 * - load preview data for textbox tools and edit markers
 * - render review flows
 * - hand execution requests back to the feature modules
 *
 * The goal is for this file to stay focused on presentation and screen flow rather
 * than geometry, text measurement, or mutation logic.
 */

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  DeviceEventEmitter,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextStyle,
  TouchableOpacity,
  View,
} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';
import {
  BUTTON_ID_NOTE_APPLY_ALL_EDIT_MARKERS,
  BUTTON_ID_TEXTBOX_TOOLS,
  BUTTON_ID_TOOLBAR_APPLY_EDIT_MARKERS,
  BUTTON_ID_TOOLBAR_CLEAN_TEXTBOX_SPACES,
  BUTTON_ID_TOOLBAR_JOIN_TEXTBOXES,
  BUTTON_ID_TOOLBAR_REMOVE_LINE_BREAKS,
  BUTTON_ID_TOOLBAR_SPLIT_TEXTBOX,
  PLUGIN_BUTTON_EVENT,
  checkPendingButton,
} from './src/pluginRouting';
import {
  applyEditMarkerPreview,
  getEditMarkerCalibration,
  getEditMarkerPreview,
  resetEditMarkerCalibration,
  setEditMarkerCalibration,
  type EditMarkerPreviewScope,
  type EditMarkerHighlightRange,
  type EditMarkerPreviewBlock,
  type EditMarkerPreview,
} from './src/editMarkerActions';
import {
  getTextboxActionPreview,
  performTextboxAction,
  TEXTBOX_ACTION_CANCELLED_MESSAGE,
  type TextboxActionKind,
  type TextboxActionPreview,
  type TextboxActionProgressUpdate,
} from './src/textboxActions';

const UI_FONT_SIZES = {
  title: 24,
  body: 16,
  meta: 13,
} as const;

const UI_COLORS = {
  black: '#000000',
  white: '#ffffff',
  gray: '#7a7a7a',
  lightGray: '#d0d0d0',
  softGray: '#f4f4f4',
} as const;

const ACTION_ORDER: TextboxActionKind[] = [
  'split',
  'join',
  'clean',
  'unwrap',
];

const ACTION_LABELS: Record<TextboxActionKind, string> = {
  split: 'Split Sentences',
  join: 'Join Text Boxes',
  clean: 'Clean Spaces',
  unwrap: 'Remove Line Breaks',
};

const ACTION_PROGRESS_LABELS: Record<TextboxActionKind, string> = {
  split: 'Splitting textboxes...',
  join: 'Joining textboxes...',
  clean: 'Cleaning spaces...',
  unwrap: 'Removing line breaks...',
};

type ViewMode = 'tools' | 'markers' | 'direct';
type MarkerSection = 'recognition' | 'calibration' | 'help';

type DirectDialogState = {
  action: TextboxActionKind | null;
  title: string;
  message: string;
  isBusy: boolean;
  canCancel: boolean;
  showOk: boolean;
  backupPath: string;
};

function formatPreviewBlocks(
  blocks: string[],
  emptyMessage: string,
): string {
  if (blocks.length === 0) {
    return emptyMessage;
  }

  return blocks.map(block => block || '(empty)').join('\n----\n');
}

function createIdleDirectDialog(): DirectDialogState {
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

function renderHighlightedTextSegments(
  text: string,
  ranges: EditMarkerHighlightRange[],
  highlightStyle: TextStyle,
): React.ReactNode[] {
  if (ranges.length === 0) {
    return [<Text key="plain">{text || '(empty)'}</Text>];
  }

  const segments: React.ReactNode[] = [];
  let cursor = 0;

  ranges.forEach((range, index) => {
    const safeStart = Math.max(cursor, Math.min(range.start, text.length));
    const safeEnd = Math.max(safeStart, Math.min(range.end, text.length));

    if (safeStart > cursor) {
      segments.push(
        <Text key={`plain-${index}-${cursor}`}>{text.slice(cursor, safeStart)}</Text>,
      );
    }

    if (safeEnd > safeStart) {
      segments.push(
        <Text key={`highlight-${index}-${safeStart}`} style={highlightStyle}>
          {text.slice(safeStart, safeEnd)}
        </Text>,
      );
    }

    cursor = safeEnd;
  });

  if (cursor < text.length) {
    segments.push(<Text key={`plain-tail-${cursor}`}>{text.slice(cursor)}</Text>);
  }

  if (segments.length === 0) {
    return [<Text key="empty">(empty)</Text>];
  }

  return segments;
}

function renderHighlightedPreviewBlocks(
  blocks: EditMarkerPreviewBlock[],
  emptyMessage: string,
  highlightStyle: TextStyle,
): React.ReactNode {
  if (blocks.length === 0) {
    return <Text style={styles.previewText}>{emptyMessage}</Text>;
  }

  return blocks.map((block, index) => (
    <View key={block.id || `block-${index}`} style={styles.previewBlock}>
      <Text style={styles.previewText}>
        {renderHighlightedTextSegments(block.text, block.highlightRanges, highlightStyle)}
      </Text>
      {index < blocks.length - 1 ? <Text style={styles.previewSeparator}>----</Text> : null}
    </View>
  ));
}

function App(): React.JSX.Element {
  const [viewMode, setViewMode] = useState<ViewMode>('tools');
  const [currentAction, setCurrentAction] = useState<TextboxActionKind | null>(null);
  const [preview, setPreview] = useState<TextboxActionPreview | null>(null);
  const [markerPreview, setMarkerPreview] = useState<EditMarkerPreview | null>(null);
  const [markerPreviewScope, setMarkerPreviewScope] =
    useState<EditMarkerPreviewScope>('lasso');
  const [activeMarkerSection, setActiveMarkerSection] =
    useState<MarkerSection>('help');
  const [isBusy, setIsBusy] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isMarkerPreviewLoading, setIsMarkerPreviewLoading] = useState(false);
  const [isMarkerBusy, setIsMarkerBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [backupPath, setBackupPath] = useState('');
  const [markerOffsetX, setMarkerOffsetX] = useState(
    () => getEditMarkerCalibration().offsetX,
  );
  const [markerWidthAdjustment, setMarkerWidthAdjustment] = useState(
    () => getEditMarkerCalibration().widthAdjustment,
  );
  const [directDialog, setDirectDialog] = useState<DirectDialogState>(
    createIdleDirectDialog(),
  );

  const cancelRequestedRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const logUiStatus = useCallback((scope: ViewMode, message: string) => {
    console.log(
      '[TextboxActionsUI] status',
      JSON.stringify({
        scope,
        message,
      }),
    );
  }, []);

  const updateStatus = useCallback((message: string) => {
    logUiStatus(viewMode, message);
    setStatus(message);
  }, [logUiStatus, viewMode]);

  const updateDirectDialog = useCallback((nextDialog: DirectDialogState) => {
    logUiStatus('direct', nextDialog.message);
    setDirectDialog(nextDialog);
  }, [logUiStatus]);

  const loadPreview = useCallback(async (action: TextboxActionKind | null) => {
    setIsPreviewLoading(true);

    try {
      const nextPreview = await getTextboxActionPreview(action);
      setPreview(nextPreview);

      if (action && nextPreview.availableActions[action]) {
        setCurrentAction(action);
      } else {
        setCurrentAction(null);
      }

      if (nextPreview.selectedCount === 0) {
        updateStatus('Select one or more main-layer textboxes.');
        return;
      }

      if (!nextPreview.hasOnlyTextboxes) {
        updateStatus('Only normal main-layer textboxes are supported.');
        return;
      }

      if (action && !nextPreview.availableActions[action]) {
        updateStatus(`${ACTION_LABELS[action]} is not available for the current selection.`);
        return;
      }

      updateStatus('');
    } catch (error) {
      updateStatus(`Could not read the current selection: ${String(error)}`);
    } finally {
      setIsPreviewLoading(false);
    }
  }, [updateStatus]);

  const loadMarkerPreview = useCallback(async (
    nextScope: EditMarkerPreviewScope = markerPreviewScope,
  ) => {
    setIsMarkerPreviewLoading(true);

    try {
      const nextPreview = await getEditMarkerPreview(nextScope);
      setMarkerPreview(nextPreview);
      setMarkerPreviewScope(nextScope);
      setActiveMarkerSection(
        nextPreview.recognizedOperationCount > 0 ? 'recognition' : 'help',
      );

      if (nextPreview.selectedMarkerCount === 0) {
        updateStatus(
          nextScope === 'page'
            ? 'No edit markers or straight-line markers were found on this page.'
            : 'Select one or more handwritten or straight-line edit markers.',
        );
        return;
      }

      if (!nextPreview.canApply) {
        updateStatus(nextPreview.summaryMessage);
        return;
      }

      updateStatus('');
    } catch (error) {
      updateStatus(`Could not read the current marker selection: ${String(error)}`);
    } finally {
      setIsMarkerPreviewLoading(false);
    }
  }, [markerPreviewScope, updateStatus]);

  const reloadMarkerPreviewWithCalibration = useCallback(
    async (nextCalibration: {offsetX?: number; widthAdjustment?: number}) => {
      const appliedCalibration = setEditMarkerCalibration(nextCalibration);
      setMarkerOffsetX(appliedCalibration.offsetX);
      setMarkerWidthAdjustment(appliedCalibration.widthAdjustment);
      await loadMarkerPreview();
    },
    [loadMarkerPreview],
  );

  useEffect(() => {
    return () => {
      clearPendingClose();
    };
  }, [clearPendingClose]);

  const closePluginView = useCallback(() => {
    clearPendingClose();
    PluginManager.closePluginView();
  }, [clearPendingClose]);

  const startDirectAction = useCallback(async (action: TextboxActionKind) => {
    clearPendingClose();
    cancelRequestedRef.current = false;
    setViewMode('direct');
    updateDirectDialog({
      action,
      title: ACTION_LABELS[action],
      message: ACTION_PROGRESS_LABELS[action],
      isBusy: true,
      canCancel: true,
      showOk: false,
      backupPath: '',
    });

    try {
      const result = await performTextboxAction(action, {
        isCancelled: () => cancelRequestedRef.current,
        onProgress: (update: TextboxActionProgressUpdate) => {
          logUiStatus('direct', update.message);
          setDirectDialog(current => ({
            ...current,
            action,
            title: ACTION_LABELS[action],
            message: update.message,
            canCancel: update.canCancel,
          }));
        },
      });

      updateDirectDialog({
        action,
        title: ACTION_LABELS[action],
        message: result.message,
        isBusy: false,
        canCancel: false,
        showOk: false,
        backupPath: result.backupPath,
      });

      closeTimerRef.current = setTimeout(() => {
        PluginManager.closePluginView();
      }, 700);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      const isCancelled = message === TEXTBOX_ACTION_CANCELLED_MESSAGE;

      updateDirectDialog({
        action,
        title: ACTION_LABELS[action],
        message: isCancelled ? 'Cancelled before making changes.' : message,
        isBusy: false,
        canCancel: false,
        showOk: true,
        backupPath: '',
      });
    }
  }, [clearPendingClose, logUiStatus, updateDirectDialog]);

  useEffect(() => {
    const routeButton = (buttonId: number) => {
      setBackupPath('');
      setStatus('');
      setDirectDialog(createIdleDirectDialog());
      clearPendingClose();
      cancelRequestedRef.current = false;

      if (buttonId === BUTTON_ID_TEXTBOX_TOOLS) {
        setViewMode('tools');
        loadPreview(null);
        return;
      }

      if (buttonId === BUTTON_ID_TOOLBAR_APPLY_EDIT_MARKERS) {
        setViewMode('markers');
        loadMarkerPreview('lasso');
        return;
      }

      if (buttonId === BUTTON_ID_NOTE_APPLY_ALL_EDIT_MARKERS) {
        setViewMode('markers');
        loadMarkerPreview('page');
        return;
      }

      if (buttonId === BUTTON_ID_TOOLBAR_SPLIT_TEXTBOX) {
        startDirectAction('split');
        return;
      }

      if (buttonId === BUTTON_ID_TOOLBAR_JOIN_TEXTBOXES) {
        startDirectAction('join');
        return;
      }

      if (buttonId === BUTTON_ID_TOOLBAR_CLEAN_TEXTBOX_SPACES) {
        startDirectAction('clean');
        return;
      }

      if (buttonId === BUTTON_ID_TOOLBAR_REMOVE_LINE_BREAKS) {
        startDirectAction('unwrap');
      }
    };

    const pendingButton = checkPendingButton();
    if (pendingButton !== null) {
      routeButton(pendingButton);
    }

    const subscription = DeviceEventEmitter.addListener(
      PLUGIN_BUTTON_EVENT,
      ({id}: {id: number}) => {
        checkPendingButton();
        routeButton(id);
      },
    );

    return () => {
      subscription.remove();
    };
  }, [clearPendingClose, loadMarkerPreview, loadPreview, startDirectAction]);

  const executeCurrentAction = useCallback(async () => {
    if (!currentAction) {
      return;
    }

    setIsBusy(true);
    setBackupPath('');
    updateStatus(`Executing ${ACTION_LABELS[currentAction]}...`);

    try {
      const result = await performTextboxAction(currentAction);
      setBackupPath(result.backupPath);
      await loadPreview(null);
      updateStatus(result.message);
    } catch (error) {
      updateStatus(`Textbox action failed: ${String(error)}`);
    } finally {
      setIsBusy(false);
    }
  }, [currentAction, loadPreview, updateStatus]);

  const executeEditMarkers = useCallback(async () => {
    if (!markerPreview?.canApply) {
      return;
    }

    setIsMarkerBusy(true);
    setBackupPath('');
    updateStatus('Applying recognized edit markers...');

    try {
      const result = await applyEditMarkerPreview(markerPreview, {
        onProgress: update => {
          updateStatus(update.message);
        },
      });
      setBackupPath(result.backupPath);

      try {
        const refreshedPreview = await getEditMarkerPreview(markerPreviewScope);
        setMarkerPreview(refreshedPreview);
      } catch {
        // Preserve the success message even if the lasso state is already gone.
      }

      updateStatus(result.message);
      closeTimerRef.current = setTimeout(() => {
        PluginManager.closePluginView();
      }, 700);
    } catch (error) {
      updateStatus(`Edit marker apply failed: ${String(error)}`);
    } finally {
      setIsMarkerBusy(false);
    }
  }, [markerPreview, markerPreviewScope, updateStatus]);

  const availableActionLabels = useMemo(() => {
    if (!preview) {
      return [];
    }

    return ACTION_ORDER.filter(action => preview.availableActions[action]).map(
      action => ACTION_LABELS[action],
    );
  }, [preview]);

  const beforePreviewText = useMemo(
    () => formatPreviewBlocks(preview?.beforeBlocks || [], 'No textbox text to preview.'),
    [preview],
  );
  const afterPreviewText = useMemo(() => {
    if (!currentAction) {
      return 'Choose an action above to preview the result.';
    }

    return formatPreviewBlocks(
      preview?.afterBlocks || [],
      'This action is not available for the current selection.',
    );
  }, [currentAction, preview]);

  const markerBeforePreviewContent = useMemo(
    () =>
      renderHighlightedPreviewBlocks(
        markerPreview?.beforePreviewBlocks || [],
        'No relevant textbox text found for the selected markers.',
        styles.deletedPreviewText,
      ),
    [markerPreview],
  );
  const markerAfterPreviewContent = useMemo(
    () =>
      renderHighlightedPreviewBlocks(
        markerPreview?.afterPreviewBlocks || [],
        'No recognized marker operations are ready to preview.',
        styles.insertedPreviewText,
      ),
    [markerPreview],
  );

  const canExecute =
    !!currentAction &&
    !!preview &&
    preview.availableActions[currentAction] &&
    !isBusy &&
    !isPreviewLoading;

  const canApplyMarkers =
    !!markerPreview?.canApply &&
    !isMarkerBusy &&
    !isMarkerPreviewLoading;

  const handleDirectCancel = useCallback(() => {
    if (directDialog.isBusy && directDialog.canCancel) {
      cancelRequestedRef.current = true;
      updateDirectDialog({
        ...directDialog,
        message: 'Canceling before changes are applied...',
        canCancel: false,
      });
      return;
    }

    if (directDialog.isBusy) {
      updateDirectDialog({
        ...directDialog,
        message: 'Finishing the current change safely...',
      });
      return;
    }

    closePluginView();
  }, [closePluginView, directDialog, updateDirectDialog]);

  const renderDirectDialog = () => (
    <View style={styles.dialogScreen}>
      <StatusBar barStyle="dark-content" backgroundColor={UI_COLORS.white} />
      <View style={styles.dialogCard}>
        <Text style={styles.dialogEyebrow}>Textbox Action</Text>
        <Text style={styles.dialogTitle}>{directDialog.title}</Text>
        <Text style={styles.dialogMessage}>{directDialog.message}</Text>
        {directDialog.backupPath ? (
          <Text style={styles.dialogMeta}>{directDialog.backupPath}</Text>
        ) : null}
        <View style={styles.dialogButtonRow}>
          <TouchableOpacity
            activeOpacity={0.75}
            style={styles.secondaryButton}
            onPress={handleDirectCancel}>
            <Text style={styles.secondaryButtonText}>
              {directDialog.isBusy ? 'Cancel' : 'Close'}
            </Text>
          </TouchableOpacity>
          {directDialog.showOk ? (
            <TouchableOpacity
              activeOpacity={0.75}
              style={styles.primaryButton}
              onPress={closePluginView}>
              <Text style={styles.primaryButtonText}>OK</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  );

  const renderToolsView = () => (
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
          <TouchableOpacity
            activeOpacity={0.75}
            style={styles.closeButton}
            onPress={closePluginView}>
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
                  (!isAvailable || isPreviewLoading || isBusy) && styles.actionButtonDisabled,
                ]}
                onPress={() => loadPreview(action)}
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
          style={[styles.executeButton, !canExecute && styles.executeButtonDisabled]}
          onPress={executeCurrentAction}
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

  const renderMarkerOperations = () => {
    if (!markerPreview || markerPreview.operations.length === 0) {
      return (
        <Text style={styles.emptyStateText}>
          No recognized operations yet.
        </Text>
      );
    }

    return markerPreview.operations.map(operation => (
      <View key={operation.id} style={styles.listRow}>
        <Text style={styles.listTitle}>{operation.summary}</Text>
        <Text style={styles.listDetail}>{operation.detail}</Text>
      </View>
    ));
  };

  const renderIgnoredMarkers = () => {
    if (!markerPreview || markerPreview.ignoredMarkers.length === 0) {
      return (
        <Text style={styles.emptyStateText}>
          No selected markers were ignored.
        </Text>
      );
    }

    return markerPreview.ignoredMarkers.map(marker => (
      <View
        key={`${marker.markerUuid}:${marker.markerNumInPage}`}
        style={styles.listRow}>
        <Text style={styles.listTitle}>{marker.summary}</Text>
        <Text style={styles.listDetail}>{marker.reason}</Text>
      </View>
    ));
  };

  const renderMarkerSection = (
    section: MarkerSection,
    title: string,
    content: React.ReactNode,
  ) => {
    const isOpen = activeMarkerSection === section;

    return (
      <View style={styles.sectionCard}>
        <TouchableOpacity
          activeOpacity={0.75}
          style={styles.sectionHeaderButton}
          onPress={() => {
            setActiveMarkerSection(current =>
              current === section ? current : section,
            );
          }}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionToggleText}>{isOpen ? 'Hide' : 'Show'}</Text>
        </TouchableOpacity>
        {isOpen ? content : null}
      </View>
    );
  };

  const renderMarkersView = () => (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={UI_COLORS.white} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>Edit Marker Review</Text>
            <Text style={styles.summaryText}>
              {markerPreview
                ? markerPreviewScope === 'page'
                  ? markerPreview.selectedMarkerCount === 1
                    ? '1 marker found on this page'
                    : `${markerPreview.selectedMarkerCount} markers found on this page`
                  : markerPreview.selectedMarkerCount === 1
                    ? '1 marker selected'
                    : `${markerPreview.selectedMarkerCount} markers selected`
                : 'Loading markers...'}
            </Text>
            <Text style={styles.summaryText}>
              {markerPreview?.summaryMessage || 'Analyzing selected markers...'}
            </Text>
            <Text style={styles.summaryText}>
              {markerPreviewScope === 'page' ? 'Global' : 'Current selection'}
            </Text>
          </View>
          <TouchableOpacity
            activeOpacity={0.75}
            style={styles.closeButton}
            onPress={closePluginView}>
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.previewRow}>
          <View style={styles.previewCard}>
            <Text style={styles.previewTitle}>Current</Text>
            {markerBeforePreviewContent}
          </View>
          <View style={styles.previewCard}>
            <Text style={styles.previewTitle}>Changed</Text>
            {markerAfterPreviewContent}
          </View>
        </View>

        <TouchableOpacity
          activeOpacity={0.75}
          style={[styles.executeButton, !canApplyMarkers && styles.executeButtonDisabled]}
          onPress={executeEditMarkers}
          disabled={!canApplyMarkers}>
          <Text style={styles.executeButtonText}>
            {isMarkerBusy ? 'Applying...' : 'Apply Edit Markers'}
          </Text>
        </TouchableOpacity>

        {renderMarkerSection(
          'recognition',
          'Recognition Details',
          <View style={styles.sectionBody}>
            <Text style={styles.subsectionTitle}>Recognized</Text>
            {renderMarkerOperations()}
            <Text style={styles.subsectionTitle}>Ignored</Text>
            {renderIgnoredMarkers()}
          </View>,
        )}

        {renderMarkerSection(
          'calibration',
          'Calibration',
          <View style={styles.calibrationCompactCard}>
            <View style={styles.calibrationCompactRow}>
              <View style={styles.calibrationInlineGroup}>
                <Text style={styles.calibrationInlineLabel}>X</Text>
                <TouchableOpacity
                  activeOpacity={0.75}
                  style={styles.calibrationButton}
                  onPress={() => {
                    if (!isMarkerPreviewLoading && !isMarkerBusy) {
                      void reloadMarkerPreviewWithCalibration({
                        offsetX: markerOffsetX - 5,
                      });
                    }
                  }}
                  disabled={isMarkerPreviewLoading || isMarkerBusy}>
                  <Text style={styles.calibrationButtonText}>-5</Text>
                </TouchableOpacity>
                <Text style={styles.calibrationCompactValue}>{markerOffsetX}px</Text>
                <TouchableOpacity
                  activeOpacity={0.75}
                  style={styles.calibrationButton}
                  onPress={() => {
                    if (!isMarkerPreviewLoading && !isMarkerBusy) {
                      void reloadMarkerPreviewWithCalibration({
                        offsetX: markerOffsetX + 5,
                      });
                    }
                  }}
                  disabled={isMarkerPreviewLoading || isMarkerBusy}>
                  <Text style={styles.calibrationButtonText}>+5</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.calibrationInlineGroup}>
                <Text style={styles.calibrationInlineLabel}>Width</Text>
                <TouchableOpacity
                  activeOpacity={0.75}
                  style={styles.calibrationButton}
                  onPress={() => {
                    if (!isMarkerPreviewLoading && !isMarkerBusy) {
                      void reloadMarkerPreviewWithCalibration({
                        widthAdjustment: markerWidthAdjustment - 1,
                      });
                    }
                  }}
                  disabled={isMarkerPreviewLoading || isMarkerBusy}>
                  <Text style={styles.calibrationButtonText}>-1</Text>
                </TouchableOpacity>
                <Text style={styles.calibrationCompactValue}>{markerWidthAdjustment}px</Text>
                <TouchableOpacity
                  activeOpacity={0.75}
                  style={styles.calibrationButton}
                  onPress={() => {
                    if (!isMarkerPreviewLoading && !isMarkerBusy) {
                      void reloadMarkerPreviewWithCalibration({
                        widthAdjustment: markerWidthAdjustment + 1,
                      });
                    }
                  }}
                  disabled={isMarkerPreviewLoading || isMarkerBusy}>
                  <Text style={styles.calibrationButtonText}>+1</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.calibrationInlineGroup}>
                <TouchableOpacity
                  activeOpacity={0.75}
                  style={styles.calibrationButton}
                  onPress={() => {
                    if (!isMarkerPreviewLoading && !isMarkerBusy) {
                      const nextCalibration = resetEditMarkerCalibration();
                      setMarkerOffsetX(nextCalibration.offsetX);
                      setMarkerWidthAdjustment(nextCalibration.widthAdjustment);
                      void loadMarkerPreview();
                    }
                  }}
                  disabled={isMarkerPreviewLoading || isMarkerBusy}>
                  <Text style={styles.calibrationButtonText}>Reset</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.75}
                  style={styles.calibrationButton}
                  onPress={() => {
                    if (!isMarkerPreviewLoading && !isMarkerBusy) {
                      void loadMarkerPreview();
                    }
                  }}
                  disabled={isMarkerPreviewLoading || isMarkerBusy}>
                  <Text style={styles.calibrationButtonText}>Refresh</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>,
        )}

        {renderMarkerSection(
          'help',
          'Help',
          <View style={styles.sectionBody}>
            <Text style={styles.helpText}>
              Delete: draw a horizontal line through the words you want to remove.
            </Text>
            <Text style={styles.helpText}>
              Replace: draw the delete line, then add two short crossing vertical lines to mark it as a replacement.
            </Text>
            <Text style={styles.helpText}>
              Replacement text: type a line below the paragraph starting with `#`, for example `# corrected phrase`.
            </Text>
            <Text style={styles.helpText}>
              Multiple replacements are matched in reading order. Only recognized markers are removed on apply.
            </Text>
          </View>,
        )}

        {status ? <Text style={styles.statusText}>{status}</Text> : null}
        {backupPath ? <Text style={styles.backupText}>{backupPath}</Text> : null}
      </ScrollView>
    </View>
  );

  if (viewMode === 'direct') {
    return renderDirectDialog();
  }

  if (viewMode === 'markers') {
    return renderMarkersView();
  }

  return renderToolsView();
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: UI_COLORS.white,
  },
  content: {
    paddingHorizontal: 20,
    paddingVertical: 18,
    gap: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  headerCopy: {
    flex: 1,
    gap: 4,
  },
  eyebrow: {
    fontSize: UI_FONT_SIZES.meta,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: UI_COLORS.gray,
  },
  title: {
    fontSize: UI_FONT_SIZES.title,
    fontWeight: '700',
    color: UI_COLORS.black,
  },
  summaryText: {
    fontSize: UI_FONT_SIZES.body,
    lineHeight: 21,
    color: UI_COLORS.gray,
  },
  closeButton: {
    borderWidth: 1,
    borderColor: UI_COLORS.black,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: UI_COLORS.white,
  },
  closeButtonText: {
    fontSize: UI_FONT_SIZES.body,
    fontWeight: '600',
    color: UI_COLORS.black,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  actionButton: {
    width: '48%',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: UI_COLORS.black,
    backgroundColor: UI_COLORS.white,
    paddingHorizontal: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  actionButtonSelected: {
    backgroundColor: UI_COLORS.black,
  },
  actionButtonDisabled: {
    opacity: 0.35,
  },
  actionButtonText: {
    color: UI_COLORS.black,
    fontSize: UI_FONT_SIZES.body,
    fontWeight: '700',
    textAlign: 'center',
  },
  actionButtonTextSelected: {
    color: UI_COLORS.white,
  },
  previewRow: {
    flexDirection: 'row',
    gap: 12,
  },
  previewCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: UI_COLORS.lightGray,
    backgroundColor: UI_COLORS.softGray,
    padding: 16,
    gap: 10,
    minHeight: 280,
  },
  previewTitle: {
    fontSize: UI_FONT_SIZES.body,
    fontWeight: '700',
    color: UI_COLORS.black,
  },
  previewText: {
    fontSize: UI_FONT_SIZES.body,
    lineHeight: 21,
    color: UI_COLORS.black,
  },
  deletedPreviewText: {
    textDecorationLine: 'underline',
    textDecorationColor: UI_COLORS.black,
    fontWeight: '700',
  },
  insertedPreviewText: {
    textDecorationLine: 'underline',
    textDecorationColor: UI_COLORS.black,
    fontWeight: '700',
  },
  previewBlock: {
    gap: 10,
  },
  previewSeparator: {
    fontSize: UI_FONT_SIZES.body,
    lineHeight: 21,
    color: UI_COLORS.gray,
  },
  calibrationRow: {
    gap: 10,
  },
  calibrationLabel: {
    fontSize: UI_FONT_SIZES.meta,
    lineHeight: 18,
    color: UI_COLORS.gray,
    fontWeight: '600',
  },
  calibrationControls: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  calibrationButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: UI_COLORS.black,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: UI_COLORS.white,
  },
  calibrationButtonText: {
    fontSize: UI_FONT_SIZES.meta,
    fontWeight: '700',
    color: UI_COLORS.black,
  },
  calibrationValue: {
    fontSize: UI_FONT_SIZES.body,
    fontWeight: '700',
    color: UI_COLORS.black,
    minWidth: 64,
  },
  calibrationCompactCard: {
    gap: 8,
  },
  calibrationCompactRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  },
  calibrationInlineGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  calibrationInlineLabel: {
    fontSize: UI_FONT_SIZES.meta,
    lineHeight: 18,
    color: UI_COLORS.gray,
    fontWeight: '600',
  },
  calibrationCompactValue: {
    fontSize: UI_FONT_SIZES.meta,
    fontWeight: '700',
    color: UI_COLORS.black,
    minWidth: 54,
  },
  sectionCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: UI_COLORS.lightGray,
    backgroundColor: UI_COLORS.softGray,
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    fontSize: UI_FONT_SIZES.body,
    fontWeight: '700',
    color: UI_COLORS.black,
  },
  sectionHeaderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionToggleText: {
    fontSize: UI_FONT_SIZES.meta,
    color: UI_COLORS.gray,
    fontWeight: '600',
  },
  sectionBody: {
    gap: 12,
  },
  subsectionTitle: {
    fontSize: UI_FONT_SIZES.meta,
    lineHeight: 18,
    color: UI_COLORS.gray,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  listRow: {
    gap: 4,
  },
  listTitle: {
    fontSize: UI_FONT_SIZES.body,
    lineHeight: 21,
    color: UI_COLORS.black,
    fontWeight: '600',
  },
  listDetail: {
    fontSize: UI_FONT_SIZES.meta,
    lineHeight: 18,
    color: UI_COLORS.gray,
  },
  emptyStateText: {
    fontSize: UI_FONT_SIZES.body,
    lineHeight: 21,
    color: UI_COLORS.gray,
  },
  helpText: {
    fontSize: UI_FONT_SIZES.body,
    lineHeight: 21,
    color: UI_COLORS.black,
  },
  executeButton: {
    borderRadius: 16,
    backgroundColor: UI_COLORS.black,
    paddingHorizontal: 16,
    paddingVertical: 15,
    alignItems: 'center',
  },
  executeButtonDisabled: {
    opacity: 0.35,
  },
  executeButtonText: {
    color: UI_COLORS.white,
    fontSize: UI_FONT_SIZES.body,
    fontWeight: '700',
  },
  statusText: {
    fontSize: UI_FONT_SIZES.body,
    lineHeight: 21,
    color: UI_COLORS.black,
  },
  backupText: {
    fontSize: UI_FONT_SIZES.meta,
    lineHeight: 18,
    color: UI_COLORS.gray,
  },
  dialogScreen: {
    flex: 1,
    backgroundColor: UI_COLORS.white,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  dialogCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: UI_COLORS.lightGray,
    backgroundColor: UI_COLORS.softGray,
    paddingHorizontal: 20,
    paddingVertical: 22,
    gap: 10,
  },
  dialogEyebrow: {
    fontSize: UI_FONT_SIZES.meta,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: UI_COLORS.gray,
  },
  dialogTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: UI_COLORS.black,
  },
  dialogMessage: {
    fontSize: UI_FONT_SIZES.body,
    lineHeight: 22,
    color: UI_COLORS.black,
  },
  dialogMeta: {
    fontSize: UI_FONT_SIZES.meta,
    lineHeight: 18,
    color: UI_COLORS.gray,
  },
  dialogButtonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 6,
  },
  secondaryButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: UI_COLORS.black,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: UI_COLORS.white,
  },
  secondaryButtonText: {
    fontSize: UI_FONT_SIZES.body,
    fontWeight: '600',
    color: UI_COLORS.black,
  },
  primaryButton: {
    borderRadius: 999,
    backgroundColor: UI_COLORS.black,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  primaryButtonText: {
    fontSize: UI_FONT_SIZES.body,
    fontWeight: '700',
    color: UI_COLORS.white,
  },
});

export default App;
