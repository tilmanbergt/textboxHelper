/**
 * The product is called Manuscript (technical-design-release-readiness.md §3). The old name may
 * only stay where it names the lasso panel "Textbox Tools" (split, join, clean up), and the old
 * folder and file names TextboxHelper / textboxhelper never come back in the source.
 */
import {readdirSync, readFileSync, statSync} from 'fs';
import {join, relative} from 'path';

const ROOT = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (name === 'generated') {return [];}
    if (statSync(path).isDirectory()) {return sourceFiles(path);}
    return /\.(ts|tsx|js)$/.test(name) ? [path] : [];
  });
}

const FILES = [...sourceFiles(join(ROOT, 'src')), join(ROOT, 'App.tsx'), join(ROOT, 'index.js')];
const rel = (path: string) => relative(ROOT, path).split('\\').join('/');

// Where "Textbox Tools" names the lasso panel, which keeps its name.
const LASSO_PANEL = new Set([
  'index.js',
  'src/domain/buttonIds.ts',
  'src/screens/tools/TextboxToolsScreen.tsx',
  'src/screens/tools/ToolsDetailsScreen.tsx',
  'src/screens/manuscript/outline/OutlineTab.tsx',
]);

describe('product name', () => {
  it('no source file uses the old folder or file name TextboxHelper / textboxhelper', () => {
    const hits = FILES.filter(f => /TextboxHelper|textboxhelper|textbox-tools/.test(readFileSync(f, 'utf8'))).map(rel);
    expect(hits).toEqual([]);
  });

  it('"Textbox Tools" appears only where it names the lasso panel', () => {
    const hits = FILES.filter(f => !LASSO_PANEL.has(rel(f)) && readFileSync(f, 'utf8').includes('Textbox Tools')).map(rel);
    expect(hits).toEqual([]);
  });

  it('the plugin is called Manuscript; its identity stays', () => {
    const config = JSON.parse(readFileSync(join(ROOT, 'PluginConfig.json'), 'utf8'));
    expect(config.name).toBe('Manuscript');
    expect(config.pluginID).toBe('wkx45auazdre2crs');
    expect(config.pluginKey).toBe('textboxHelper');
  });
});
