/**
 * Explicit e-ink refresh for the plugin's own view (taken from Kept GTD's utils/screenRefresh.ts).
 *
 * A state change without a touch right before it (a preview that finished loading, a page turned
 * by code) can commit without the e-ink panel being told to redraw: the React tree is right, but
 * the screen keeps the old pixels until some system UI forces a refresh. `invalidatePluginView()`
 * asks the host to redraw. Calls are debounced so a burst (several boxes finishing together)
 * gives one refresh, and the call waits two animation frames so the native views are drawn
 * before the refresh captures them.
 */
import {NativePluginManager} from 'sn-plugin-lib';

const DEBOUNCE_MS = 150;
let pending: ReturnType<typeof setTimeout> | null = null;

export function requestEinkRefresh(): void {
  if (pending) {
    clearTimeout(pending);
  }
  pending = setTimeout(() => {
    pending = null;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          NativePluginManager.invalidatePluginView();
        } catch (error) {
          console.warn('[ScreenRefresh] invalidatePluginView failed', String(error));
        }
      });
    });
  }, DEBOUNCE_MS);
}
