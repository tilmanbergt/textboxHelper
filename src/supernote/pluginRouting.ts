import {DeviceEventEmitter} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';

/**
 * The light bridge from Supernote button events into the React Native app. The button ids live
 * in `src/domain/buttonIds.ts`.
 */

export const PLUGIN_BUTTON_EVENT = 'pluginButton';

let pendingButtonId: number | null = null;
let isRoutingInitialized = false;

/**
 * `backgroundButtons`: buttons registered with `showType: 0` that run without a plugin screen
 * (the pen-edit tags); they never reach App, which may not be mounted at all.
 */
export function initPluginRouting(backgroundButtons: Record<number, () => void> = {}): void {
  if (isRoutingInitialized) {
    return;
  }

  isRoutingInitialized = true;

  PluginManager.registerButtonListener({
    onButtonPress(event) {
      const background = backgroundButtons[event.id];
      if (background) {
        background();
        return;
      }
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
