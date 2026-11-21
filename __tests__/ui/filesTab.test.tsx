// Renders the Manuscript card's Files tab (src/screens/manuscript/files/FilesTab.tsx) for a note
// without linked files: Import a text file, Import a whole folder and Export DOCX open their
// sub-screens.
import React from 'react';
import {Text} from 'react-native';
import renderer, {act, type ReactTestInstance} from 'react-test-renderer';
import FilesTab from '../../src/screens/manuscript/files/FilesTab';
import type {LinkedFiles} from '../../src/screens/manuscript/useLinkedFiles';

function press(tree: renderer.ReactTestRenderer, label: string): void {
  const text = tree.root.findAll(node => node.type === Text && String(node.props.children).startsWith(label))[0];
  let node: ReactTestInstance | null = text;
  while (node && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  act(() => node?.props.onPress());
}

describe('Files tab', () => {
  it('offers Import and Export on a note without linked files', () => {
    const onImport = jest.fn();
    const onExport = jest.fn();
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <FilesTab source={{note: null} as unknown as LinkedFiles} disabled={false} onImport={onImport} onExport={onExport} />,
      );
    });
    expect(JSON.stringify(tree.toJSON())).toContain('No linked files.');
    press(tree, 'Import a text file');
    press(tree, 'Import a whole folder');
    press(tree, 'Export DOCX');
    expect(onImport.mock.calls).toEqual([[false], [true]]);
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});
