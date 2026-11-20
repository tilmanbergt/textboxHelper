/**
 * Long styled text in a fixed box, paged by whole lines instead of scrolling
 * (technical-design-calmer-screens.md §3.2).
 *
 * 1. A hidden copy (absolute, transparent, same width, font and line height as the visible text)
 *    renders all segments and reports its laid-out lines through `onTextLayout`.
 * 2. domain/textPages.ts turns the lines into pages: as many whole lines as fit the measured box.
 * 3. The visible text renders only the current page's segments.
 *
 * If the host never reports lines (`onTextLayout` missing or empty), the whole text is shown and
 * clipped by the box, and that is logged once - the fallback named in the design.
 *
 * `jumpTo`: a change of its `key` shows the page holding character `index`. `resetKey`: a change
 * goes back to the first page. A page change requests an e-ink refresh.
 */
import React, {useEffect, useMemo, useState} from 'react';
import {
  StyleSheet,
  Text,
  View,
  type NativeSyntheticEvent,
  type TextLayoutEventData,
} from 'react-native';
import {
  lineRanges,
  pageIndexForChar,
  pageRanges,
  segmentsText,
  sliceSegments,
  type MeasuredLine,
  type TextSegment,
} from '../domain/textPages';
import {renderSegments} from './Segments';
import PageHeader from './PageHeader';
import {useMeasuredHeight} from './useMeasuredHeight';
import {COLORS, FONT, LINE_HEIGHT} from './theme';
import {requestEinkRefresh} from '../utils/screenRefresh';

interface Props {
  segments: TextSegment[];
  /** Header line above the box; omit for a box without a header (arrows then don't show). */
  header?: React.ReactNode;
  headerAccessory?: React.ReactNode;
  jumpTo?: {key: string | number; index: number} | null;
  resetKey?: string | number;
}

let reportedMissingLines = false;

export default function PagedText({
  segments,
  header,
  headerAccessory,
  jumpTo,
  resetKey,
}: Props): React.JSX.Element {
  const text = useMemo(() => segmentsText(segments), [segments]);
  const [onLayout, boxHeight] = useMeasuredHeight();
  const [measured, setMeasured] = useState<{text: string; lines: MeasuredLine[]} | null>(null);
  const [page, setPage] = useState(0);

  const lines = useMemo(
    () => (measured && measured.text === text ? lineRanges(measured.lines, text.length) : null),
    [measured, text],
  );
  const pages = useMemo(
    () => (lines && boxHeight ? pageRanges(lines, boxHeight) : []),
    [lines, boxHeight],
  );
  const currentPage = Math.min(page, Math.max(0, pages.length - 1));

  useEffect(() => {
    setPage(0);
  }, [resetKey, text]);

  useEffect(() => {
    if (jumpTo && pages.length > 0) {
      setPage(pageIndexForChar(pages, jumpTo.index));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new key (or new pages) jumps
  }, [jumpTo?.key, pages]);

  useEffect(() => {
    requestEinkRefresh();
  }, [currentPage, pages.length]);

  const onTextLayout = (event: NativeSyntheticEvent<TextLayoutEventData>) => {
    const reported = event.nativeEvent.lines ?? [];
    if (reported.length === 0 && text.length > 0 && !reportedMissingLines) {
      reportedMissingLines = true;
      console.warn('[PagedText] onTextLayout reported no lines; showing clipped text');
    }
    setMeasured({
      text,
      lines: reported.map(line => ({text: line.text, height: line.height})),
    });
  };

  const usable = pages.length > 0;
  const shown = usable ? sliceSegments(segments, pages[currentPage].start, pages[currentPage].end) : segments;
  const linesHidden = usable && lines ? lines.length - pages[currentPage].lineCount : 0;

  return (
    <View style={styles.root}>
      {header !== undefined && (
        <PageHeader
          header={header}
          accessory={headerAccessory}
          hiddenLabel={`+${linesHidden} lines`}
          canPrev={usable && currentPage > 0}
          canNext={usable && currentPage < pages.length - 1}
          onPrev={() => setPage(currentPage - 1)}
          onNext={() => setPage(currentPage + 1)}
        />
      )}
      <View style={styles.box} onLayout={onLayout}>
        <Text style={[styles.text, styles.measure]} onTextLayout={onTextLayout} aria-hidden>
          {renderSegments(segments)}
        </Text>
        <Text style={styles.text}>{renderSegments(shown)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  box: {
    flex: 1,
    overflow: 'hidden',
  },
  text: {
    fontSize: FONT.medium,
    lineHeight: LINE_HEIGHT.medium,
    color: COLORS.text,
  },
  measure: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    opacity: 0,
  },
});
