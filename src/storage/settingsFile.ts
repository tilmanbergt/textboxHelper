/**
 * The settings file `<plugin folder>/settings.json` (technical-design-calmer-screens.md §3.9).
 *
 * `loadSettings()` reads it once per plugin process; every later read is `getSettings()`.
 * `updateSettings()` changes the settings in memory at once and writes the file 1 s after the
 * last change, so stepping a value several times writes once. A missing or unreadable file gives
 * the defaults; a failed write is logged and the settings stay in memory for this session.
 */
import RNFS from 'react-native-fs';
import {PluginManager} from 'sn-plugin-lib';
import {buildSettingsPath} from '../domain/backupPaths';
import {
  DEFAULT_PLUGIN_SETTINGS,
  parseSettings,
  serializeSettings,
  type PluginSettings,
} from '../domain/settingsModel';

const WRITE_DELAY_MS = 1000;

let current: PluginSettings = DEFAULT_PLUGIN_SETTINGS;
let loading: Promise<PluginSettings> | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

async function settingsPath(): Promise<string | null> {
  const pluginDir = await PluginManager.getPluginDirPath();
  return pluginDir ? buildSettingsPath(pluginDir) : null;
}

export function loadSettings(): Promise<PluginSettings> {
  if (!loading) {
    loading = (async () => {
      try {
        const path = await settingsPath();
        const json = path && (await RNFS.exists(path)) ? await RNFS.readFile(path, 'utf8') : null;
        current = parseSettings(json);
      } catch (error) {
        console.warn('[Settings] could not read the settings file; using defaults', String(error));
        current = parseSettings(null);
      }
      return current;
    })();
  }
  return loading;
}

export function getSettings(): PluginSettings {
  return current;
}

export function updateSettings(update: (settings: PluginSettings) => PluginSettings): PluginSettings {
  current = update(current);
  if (writeTimer) {
    clearTimeout(writeTimer);
  }
  const snapshot = current;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void writeSettings(snapshot);
  }, WRITE_DELAY_MS);
  return current;
}

async function writeSettings(settings: PluginSettings): Promise<void> {
  try {
    const path = await settingsPath();
    if (!path) {
      throw new Error('no plugin folder');
    }
    await RNFS.writeFile(path, serializeSettings(settings), 'utf8');
  } catch (error) {
    console.warn('[Settings] could not save the settings file', String(error));
  }
}
