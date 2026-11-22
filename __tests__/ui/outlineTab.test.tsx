// Renders the Outline tab (src/screens/manuscript/outline/OutlineTab.tsx) with a fake outline: the
// Contents and the open entry's paragraphs, the panel for a heading and a paragraph, Move to, a
// level change of a heading with subheadings, and a note without headings.
import React from 'react';
import {Text} from 'react-native';
import renderer, {act, type ReactTestInstance} from 'react-test-renderer';
import {buildOutline} from '../../src/domain/outlineModel';
import {plannedOrder, type PlannedChange} from '../../src/domain/outlinePlan';
import type {ScannedTextBox} from '../../src/domain/exportClassification';
import OutlineTab from '../../src/screens/manuscript/outline/OutlineTab';
import type {Outline} from '../../src/screens/manuscript/outline/useOutline';

jest.mock('../../src/utils/screenRefresh', () => ({requestEinkRefresh: jest.fn()}));

const item = (numInPage: number, text: string, extra: Partial<ScannedTextBox> = {}): ScannedTextBox => ({
  page: 0,
  numInPage,
  userData: null,
  text,
  role: 'paragraph',
  styleSignature: '',
  fontSize: 36,
  bold: false,
  italic: false,
  border: false,
  rect: {left: 100, top: numInPage * 100, right: 900, bottom: numInPage * 100 + 80},
  ...extra,
});

function fakeOutline(lines: string[], plan: PlannedChange[] = []): Outline {
  const blocks = buildOutline(
    lines.map((text, index) => item(index, text)),
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
    plan,
    planned: plan.length > 0 ? plannedOrder(blocks, plan) : null,
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

/** Gives every self-measuring box a height, as the device's layout would. */
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

const ESSAY = ['Intro.', '# Paper', 'Keyboard is fast.', 'A pen is slow.', '## Fluency', 'Cost.', '# Pen', 'Memory.'];

describe('Outline tab', () => {
  it('shows the contents and the open entry\'s own paragraphs, the heading in the panel', () => {
    const tree = render(fakeOutline(ESSAY));
    const shown = texts(tree.root);
    expect(shown).toContain('Contents');
    expect(shown).toContain('Paper');
    expect(shown).toContain('Fluency');
    // The first entry with edits, else the first: Start.
    expect(shown).toContain('Intro.');
    act(() => tree.root.findByProps({accessibilityLabel: 'Heading level 1 Paper'}).props.onPress());
    measure(tree);
    const paper = texts(tree.root);
    expect(paper).toContain('Keyboard is fast.');
    expect(paper).not.toContain('Cost.');
    expect(paper).toContain('Then: ## Fluency (1 ¶)');
    expect(paper).toContain('Set aside section');
  });

  it('asks how subheadings change when a heading with subheadings gets a new level', () => {
    const outline = fakeOutline(ESSAY);
    const tree = render(outline);
    act(() => tree.root.findByProps({accessibilityLabel: 'Heading level 1 Paper'}).props.onPress());
    act(() => tree.root.findByProps({accessibilityLabel: 'Heading level 2'}).props.onPress());
    expect(texts(tree.root)).toContain('With its subheadings');
    act(() => tree.root.findByProps({accessibilityLabel: 'With its subheadings'}).props.onPress());
    expect(outline.setLevel).toHaveBeenCalledWith(outline.blocks?.[1].key, 2, true);
  });

  it('moves a paragraph to another heading from the Contents', () => {
    const outline = fakeOutline(ESSAY);
    const key = outline.blocks?.[2].key as string;
    const tree = render({...outline, selectedKey: key});
    act(() => tree.root.findByProps({accessibilityLabel: 'Heading level 1 Paper'}).props.onPress());
    measure(tree);
    act(() => tree.root.findByProps({accessibilityLabel: 'Paragraph: Keyboard is fast.'}).props.onPress());
    act(() => tree.root.findByProps({accessibilityLabel: '→ Move to…'}).props.onPress());
    measure(tree);
    expect(texts(tree.root)).toContain('here');
    act(() => tree.root.findByProps({accessibilityLabel: 'Move to Pen'}).props.onPress());
    expect(outline.move).toHaveBeenCalledWith(key, 'end');
  });

  it('shows a note without headings in one pane', () => {
    const tree = render(fakeOutline(['One.', 'Two.']));
    const shown = texts(tree.root);
    expect(shown).not.toContain('Contents');
    expect(shown).toContain('2 paragraphs · no headings');
    expect(shown).toContain('Two.');
  });

  it('names planned changes and marks them in the Contents', () => {
    const outline = fakeOutline(ESSAY);
    const plan: PlannedChange[] = [{kind: 'level', key: outline.blocks?.[6].key as string, level: 2, withSubheadings: false}];
    const tree = render(fakeOutline(ESSAY, plan));
    const shown = texts(tree.root);
    expect(shown).toContain('Contents · as planned');
    expect(shown).toContain('1 heading level');
    expect(shown).toContain('was #');
  });
});
