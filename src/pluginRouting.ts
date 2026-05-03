import {DeviceEventEmitter} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';

/**
 * Central registry for plugin button ids and the light bridge from Supernote button
 * events into the React Native app.
 *
 * Keeping ids and listener wiring here makes it much easier to review toolbar-related
 * changes without searching through the UI code.
 */

export const BUTTON_ID_TEXTBOX_TOOLS = 6200;
export const BUTTON_ID_TOOLBAR_SPLIT_TEXTBOX = 6230;
export const BUTTON_ID_TOOLBAR_JOIN_TEXTBOXES = 6240;
export const BUTTON_ID_TOOLBAR_CLEAN_TEXTBOX_SPACES = 6250;
export const BUTTON_ID_TOOLBAR_REMOVE_LINE_BREAKS = 6260;
export const BUTTON_ID_TOOLBAR_APPLY_EDIT_MARKERS = 6270;
export const BUTTON_ID_NOTE_APPLY_ALL_EDIT_MARKERS = 6280;
export const PLUGIN_BUTTON_EVENT = 'pluginButton';

let pendingButtonId: number | null = null;
let isRoutingInitialized = false;

export function initPluginRouting(): void {
  if (isRoutingInitialized) {
    return;
  }

  isRoutingInitialized = true;

  PluginManager.registerButtonListener({
    onButtonPress(event) {
      pendingButtonId = event.id;
      DeviceEventEmitter.emit(PLUGIN_BUTTON_EVENT, {id: event.id});
    },
  });
}

export function checkPendingButton(): number | null {
  const buttonId = pendingButtonId;
  pendingButtonId = null;
  return buttonId;
}
