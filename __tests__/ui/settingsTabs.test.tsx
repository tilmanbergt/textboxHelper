// Renders the Layout and Export tabs of the Manuscript card's Settings
// (src/screens/manuscript/settings/): a page-break switch and a margin are kept in the settings,
// Reset to defaults puts the layout back, and an invalid export rule is named and not saved.
import React from 'react';
import {Text, TextInput} from 'react-native';
import renderer, {act, type ReactTestInstance} from 'react-test-renderer';
import {DEFAULT_PLUGIN_SETTINGS, type PluginSettings} from '../../src/domain/settingsModel';
import ExportSettings from '../../src/screens/manuscript/settings/ExportSettings';
import LayoutSettings from '../../src/screens/manuscript/settings/LayoutSettings';

let mockStored: PluginSettings = DEFAULT_PLUGIN_SETTINGS;
jest.mock('../../src/storage/settingsFile', () => ({
  getSettings: () => mockStored,
  updateSettings: (update: (settings: PluginSettings) => PluginSettings) => {
    mockStored = update(mockStored);
    return mockStored;
  },
}));

function pressText(tree: renderer.ReactTestRenderer, label: string): void {
  const text = tree.root.findAll(node => node.type === Text && node.props.children === label)[0];
  let node: ReactTestInstance | null = text;
  while (node && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  act(() => node?.props.onPress());
}

function typeInto(tree: renderer.ReactTestRenderer, label: string, value: string): void {
  const input = tree.root.find(node => node.type === TextInput && node.props.accessibilityLabel === label);
  act(() => input.props.onChangeText(value));
}

beforeEach(() => {
  mockStored = DEFAULT_PLUGIN_SETTINGS;
});

describe('Settings → Layout', () => {
  it('keeps a page break, a margin and a font size, and resets them', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<LayoutSettings />);
    });
    pressText(tree, '##');
    typeInto(tree, 'Bottom', '500');
    typeInto(tree, '# size', '60');
    expect(mockStored.layout.breakBefore).toEqual([2]);
    expect(mockStored.layout.margins.bottom).toBe(500);
    expect(mockStored.import.structure.heading1.fontSize).toBe(60);
    pressText(tree, 'Reset to defaults');
    expect(mockStored.layout).toEqual(DEFAULT_PLUGIN_SETTINGS.layout);
    expect(mockStored.import.structure).toEqual(DEFAULT_PLUGIN_SETTINGS.import.structure);
  });
});

describe('Settings → Export', () => {
  it('saves valid rules and names an invalid one', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<ExportSettings />);
    });
    const inputs = tree.root.findAll(node => node.type === TextInput && node.props.accessibilityLabel === 'Min size');
    act(() => inputs[3].props.onChangeText('999'));
    expect(mockStored.export.rules).toEqual(DEFAULT_PLUGIN_SETTINGS.export.rules);
    expect(JSON.stringify(tree.toJSON())).toContain('The last valid rules are still used.');
    act(() => inputs[3].props.onChangeText('0'));
    act(() => inputs[1].props.onChangeText('20'));
    expect(mockStored.export.rules.paragraph.minFontSize).toBe(20);
  });
});
