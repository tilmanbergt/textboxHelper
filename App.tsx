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
import {setEditMarkerCalibration} from './src/actions/markerCalibration';
import {
  getPenEditOutcome,
  getReviewFocus,
  setPenEditOutcome,
  setReviewFocus,
  subscribePenEditOutcome,
  subscribeReviewFocus,
} from './src/actions/penEditTag';
import {loadSettings} from './src/storage/settingsFile';
import {ensurePermissions} from './src/supernote/permissions';
import {PLUGIN_BUTTON_EVENT, checkPendingButton} from './src/supernote/pluginRouting';
import {BUTTON_ID_NOTE_MANUSCRIPT, BUTTON_ID_TEXTBOX_TOOLS} from './src/domain/buttonIds';
import ManuscriptScreen from './src/screens/manuscript/ManuscriptScreen';
import PenEditOutcomeScreen from './src/screens/penEdit/PenEditOutcomeScreen';
import TextboxToolsScreen from './src/screens/tools/TextboxToolsScreen';
import ScreenFrame from './src/ui/ScreenFrame';

type Screen = 'routing' | 'permission' | 'tools' | 'manuscript';

function App(): React.JSX.Element | null {
  const [screen, setScreen] = useState<Screen>('routing');
  // Changes with every button press: the screen's key, so it starts fresh.
  const [launchKey, setLaunchKey] = useState(0);

  // Set by a pen-edit tag that needs a word (index.js); shown before any other screen.
  const [penEditOutcome, setPenEditOutcomeState] = useState(getPenEditOutcome());

  const closePluginView = useCallback(() => {
    PluginManager.closePluginView();
  }, []);

  useEffect(() => subscribePenEditOutcome(() => setPenEditOutcomeState(getPenEditOutcome())), []);

  // A mark selected from the Manuscript card (Select mark): the card opens again at that snippet's
  // change.
  const [focusPenEditId, setFocusPenEditId] = useState<string | null>(null);
  useEffect(() => {
    const openFocus = () => {
      const focus = getReviewFocus();
      if (!focus) {
        return;
      }
      setReviewFocus(null);
      setPenEditOutcome(null);
      setFocusPenEditId(focus.penEditId);
      setLaunchKey(key => key + 1);
      setScreen('manuscript');
    };
    openFocus();
    return subscribeReviewFocus(openFocus);
  }, []);

  const closePenEditOutcome = useCallback(() => {
    setPenEditOutcome(null);
    PluginManager.closePluginView();
  }, []);

  const routeButton = (buttonId: number) => {
    setLaunchKey(key => key + 1);
    setFocusPenEditId(null);
    if (buttonId === BUTTON_ID_TEXTBOX_TOOLS) {
      setScreen('tools');
      return;
    }
    if (buttonId === BUTTON_ID_NOTE_MANUSCRIPT) {
      setScreen('manuscript');
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

  if (penEditOutcome) {
    return <PenEditOutcomeScreen outcome={penEditOutcome} onClose={closePenEditOutcome} />;
  }

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
    case 'manuscript':
      return <ManuscriptScreen key={launchKey} focusPenEditId={focusPenEditId} onClose={closePluginView} />;
  }
}

export default App;
