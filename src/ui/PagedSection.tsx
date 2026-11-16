/**
 * A paged list in a fixed box (after Kept GTD's ui/PagedSection.tsx): header line with "+N" and
 * ‹ › (ui/PageHeader.tsx) above a box that holds as many rows as their `rowHeight` allows
 * (ui/pagination.ts). The box's height never depends on the number of rows: no rows, one row and a
 * full page all render in the same box, and `emptyHint` fills it rather than shrinking it.
 *
 * Without `viewportHeight` the component measures itself: its root and its box are `flex: 1`, so
 * flexbox decides how much room is left. That needs a bounded flex column around it (every screen
 * body of ui/ScreenFrame.tsx is one). A page change requests an e-ink refresh.
 */
import React, {useEffect} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {type JumpTo, usePagedByHeight} from './pagination';
import PageHeader from './PageHeader';
import {useMeasuredHeight} from './useMeasuredHeight';
import {COLORS, FONT} from './theme';
import {requestEinkRefresh} from '../utils/screenRefresh';

/** A self-measured box this small means a sibling above it takes the room meant for the list. */
const SUSPICIOUSLY_SMALL_VIEWPORT = 50;

interface Props<T> {
  header: React.ReactNode;
  headerAccessory?: React.ReactNode;
  rows: T[];
  rowHeight: (row: T) => number;
  viewportHeight?: number;
  resetKey?: string | number;
  jumpTo?: JumpTo | null;
  renderRow: (row: T) => React.ReactNode;
  /** Which rows count toward "+N" (group headers in a flattened list don't). Default: all. */
  isCountableRow?: (row: T) => boolean;
  /** Shown in the box when there are no rows. */
  emptyHint?: string;
  /** Replaces the rows inside the same box (loading text, an error), keeping the header. */
  viewportContent?: React.ReactNode;
}

export default function PagedSection<T>({
  header,
  headerAccessory,
  rows,
  rowHeight,
  viewportHeight,
  resetKey,
  jumpTo,
  renderRow,
  isCountableRow,
  emptyHint,
  viewportContent,
}: Props<T>): React.JSX.Element {
  const selfMeasuring = viewportHeight == null;
  const [onLayout, measuredHeight] = useMeasuredHeight();
  const effectiveHeight = viewportHeight ?? measuredHeight ?? 0;

  useEffect(() => {
    if (selfMeasuring && measuredHeight != null && measuredHeight < SUSPICIOUSLY_SMALL_VIEWPORT) {
      console.warn('[PagedSection] suspiciously small viewport - check for a flex-greedy sibling', {
        header: typeof header === 'string' ? header : '(node)',
        measuredHeight,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new measurement is logged
  }, [selfMeasuring, measuredHeight]);

  // A jump waits for a height: the target's page depends on it.
  const paged = usePagedByHeight(rows, rowHeight, effectiveHeight, resetKey, effectiveHeight > 0 ? jumpTo : null);

  useEffect(() => {
    requestEinkRefresh();
  }, [paged.page]);

  const total = isCountableRow ? rows.filter(isCountableRow).length : rows.length;
  const visible = isCountableRow ? paged.pageItems.filter(isCountableRow).length : paged.pageItems.length;

  return (
    <View style={selfMeasuring ? styles.flex : undefined}>
      <PageHeader
        header={header}
        accessory={headerAccessory}
        hiddenLabel={`+${total - visible}`}
        canPrev={paged.canPrev}
        canNext={paged.canNext}
        onPrev={paged.goPrev}
        onNext={paged.goNext}
      />
      <View
        style={[styles.viewport, selfMeasuring ? styles.flex : {height: viewportHeight}]}
        onLayout={selfMeasuring ? onLayout : undefined}>
        {viewportContent !== undefined ? (
          viewportContent
        ) : rows.length === 0 && emptyHint ? (
          <Text style={styles.hint}>{emptyHint}</Text>
        ) : (
          paged.pageItems.map(renderRow)
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  viewport: {
    overflow: 'hidden',
  },
  hint: {
    fontSize: FONT.medium,
    color: COLORS.muted,
  },
});
