// The light controls of the Outline (technical-design-outline-sections.md §3.1): text choices and
// the action bar with its ⋯ row.
import React from 'react';
import {Text} from 'react-native';
import renderer, {act, type ReactTestInstance} from 'react-test-renderer';
import ActionBar from '../../src/ui/ActionBar';
import TextChoices from '../../src/ui/TextChoices';

function texts(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).map(node => {
    const children = ([] as unknown[]).concat(node.props.children);
    return children.filter(child => typeof child === 'string' || typeof child === 'number').join('');
  });
}

describe('TextChoices', () => {
  it('marks the chosen option and reports another one', () => {
    const onChange = jest.fn();
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <TextChoices caption="Show" choices={[{key: 'all', label: 'All'}, {key: 'edits', label: 'With edits'}]} value="all" onChange={onChange} />,
      );
    });
    expect(texts(tree.root)).toEqual(['Show', 'All', '·', 'With edits']);
    const chosen = tree.root.findByProps({accessibilityLabel: 'All'});
    expect(chosen.props.accessibilityState).toMatchObject({selected: true});
    act(() => chosen.props.onPress());
    expect(onChange).not.toHaveBeenCalled();
    act(() => tree.root.findByProps({accessibilityLabel: 'With edits'}).props.onPress());
    expect(onChange).toHaveBeenCalledWith('edits');
  });
});

describe('ActionBar', () => {
  it('shows the rare actions behind ⋯ in the same row, with Cancel', () => {
    const remove = jest.fn();
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <ActionBar
          items={[{key: 'up', label: '↑ Up', onPress: jest.fn(), disabled: true}, 'separator', 'spacer']}
          more={[{key: 'delete', label: 'Delete', onPress: remove}]}
        />,
      );
    });
    expect(texts(tree.root)).toEqual(['↑ Up', '⋯']);
    expect(tree.root.findByProps({accessibilityLabel: '↑ Up'}).props.accessibilityState).toMatchObject({disabled: true});
    act(() => tree.root.findByProps({accessibilityLabel: 'More: Delete'}).props.onPress());
    expect(texts(tree.root)).toEqual(['Delete', 'Cancel']);
    act(() => tree.root.findByProps({accessibilityLabel: 'Delete'}).props.onPress());
    expect(remove).toHaveBeenCalled();
    expect(texts(tree.root)).toEqual(['↑ Up', '⋯']);
  });
});
