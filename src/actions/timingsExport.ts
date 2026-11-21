import pluginConfig from '../../PluginConfig.json';
import {countEvents, summarizePerf} from '../domain/perfLog';
import {writeJsonExportFile} from '../storage/exportFile';
import {jsContextAgeMs, perfLog, recordingStartedAt} from '../utils/perf';
import {cacheState} from './manuscriptCache';

/**
 * "Save timings" in the Manuscript card's Settings → Diagnostics (technical-design-manuscript-cache.md §6): the
 * timings recorded since the last clear as one JSON file in EXPORT, with a summary per stage and
 * what the cache holds, so it can be handed over as a file.
 */
export async function saveTimings(): Promise<string> {
  const entries = perfLog.entries();
  if (entries.length === 0) {
    throw new Error('No timings recorded yet.');
  }
  const createdAt = new Date().toISOString();
  const fileName = `textboxhelper-timings-${createdAt.replace(/[:.]/g, '-')}.json`;
  return writeJsonExportFile(fileName, {
    kind: 'textboxhelper-timings',
    version: 1,
    plugin: pluginConfig.versionName,
    createdAt,
    recordingSince: new Date(recordingStartedAt()).toISOString(),
    // How long the plugin's JS has been running: whether the cache can survive between openings.
    jsContextAgeMs: jsContextAgeMs(),
    cache: cacheState(),
    events: countEvents(entries),
    summary: summarizePerf(entries),
    entryCount: entries.length,
    droppedCount: perfLog.droppedCount(),
    entries,
  });
}
