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

function measured(width: number, height: number) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<MarkHelp title="Edit markers" onClose={() => {}} />);
  });
  const box = tree.root.findAll(node => node.type === View && typeof node.props.onLayout === 'function')[0];
  act(() => {
    box.props.onLayout({nativeEvent: {layout: {x: 0, y: 0, width, height}}});
  });
  return tree;
}

describe('MarkHelp', () => {
  it('shows all marks at a glance with their icons, then pages on', () => {
    const tree = measured(654, 760);
    const shown = texts(tree.root);
    expect(shown).toContain('Marks at a glance');
    for (const entry of MARK_HELP) {
      expect(shown).toContain(entry.name);
    }
    expect(tree.root.findAllByType(Image)).toHaveLength(MARK_HELP.length);
    const next = tree.root.findByProps({accessibilityLabel: 'Next page'});
    act(() => next.props.onPress());
    expect(texts(tree.root)).toContain('Each mark');
  });

  it('a row jumps to the page with the mark', () => {
    const tree = measured(654, 760);
    const swap = MARK_HELP.find(entry => entry.id === 'swap')!;
    const row = tree.root.find(node => typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.startsWith(`${swap.name}:`) && typeof node.props.onPress === 'function');
    act(() => row.props.onPress());
    const shown = texts(tree.root);
    expect(shown).toContain('Each mark');
    expect(shown).toContain(swap.name);
    expect(shown).toContain(swap.draw);
  });
});
