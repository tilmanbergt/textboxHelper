/**
 * @format
 */

/**
 * The plugin's shell: asks for the file permissions, listens for the Supernote buttons and opens
 * one screen per press. Each screen is keyed by the press (`launchKey`), so a screen opened again
 * starts fresh; the screens own their state (technical-design-calmer-screens.md §3.3).

 */

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {DeviceEventEmitter} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';
import {setEditMarkerCalibration} from './src/actions/editMarkers';
import {loadSettings} from './src/storage/settingsFile';
import {ensurePermissions} from './src/supernote/permissions';
import {PLUGIN_BUTTON_EVENT, checkPendingButton} from './src/supernote/pluginRouting';
import {
  BUTTON_ID_EXPORT_DOCX,
  BUTTON_ID_IMPORT_TEXT_FILE,
  BUTTON_ID_NOTE_APPLY_ALL_EDIT_MARKERS,
  BUTTON_ID_TEXTBOX_TOOLS,
  BUTTON_ID_TOOLBAR_APPLY_EDIT_MARKERS,
  BUTTON_ID_TOOLBAR_CLEAN_TEXTBOX_SPACES,
  BUTTON_ID_TOOLBAR_JOIN_TEXTBOXES,
  BUTTON_ID_TOOLBAR_REMOVE_LINE_BREAKS,
  BUTTON_ID_TOOLBAR_SPLIT_PARAGRAPHS_TEXTBOX,
  BUTTON_ID_TOOLBAR_SPLIT_TEXTBOX,
} from './src/domain/buttonIds';
import type {EditMarkerPreviewScope} from './src/domain/markerTypes';
import type {TextboxActionKind} from './src/domain/textboxActionKinds';
import DirectActionScreen from './src/screens/direct/DirectActionScreen';
import ExportScreen from './src/screens/export/ExportScreen';
import ImportScreen from './src/screens/import/ImportScreen';
import EditMarkerReviewScreen from './src/screens/markers/EditMarkerReviewScreen';
import TextboxToolsScreen from './src/screens/tools/TextboxToolsScreen';
import ScreenFrame from './src/ui/ScreenFrame';

type Screen = 'routing' | 'permission' | 'tools' | 'markers' | 'direct' | 'import' | 'export';

const DIRECT_ACTIONS: Record<number, TextboxActionKind> = {
  [BUTTON_ID_TOOLBAR_SPLIT_TEXTBOX]: 'split',
  [BUTTON_ID_TOOLBAR_SPLIT_PARAGRAPHS_TEXTBOX]: 'splitParagraphs',
  [BUTTON_ID_TOOLBAR_JOIN_TEXTBOXES]: 'join',
  [BUTTON_ID_TOOLBAR_CLEAN_TEXTBOX_SPACES]: 'clean',
  [BUTTON_ID_TOOLBAR_REMOVE_LINE_BREAKS]: 'unwrap',
};

function App(): React.JSX.Element | null {
  const [screen, setScreen] = useState<Screen>('routing');
  // Changes with every button press: the screen's key, so it starts fresh.
  const [launchKey, setLaunchKey] = useState(0);
  const [markerScope, setMarkerScope] = useState<EditMarkerPreviewScope>('lasso');
  const [directAction, setDirectAction] = useState<TextboxActionKind>('split');

  const closePluginView = useCallback(() => {
    PluginManager.closePluginView();
  }, []);

  const routeButton = (buttonId: number) => {
    setLaunchKey(key => key + 1);
    if (buttonId === BUTTON_ID_TEXTBOX_TOOLS) {
      setScreen('tools');
      return;
    }
    if (buttonId === BUTTON_ID_TOOLBAR_APPLY_EDIT_MARKERS || buttonId === BUTTON_ID_NOTE_APPLY_ALL_EDIT_MARKERS) {
      setMarkerScope(buttonId === BUTTON_ID_NOTE_APPLY_ALL_EDIT_MARKERS ? 'page' : 'lasso');
      setScreen('markers');
      return;
    }
    if (DIRECT_ACTIONS[buttonId]) {
      setDirectAction(DIRECT_ACTIONS[buttonId]);
      setScreen('direct');
      return;
    }
    if (buttonId === BUTTON_ID_IMPORT_TEXT_FILE) {
      setScreen('import');
      return;
    }
    if (buttonId === BUTTON_ID_EXPORT_DOCX) {
      setScreen('export');
    }
  };

  // The listener subscribes once and always calls the latest routeButton.
  const routeButtonRef = useRef(routeButton);
  routeButtonRef.current = routeButton;

  // FILE:READ/FILE:WRITE are asked for before the buttons are wired: every screen reads or writes
  // note elements, and without the permission the first host call would fail with an error code.
  useEffect(() => {
    let subscription: {remove: () => void} | undefined;
    let active = true;
    (async () => {
      const granted = await ensurePermissions();
      if (!active) {
        return;
      }
      if (!granted) {
        setScreen('permission');
        return;
      }
      // Remembered settings before the first screen: the import settings and the calibration.
      const settings = await loadSettings();
      setEditMarkerCalibration(settings.markers.calibration);
      if (!active) {
        return;
      }
      const pendingButton = checkPendingButton();
      if (pendingButton !== null) {
        routeButtonRef.current(pendingButton);
      }
      subscription = DeviceEventEmitter.addListener(PLUGIN_BUTTON_EVENT, ({id}: {id: number}) => {
        checkPendingButton();
        routeButtonRef.current(id);
      });
    })();
    return () => {
      active = false;
      subscription?.remove();
    };
  }, []);

  switch (screen) {
    case 'routing':
      return null;
    case 'permission':
      return (
        <ScreenFrame
          title="Textbox Tools"
          onClose={closePluginView}
          status={{kind: 'error', text: 'Missing permission: allow file read and write access for this plugin.'}}>
          {null}
        </ScreenFrame>
      );
    case 'tools':
      return <TextboxToolsScreen key={launchKey} onClose={closePluginView} />;
    case 'markers':
      return <EditMarkerReviewScreen key={launchKey} scope={markerScope} onClose={closePluginView} />;
    case 'direct':
      return <DirectActionScreen key={launchKey} action={directAction} onClose={closePluginView} />;
    case 'import':
      return <ImportScreen key={launchKey} onClose={closePluginView} />;
    case 'export':
      return <ExportScreen key={launchKey} onClose={closePluginView} />;
  }
}

export default App;
