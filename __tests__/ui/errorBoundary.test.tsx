// A crash in a screen's body shows the error card instead of an empty screen, and goes into the
// session's errors (technical-design-release-readiness.md §4.3).
import React from 'react';
import {Text} from 'react-native';
import renderer, {act} from 'react-test-renderer';
import ErrorBoundary from '../../src/ui/ErrorBoundary';
import {sessionErrors} from '../../src/utils/errorLog';

function Broken(): React.JSX.Element {
  throw new Error('render failed');
}

describe('ErrorBoundary', () => {
  it('shows the card with Report a problem and Close, and records the crash', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const onReport = jest.fn().mockResolvedValue('Saved to EXPORT: manuscript-report-x.json');
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <ErrorBoundary onReport={onReport} onClose={() => {}}>
          <Broken />
        </ErrorBoundary>,
      );
    });
    const shown = () => tree.root.findAllByType(Text).map(t => ([] as unknown[]).concat(t.props.children).join(''));
    expect(shown()).toContain('Something went wrong on this screen.');
    expect(shown()).toEqual(expect.arrayContaining(['Report a problem', 'Close']));
    expect(sessionErrors.entries().some(e => e.module === 'screen' && e.message.includes('render failed'))).toBe(true);
    const report = tree.root.findAll(n => n.props.label === 'Report a problem')[0];
    await act(async () => {
      report.props.onPress();
    });
    expect(onReport).toHaveBeenCalled();
    expect(shown()).toContain('Saved to EXPORT: manuscript-report-x.json');
    spy.mockRestore();
  });

  it('renders its children when nothing fails', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <ErrorBoundary>
          <Text>fine</Text>
        </ErrorBoundary>,
      );
    });
    expect(tree.root.findByType(Text).props.children).toBe('fine');
  });
});
