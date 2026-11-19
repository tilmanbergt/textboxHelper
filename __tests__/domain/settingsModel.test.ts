import {exportRulesProblem, noteNameOf} from '../../src/domain/exportRulesCheck';
import {
  DEFAULT_PLUGIN_SETTINGS,
  parseSettings,
  serializeSettings,
} from '../../src/domain/settingsModel';

describe('parseSettings', () => {
  it('gives the defaults for no file or unreadable JSON', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_PLUGIN_SETTINGS);
    expect(parseSettings('{not json')).toEqual(DEFAULT_PLUGIN_SETTINGS);
    expect(parseSettings('[1, 2]')).toEqual(DEFAULT_PLUGIN_SETTINGS);
  });

  it('round-trips every setting', () => {
    const settings = {
      ...DEFAULT_PLUGIN_SETTINGS,
      import: {
        ...DEFAULT_PLUGIN_SETTINGS.import,
        filename: 'Obsidian/day.txt',
        marginLeft: 80,
        structure: {...DEFAULT_PLUGIN_SETTINGS.import.structure, layoutMode: 'paragraphTextboxes' as const},
      },
      export: {
        ...DEFAULT_PLUGIN_SETTINGS.export,
        scope: 'wholeNote' as const,
        includeComments: true,
        rules: {
          ...DEFAULT_PLUGIN_SETTINGS.export.rules,
          heading: {...DEFAULT_PLUGIN_SETTINGS.export.rules.heading, bold: 'yes' as const},
        },
      },
      markers: {calibration: {offsetX: -10, offsetY: 0, widthAdjustment: 24}},
    };
    expect(parseSettings(serializeSettings(settings))).toEqual(settings);
  });

  it('replaces only the invalid fields', () => {
    const parsed = parseSettings(
      JSON.stringify({
        import: {filename: 'a.txt', marginTop: 'wide', insertMode: 'somewhere', structure: {layoutMode: 'paragraphTextboxes'}},
        export: {scope: 'pageRange', rules: {meta: {minFontSize: 50, maxFontSize: 10, italic: 'maybe'}}},
        markers: {calibration: {offsetX: 15, widthAdjustment: 900}},
        future: {anything: true},
      }),
    );
    expect(parsed.import.filename).toBe('a.txt');
    expect(parsed.import.marginTop).toBe(DEFAULT_PLUGIN_SETTINGS.import.marginTop);
    expect(parsed.import.insertMode).toBe('auto');
    expect(parsed.import.structure.layoutMode).toBe('paragraphTextboxes');
    expect(parsed.import.structure.heading1).toEqual(DEFAULT_PLUGIN_SETTINGS.import.structure.heading1);
    expect(parsed.export.scope).toBe('pageRange');
    expect(parsed.export.rules.meta.minFontSize).toBe(DEFAULT_PLUGIN_SETTINGS.export.rules.meta.minFontSize);
    expect(parsed.export.rules.meta.italic).toBe('any');
    expect(parsed.markers.calibration).toEqual({offsetX: 15, offsetY: 0, widthAdjustment: 30});
    expect(parsed).not.toHaveProperty('future');
  });

  it('forgets a file from the former MyStyle import folder', () => {
    expect(parseSettings(JSON.stringify({import: {sourceFolder: 'myStyle', filename: 'a.txt'}})).import.filename).toBe('');
  });
});

describe('export rules check', () => {
  const rules = DEFAULT_PLUGIN_SETTINGS.export.rules;

  it('accepts the defaults and names a class with min above max', () => {
    expect(exportRulesProblem(rules)).toBeNull();
    expect(exportRulesProblem({...rules, comment: {...rules.comment, minFontSize: 50}})).toBe(
      'Comment: the min size is above the max size.',
    );
  });

  it('shows the note name without folder and extension', () => {
    expect(noteNameOf('/storage/emulated/0/Note/3 Resources/20261115_144717.note')).toBe('20261115_144717');
  });
});
