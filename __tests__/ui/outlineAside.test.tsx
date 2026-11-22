// Renders the Outline tab's Set aside view (technical-design-aside-area.md §5): its explanation while
// nothing is set aside, the aside area with the user's own headings, and Move back into the text.
import React from 'react';
import {Text} from 'react-native';
import renderer, {act, type ReactTestInstance} from 'react-test-renderer';
import {formatBlockTag} from '../../src/domain/blockTag';
import type {ScannedTextBox} from '../../src/domain/exportClassification';
import {buildOutline} from '../../src/domain/outlineModel';
import OutlineTab from '../../src/screens/manuscript/outline/OutlineTab';
import type {Outline} from '../../src/screens/manuscript/outline/useOutline';

jest.mock('../../src/utils/screenRefresh', () => ({requestEinkRefresh: jest.fn()}));

const DIVIDER = formatBlockTag({v: 1, id: 'b-aside', k: 'a'});

const item = (numInPage: number, text: string, userData: string | null = null): ScannedTextBox => ({
  page: 0,
  numInPage,
  userData,
  text,
  role: 'paragraph',
  styleSignature: '',
  fontSize: 36,
  bold: false,
  italic: false,
  border: false,
  rect: {left: 100, top: numInPage * 100, right: 900, bottom: numInPage * 100 + 80},
});

function fakeOutline(lines: Array<string | [string, string]>): Outline {
  const blocks = buildOutline(
    lines.map((line, index) => (typeof line === 'string' ? item(index, line) : item(index, line[0], line[1]))),
    {},
    {0: {state: 'read', preview: {operations: []}} as never},
  );
  return {
    blocks,
    loading: false,
    busy: false,
    status: null,
    selectedKey: null,
    select: jest.fn(),
    load: jest.fn(),
    clear: jest.fn(),
    setStatus: jest.fn(),
    plan: [],
    planned: null,
    check: null,
    checking: false,
    move: jest.fn(),
    setLevel: jest.fn(),
    setAside: jest.fn(),
    remove: jest.fn(),
    cleanUp: jest.fn(),
    undo: jest.fn(),
    undoLastChange: jest.fn(),
    apply: jest.fn(),
    applied: false,
  };
}

function texts(root: ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map(node => ([] as unknown[]).concat(node.props.children).filter(child => typeof child === 'string' || typeof child === 'number').join(''))
    .join('|');
}

function measure(tree: renderer.ReactTestRenderer) {
  for (const box of tree.root.findAll(node => typeof node.props.onLayout === 'function')) {
    act(() => box.props.onLayout({nativeEvent: {layout: {x: 0, y: 0, width: 600, height: 600}}}));
  }
}

function render(outline: Outline) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<OutlineTab outline={outline} disabled={false} onReviewPage={jest.fn()} onGoToPage={jest.fn()} />);
  });
  measure(tree);
  return tree;
}

function showSetAside(tree: renderer.ReactTestRenderer) {
  const choice = tree.root.findAll(node => node.props.accessibilityRole === 'radio' && node.props.accessibilityLabel === 'Set aside');
  act(() => choice[0].props.onPress());
  measure(tree);
}

const ESSAY = ['# Paper', 'Keyboard is fast.', '# Pen', 'Memory.'];

describe('Outline: Set aside', () => {
  it('explains the aside area while nothing is set aside', () => {
    const tree = render(fakeOutline(ESSAY));
    showSetAside(tree);
    const shown = texts(tree.root);
    expect(shown).toContain('Nothing set aside yet.');
    expect(shown).not.toContain('Keyboard is fast.');
  });

  it('shows only the aside area, with the headings typed there, and keeps it out of All', () => {
    const tree = render(fakeOutline([...ESSAY, ['Set aside', DIVIDER], 'Parked.', '# Comments for Anna', 'Ask Anna.']));
    expect(texts(tree.root)).not.toContain('Comments for Anna');
    showSetAside(tree);
    const shown = texts(tree.root);
    expect(shown).toContain('Set aside · in no file');
    expect(shown).toContain('Comments for Anna');
    expect(shown).toContain('Parked.');
    expect(shown).not.toContain('Paper');
  });

  it('moves a paragraph back into the text by choosing a heading there, then shows it there', () => {
    const outline = fakeOutline([...ESSAY, ['Set aside', DIVIDER], 'Parked.', '# Notes', 'More.']);
    const parked = outline.blocks?.[5].key as string;
    const tree = render({...outline, selectedKey: parked});
    showSetAside(tree);
    act(() => tree.root.findByProps({accessibilityLabel: 'Paragraph: Parked.'}).props.onPress());
    expect(texts(tree.root)).not.toContain('Set aside section');
    act(() => tree.root.findByProps({accessibilityLabel: '↩ Move back ›'}).props.onPress());
    measure(tree);
    expect(texts(tree.root)).toContain('Move back: ');
    act(() => tree.root.findByProps({accessibilityLabel: 'Move to Paper'}).props.onPress());
    // Into "# Paper", before "# Pen".
    expect(outline.move).toHaveBeenCalledWith(parked, outline.blocks?.[2].key);
    measure(tree);
    const shown = texts(tree.root);
    expect(shown).toContain('Contents');
    expect(shown).toContain('Keyboard is fast.');
  });
});
