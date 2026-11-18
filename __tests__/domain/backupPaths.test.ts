import {
  buildBackupDir,
  buildBackupPath,
  buildBrokenPenEditIndexPath,
  buildPenEditEntryDir,
  buildPenEditIndexPath,
} from '../../src/domain/backupPaths';

const PLUGIN_DIR = '/data/user/0/com.ratta.supernote.pluginhost/files/plugins/wkx45auazdre2crs';

describe('backup paths', () => {
  it('puts the backup folder inside the plugin folder, joined with "/"', () => {
    expect(buildBackupDir(PLUGIN_DIR)).toBe(`${PLUGIN_DIR}/textbox-action-backups`);
  });

  it('builds a backup file path without any backslash', () => {
    const path = buildBackupPath(PLUGIN_DIR, 'splitParagraphs', '2026-11-15T13:50:47.091Z');
    expect(path).toBe(
      `${PLUGIN_DIR}/textbox-action-backups/splitParagraphs-2026-11-15T13-50-47-091Z.json`,
    );
    expect(path).not.toContain('\\');
    expect(path.startsWith(`${PLUGIN_DIR}/`)).toBe(true);
  });

  it('does not double the separator when the plugin folder ends with "/"', () => {
    expect(buildBackupDir(`${PLUGIN_DIR}/`)).toBe(`${PLUGIN_DIR}/textbox-action-backups`);
  });
});

describe('pen edit paths', () => {
  it('lives in the plugin folder, joined with "/"', () => {
    expect(buildPenEditIndexPath('/data/plugin/')).toBe('/data/plugin/pen-edits/index.json');
    expect(buildPenEditEntryDir('/data/plugin', 'pe-1')).toBe('/data/plugin/pen-edits/pe-1');
    expect(buildBrokenPenEditIndexPath('/p', '2026-11-18T13:55:01.000Z')).toBe(
      '/p/pen-edits/index.broken-2026-11-18T13-55-01-000Z.json',
    );
  });
});
