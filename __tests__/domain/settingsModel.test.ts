import {exportRulesProblem, noteNameOf} from '../../src/domain/exportRulesCheck';
import {
  DEFAULT_PLUGIN_SETTINGS,
  parseSettings,
  serializeSettings,
} from '../../src/domain/settingsModel';

describe('parseSettings', () => {
  it('onboarding: not seen by default and in older files, seen only when true', () => {
    expect(parseSettings(null).onboarding).toEqual({seen: false});
    expect(parseSettings('{"version":1}').onboarding).toEqual({seen: false});
    expect(parseSettings('{"onboarding":{"seen":"yes"}}').onboarding).toEqual({seen: false});
    expect(parseSettings('{"onboarding":{"seen":true}}').onboarding).toEqual({seen: true});
  });

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
        filePath: '/storage/emulated/0/Document/day.txt',
        linkToFile: false,
        structure: {...DEFAULT_PLUGIN_SETTINGS.import.structure, layoutMode: 'paragraphTextboxes' as const},
      },
      layout: {margins: {left: 80, top: 90, right: 300, bottom: 600}, breakBefore: [1 as const], blockGap: 24},
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

  it('reads the Outline\'s heading settings field by field', () => {
    const settings = parseSettings(
      JSON.stringify({outline: {defaultHeadingLevel: 2, titleLevels: [3, 1, 7], titleStyles: {1: 4, 2: 9}}}),
    );
    expect(settings.outline).toEqual({defaultHeadingLevel: 2, titleLevels: [1, 3], titleStyles: {1: 4, 2: 3, 3: 2}});
    expect(parseSettings(null).outline).toEqual({defaultHeadingLevel: 1, titleLevels: [1, 2], titleStyles: {1: 1, 2: 3, 3: 2}});
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
    expect(parsed.import.filePath).toBe('/storage/emulated/0/INBOX/a.txt');
    expect(parsed.layout).toEqual(DEFAULT_PLUGIN_SETTINGS.layout);
    expect(parsed.import.insertMode).toBe('auto');
    expect(parsed.import.structure.layoutMode).toBe('paragraphTextboxes');
    expect(parsed.import.structure.heading1).toEqual(DEFAULT_PLUGIN_SETTINGS.import.structure.heading1);
    expect(parsed.export.scope).toBe('pageRange');
    expect(parsed.export.rules.meta.minFontSize).toBe(DEFAULT_PLUGIN_SETTINGS.export.rules.meta.minFontSize);
    expect(parsed.export.rules.meta.italic).toBe('any');
    expect(parsed.markers.calibration).toEqual({offsetX: 15, offsetY: 0, widthAdjustment: 30});
    expect(parsed).not.toHaveProperty('future');
  });

  it('reads the page layout field by field and ignores the import\'s old margins', () => {
    const parsed = parseSettings(
      JSON.stringify({
        import: {marginLeft: 5, marginBottom: 7},
        layout: {margins: {left: 60, bottom: 'deep'}, breakBefore: [2, 5]},
      }),
    );
    expect(parsed.layout).toEqual({margins: {left: 60, top: 100, right: 280, bottom: 625}, breakBefore: [2], blockGap: 18});
    expect(parsed.import).not.toHaveProperty('marginLeft');
  });

  it('forgets a file from the former MyStyle import folder', () => {
    expect(parseSettings(JSON.stringify({import: {sourceFolder: 'myStyle', filename: 'a.txt'}})).import.filePath).toBe('');
  });

  it('prefers the absolute path over an older INBOX-relative one', () => {
    const parsed = parseSettings(JSON.stringify({import: {filePath: '/a/b.txt', filename: 'c.txt'}}));
    expect(parsed.import.filePath).toBe('/a/b.txt');
    expect(parsed.import.linkToFile).toBe(true);
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
