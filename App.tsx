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
import {DeviceEventEmitter} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';
import {
    BUTTON_ID_EXPORT_DOCX,
    BUTTON_ID_IMPORT_TEXT_FILE,
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

import ExportScreen from './src/export/ExportScreen';
import {
  refreshExportNoteContext,
  type ExportNoteContext,
} from './src/export/exportNoteContext';
import {
  applyEditMarkerPreview,
  getEditMarkerCalibration,
  getEditMarkerPreview,
  resetEditMarkerCalibration,
  setEditMarkerCalibration,
  type EditMarkerPreviewScope,
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

import {styles} from './src/ui/pluginUiStyles';

import {
  DirectActionDialog,
  createIdleDirectDialog,
  type DirectDialogState,
} from './src/ui/DirectActionDialog';

import {
  DEFAULT_TEXTBOX_IMPORT_SETTINGS,
  getTextboxImportPreview,
  performTextboxImport,
  type TextboxImportPreview,
  type TextboxImportSettings,
} from './src/textboxImportActions';

import {ImportTextFileView} from './src/ui/ImportTextFileView';


import {
    ACTION_ORDER,
  ACTION_LABELS,
  TextboxToolsView,
  formatPreviewBlocks,
} from './src/ui/TextboxToolsView';

import {
  EditMarkerReviewView,
  renderHighlightedPreviewBlocks,
} from './src/ui/EditMarkerReviewView';

const ACTION_PROGRESS_LABELS: Record<TextboxActionKind, string> = {
  log: 'Logging textboxes...',
  split: 'Splitting textboxes...',
  join: 'Joining textboxes...',
  clean: 'Cleaning spaces...',
  unwrap: 'Removing line breaks...',
};

type ViewMode =
  | 'routing'
  | 'tools'
  | 'markers'
  | 'direct'
  | 'import'
  | 'exportDocx';
  type MarkerSection = 'recognition' | 'calibration' | 'help';









function App(): React.JSX.Element {
    const [importSettings, setImportSettings] = useState<TextboxImportSettings>(
      DEFAULT_TEXTBOX_IMPORT_SETTINGS,
    );
    const [isImportBusy, setIsImportBusy] = useState(false);
    const [importPreview, setImportPreview] =
      useState<TextboxImportPreview | null>(null);
      const [exportNoteContext, setExportNoteContext] =
        useState<ExportNoteContext | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('routing');
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
const refreshNoteContext = useCallback(async () => {
  const nextContext = await refreshExportNoteContext();
  setExportNoteContext(nextContext);

  return {
    filePath: nextContext.filePath,
    page: nextContext.page,
  };
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

      if (action !== 'log' && nextPreview.selectedCount === 0) {
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
     updateStatus(
       nextScope === 'page'
         ? `Could not read the current page markers: ${String(error)}`
         : `Could not read the current marker selection: ${String(error)}`,
     );
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
   if (buttonId === BUTTON_ID_IMPORT_TEXT_FILE) {
          setViewMode('import');
            updateStatus('');
          return;
        }
if (buttonId === BUTTON_ID_EXPORT_DOCX) {
  setViewMode('exportDocx');
  setExportNoteContext(null);
  updateStatus('');

  void refreshNoteContext().catch(error => {
    updateStatus(`Could not read current note context: ${String(error)}`);
  });

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

const previewImportTextFile = useCallback(async () => {
  setIsImportBusy(true);
  setImportPreview(null);
  updateStatus('Reading import file...');

  try {
    const nextPreview = await getTextboxImportPreview(importSettings);
    setImportPreview(nextPreview);
    updateStatus(
      `Read ${nextPreview.wordCount} words, ${nextPreview.characterCount} characters, ${nextPreview.paragraphCount} paragraphs.`,
    );
  } catch (error) {
    updateStatus(`Could not preview import file: ${String(error)}`);
  } finally {
    setIsImportBusy(false);
  }
}, [importSettings, updateStatus]);

const executeImportTextFile = useCallback(async () => {
  setIsImportBusy(true);
  updateStatus('Starting text import...');

  try {
    const result = await performTextboxImport(importSettings, {
      onProgress: update => {
        updateStatus(update.message);
      },
    });

    setImportPreview(null);
    updateStatus(result.message);
  } catch (error) {
    updateStatus(`Import failed: ${String(error)}`);
  } finally {
    setIsImportBusy(false);
  }
}, [importSettings, updateStatus]);


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
      if (currentAction === 'log') {
        setPreview(current => current
          ? {
              ...current,
              beforeBlocks: [],
              afterBlocks: result.previewBlocks || [],
              selectionMessage: result.message,
            }
          : current,
        );
      } else {
        setPreview(null);
        setCurrentAction(null);
      }
      updateStatus(result.message);
    } catch (error) {
      updateStatus(`Textbox action failed: ${String(error)}`);
    } finally {
      setIsBusy(false);
    }
  }, [currentAction, updateStatus]);

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







if (viewMode === 'direct') {
  return (
    <DirectActionDialog
      dialog={directDialog}
      onCancelOrClose={handleDirectCancel}
      onOk={closePluginView}
    />
  );
}

if (viewMode === 'markers') {
  return (
    <EditMarkerReviewView
      markerPreview={markerPreview}
      markerPreviewScope={markerPreviewScope}
      activeMarkerSection={activeMarkerSection}
      markerBeforePreviewContent={markerBeforePreviewContent}
      markerAfterPreviewContent={markerAfterPreviewContent}
      markerOffsetX={markerOffsetX}
      markerWidthAdjustment={markerWidthAdjustment}
      isMarkerBusy={isMarkerBusy}
      isMarkerPreviewLoading={isMarkerPreviewLoading}
      canApplyMarkers={canApplyMarkers}
      status={status}
      backupPath={backupPath}
      onClose={closePluginView}
      onApply={executeEditMarkers}
      onSetActiveMarkerSection={setActiveMarkerSection}
      onChangeCalibration={nextCalibration => {
        if (!isMarkerPreviewLoading && !isMarkerBusy) {
          void reloadMarkerPreviewWithCalibration(nextCalibration);
        }
      }}
      onResetCalibration={() => {
        if (!isMarkerPreviewLoading && !isMarkerBusy) {
          const nextCalibration = resetEditMarkerCalibration();
          setMarkerOffsetX(nextCalibration.offsetX);
          setMarkerWidthAdjustment(nextCalibration.widthAdjustment);
          void loadMarkerPreview();
        }
      }}
      onRefreshCalibration={() => {
        if (!isMarkerPreviewLoading && !isMarkerBusy) {
          void loadMarkerPreview();
        }
      }}
    />
  );
}

if (viewMode === 'import') {
  return (
    <ImportTextFileView
      settings={importSettings}
      preview={importPreview}
      isBusy={isImportBusy}
      status={status}
      onChangeSettings={nextSettings => {
        setImportSettings(nextSettings);
        setImportPreview(null);
        updateStatus('');
      }}
      onPreview={previewImportTextFile}
      onImport={executeImportTextFile}
      onClose={closePluginView}
    />
  );
}

if (viewMode === 'exportDocx') {
  return (
    <ExportScreen
      pageInfo={
        exportNoteContext?.pageInfo ??
        'Reading current note context...'
      }
      currentPage={exportNoteContext?.page ?? null}
      onClose={closePluginView}
      refreshNoteContext={refreshNoteContext}
    />
  );
}

if (viewMode === 'routing') {
  return null;
}
  return (
    <TextboxToolsView
      preview={preview}
      currentAction={currentAction}
      isBusy={isBusy}
      isPreviewLoading={isPreviewLoading}
      status={status}
      backupPath={backupPath}
      canExecute={canExecute}
      beforePreviewText={beforePreviewText}
      afterPreviewText={afterPreviewText}
      availableActionLabels={availableActionLabels}
      onSelectAction={loadPreview}
      onExecute={executeCurrentAction}
      onClose={closePluginView}
    />
  );
}



export default App;
