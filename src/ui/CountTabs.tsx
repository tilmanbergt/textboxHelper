/**
 * Tabs with an optional count after the label ("Changes 4", "Ignored 1"), after Kept GTD's
 * MiniTabs: a row of labels, the active one bold with a black underline. A tab with
 * `hideWhenZero` and a count of 0 is left out. `trailing` sits right-aligned in the same strip.
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {COLORS, FONT, SPACING} from './theme';

export interface CountTab<K extends string> {
  key: K;
  label: string;
  count?: number;
  hideWhenZero?: boolean;
}

interface Props<K extends string> {
  tabs: CountTab<K>[];
  activeKey: K;
  onChange: (key: K) => void;
  trailing?: React.ReactNode;
}

export default function CountTabs<K extends string>({
  tabs,
  activeKey,
  onChange,
  trailing,
}: Props<K>): React.JSX.Element {
  const visible = tabs.filter(tab => !(tab.hideWhenZero && (tab.count ?? 0) === 0));
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {visible.map(tab => {
        const active = tab.key === activeKey;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{selected: active}}
            onPress={() => onChange(tab.key)}
            style={[styles.tab, active && styles.tabActive]}>
            <Text style={[styles.text, active && styles.textActive]}>
              {tab.count === undefined ? tab.label : `${tab.label} ${tab.count}`}
            </Text>
          </Pressable>
        );
      })}
      {trailing != null && <View style={styles.trailing}>{trailing}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    marginBottom: SPACING.sm,
  },
  tab: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.xs,
    marginRight: SPACING.lg,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: COLORS.accent,
  },
  text: {
    fontSize: FONT.medium,
    color: COLORS.text,
  },
  textActive: {
    fontWeight: '700',
  },
  trailing: {
    marginLeft: 'auto',
    alignSelf: 'center',
  },
});
