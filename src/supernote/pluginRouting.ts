import {DeviceEventEmitter} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';

/**
 * The light bridge from Supernote button events into the React Native app. The button ids live
 * in `src/domain/buttonIds.ts`.
 */

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
