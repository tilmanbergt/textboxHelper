// Renders the edit-marker help (src/ui/MarkHelp.tsx) for an A5 X sized box: the overview first,
// a tap on a row jumps to the mark's page, ‹ › page through.
import React from 'react';
import {Image, Text, View} from 'react-native';
import renderer, {act, type ReactTestInstance} from 'react-test-renderer';
import MarkHelp from '../../src/ui/MarkHelp';
import {MARK_HELP} from '../../src/domain/markHelp';

jest.mock('../../src/utils/screenRefresh', () => ({requestEinkRefresh: jest.fn()}));

function texts(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).map(node => {
    const children = ([] as unknown[]).concat(node.props.children);
    return children.filter(child => typeof child === 'string' || typeof child === 'number').join('');
  });
}

function measured(width: number, height: number, props: Partial<React.ComponentProps<typeof MarkHelp>> = {}) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<MarkHelp title="Help" onClose={() => {}} {...props} />);
  });
  const box = tree.root.findAll(node => node.type === View && typeof node.props.onLayout === 'function')[0];
  act(() => {
    box.props.onLayout({nativeEvent: {layout: {x: 0, y: 0, width, height}}});
  });
  return tree;
}

function toOverview(tree: renderer.ReactTestRenderer) {
  for (let i = 0; i < 5 && !texts(tree.root).includes('Marks at a glance'); i++) {
    const next = tree.root.findByProps({accessibilityLabel: 'Next page'});
    act(() => next.props.onPress());
  }
}

describe('MarkHelp', () => {
  it('opens on Getting started with the core marks and the version line', () => {
    const tree = measured(654, 760);
    const shown = texts(tree.root);
    expect(shown).toContain('Getting started');
    expect(shown).toContain('What Manuscript does');
    expect(shown.some(t => t.startsWith('Manuscript '))).toBe(true);
    expect(tree.root.findAll(n => n.props.label === 'Put cheat sheet on this page')).toHaveLength(0);
  });

  it('on the first start: the "shown once" line and the cheat sheet button', () => {
    const onCheatSheet = jest.fn();
    const tree = measured(654, 760, {firstStart: true, onCheatSheet});
    for (let i = 0; i < 3 && tree.root.findAll(n => n.props.label === 'Put cheat sheet on this page').length === 0; i++) {
      act(() => tree.root.findByProps({accessibilityLabel: 'Next page'}).props.onPress());
    }
    expect(texts(tree.root)).toContain('This is shown once. It’s always under ? › Getting started.');
    const button = tree.root.findAll(n => n.props.label === 'Put cheat sheet on this page')[0];
    act(() => button.props.onPress());
    expect(onCheatSheet).toHaveBeenCalled();
  });

  it('shows all marks at a glance with their icons, then pages on', () => {
    const tree = measured(654, 760);
    toOverview(tree);
    const shown = texts(tree.root);
    expect(shown).toContain('Marks at a glance');
    for (const entry of MARK_HELP) {
      expect(shown).toContain(entry.name);
    }
    expect(tree.root.findAllByType(Image).length).toBeGreaterThanOrEqual(MARK_HELP.length);
    const next = tree.root.findByProps({accessibilityLabel: 'Next page'});
    act(() => next.props.onPress());
    expect(texts(tree.root)).toContain('Each mark');
  });

  it('a row jumps to the page with the mark', () => {
    const tree = measured(654, 760);
    toOverview(tree);
    const swap = MARK_HELP.find(entry => entry.id === 'swap')!;
    const row = tree.root.find(node => typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.startsWith(`${swap.name}:`) && typeof node.props.onPress === 'function');
    act(() => row.props.onPress());
    const shown = texts(tree.root);
    expect(shown).toContain('Each mark');
    expect(shown).toContain(swap.name);
    expect(shown).toContain(swap.draw);
  });
});
