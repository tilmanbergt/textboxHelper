import {PluginCommAPI, type Element} from 'sn-plugin-lib';

/**
 * Releases elements from the SDK's element cache by uuid (`PluginCommAPI.recycleElement`), for
 * elements the plugin created or read and no longer needs. A failed recycle only keeps a cached
 * element a little longer, so it is silent. Elements read with the file API are released with
 * `recycleElements` in `noteElements.ts` (`element.recycle()`).
 */
export function recycleByUuid(elements: Element[]): void {
  for (const element of elements) {
    try {
      PluginCommAPI.recycleElement(element.uuid);
    } catch {
      // silent: see above
    }
  }
}
