/**
 * Catches a crash of a screen's body (technical-design-release-readiness.md §4.3), so the plugin
 * shows what happened instead of an empty card: "Something went wrong on this screen", Report a
 * problem and Close. The crash goes into the session's errors. No retry.
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import PillButton from './PillButton';
import {COLORS, FONT, SPACING} from './theme';
import {recordCrash} from '../utils/errorLog';

interface Props {
  /** Writes the report; resolves to the line shown under the buttons. */
  onReport?: () => Promise<string>;
  onClose?: () => void;
  children: React.ReactNode;
}

interface State {
  failed: boolean;
  reportLine: string | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = {failed: false, reportLine: null};

  static getDerivedStateFromError(): Partial<State> {
    return {failed: true};
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    recordCrash(error, info.componentStack);
    console.error('[Screen] crashed', String(error));
  }

  private report = (): void => {
    const {onReport} = this.props;
    if (!onReport) {
      return;
    }
    onReport()
      .then(line => this.setState({reportLine: line}))
      .catch(error => this.setState({reportLine: `The report could not be written: ${String(error)}`}));
  };

  render(): React.ReactNode {
    if (!this.state.failed) {
      return this.props.children;
    }
    const {onReport, onClose} = this.props;
    return (
      <View style={styles.box}>
        <Text style={styles.title}>Something went wrong on this screen.</Text>
        <Text style={styles.text}>
          Your notes are not changed by this. Report a problem saves a file to EXPORT that helps to find the cause.
        </Text>
        <View style={styles.row}>
          {onReport ? <PillButton label="Report a problem" onPress={this.report} /> : null}
          {onClose ? <PillButton label="Close" onPress={onClose} /> : null}
        </View>
        {this.state.reportLine ? <Text style={styles.text}>{this.state.reportLine}</Text> : null}
      </View>
    );
  }
}

const styles = StyleSheet.create({
  box: {
    flex: 1,
    padding: SPACING.xl,
    gap: SPACING.base,
  },
  title: {
    fontSize: FONT.large,
    fontWeight: '700',
    color: COLORS.text,
  },
  text: {
    fontSize: FONT.medium,
    color: COLORS.text,
  },
  row: {
    flexDirection: 'row',
    gap: SPACING.base,
  },
});
