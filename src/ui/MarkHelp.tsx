/**
 * The edit-marker help (technical-design-mark-help.md §4): an opaque layer over the review, like
 * HelpOverlay, with fixed pages instead of paged text.
 *
 * 1. Marks at a glance: one row per mark (its shape, name, what it looks like, "+ text" when it
 *    needs tagged text, the page with its picture; a tap goes there), then the two keys.
 * 2. Each mark: the picture (marked, then after Apply), how to draw it, what to keep in mind.
 * 3. Review and apply: short blocks.
 *
 * domain/markHelpPages.ts decides what goes on which page for the measured box; the pictures are
 * bundled by scripts/gen-mark-images.mjs. A page change requests an e-ink refresh.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Image, Pressable, StyleSheet, Text, View, type LayoutChangeEvent} from 'react-native';
import {MARK_HELP, MARK_HELP_KEYS, REVIEW_HELP, type MarkHelpEntry} from '../domain/markHelp';
import {
  MARK_HELP_LAYOUT as L,
  markHelpPages,
  pageOfMark,
  type MarkHelpPage,
  type PictureSize,
} from '../domain/markHelpPages';
import {MARK_IMAGES} from './generated/markImages';
import PageHeader from './PageHeader';
import PillButton from './PillButton';
import {COLORS, FONT, SPACING} from './theme';
import {requestEinkRefresh} from '../utils/screenRefresh';

/**
 * dp per picture pixel: the pictures are drawn with 34 px text, shown at 17 dp like the body
 * text. Never wider than the box, nor than 480 dp.
 */
const PICTURE_DP_PER_PX = 0.5;
const PICTURE_MAX_WIDTH = 480;
/** The overview's icon box; icons are scaled into it. */
const ICON_BOX = {width: 150, height: 42};

const ENTRIES_BY_ID = new Map(MARK_HELP.map(entry => [entry.id, entry]));

function pictureSizes(boxWidth: number): Record<string, PictureSize> {
  const sizes: Record<string, PictureSize> = {};
  for (const entry of MARK_HELP) {
    const image = MARK_IMAGES[entry.id]?.picture;
    if (!image) {
      continue;
    }
    const width = Math.min(boxWidth, PICTURE_MAX_WIDTH, image.width * PICTURE_DP_PER_PX);
    sizes[entry.id] = {width, height: Math.round((width * image.height) / image.width)};
  }
  return sizes;
}

function iconSize(id: string): PictureSize | null {
  const icon = MARK_IMAGES[id]?.icon;
  if (!icon) {
    return null;
  }
  const scale = Math.min(PICTURE_DP_PER_PX, ICON_BOX.width / icon.width, ICON_BOX.height / icon.height);
  return {width: Math.round(icon.width * scale), height: Math.round(icon.height * scale)};
}

interface Props {
  title: string;
  onClose: () => void;
}

export default function MarkHelp({title, onClose}: Props): React.JSX.Element {
  const [box, setBox] = useState<PictureSize | null>(null);
  const [page, setPage] = useState(0);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const {width, height} = event.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setBox(prev => (prev && prev.width === width && prev.height === height ? prev : {width, height}));
    }
  }, []);

  const pages = useMemo(
    () =>
      box
        ? markHelpPages(MARK_HELP, REVIEW_HELP, [MARK_HELP_KEYS.text, MARK_HELP_KEYS.numbers], pictureSizes(box.width), box.width, box.height)
        : [],
    [box],
  );
  const current = Math.min(page, Math.max(0, pages.length - 1));

  useEffect(() => {
    requestEinkRefresh();
  }, [current, pages.length]);

  return (
    <View style={styles.layer}>
      <PageHeader
        header={title}
        accessory={<PillButton label="Close help" size="small" onPress={onClose} />}
        hiddenLabel={pages.length > 0 ? `${current + 1} / ${pages.length}` : ''}
        canPrev={current > 0}
        canNext={current < pages.length - 1}
        onPrev={() => setPage(current - 1)}
        onNext={() => setPage(current + 1)}
      />
      <View style={styles.box} onLayout={onLayout}>
        {pages[current] && <HelpPage page={pages[current]} pages={pages} onJump={setPage} />}
      </View>
    </View>
  );
}

function HelpPage({
  page,
  pages,
  onJump,
}: {
  page: MarkHelpPage;
  pages: MarkHelpPage[];
  onJump: (page: number) => void;
}): React.JSX.Element {
  if (page.kind === 'overview') {
    return (
      <View>
        <Text style={styles.heading}>{page.first ? 'Marks at a glance' : 'Marks at a glance (continued)'}</Text>
        {page.ids.map(id => {
          const entry = ENTRIES_BY_ID.get(id);
          return entry ? (
            <OverviewRow key={id} entry={entry} page={pageOfMark(pages, id)} onJump={onJump} />
          ) : null;
        })}
        <View style={styles.keys}>
          <View style={styles.keyRow}>
            <TextBadge />
            <Text style={styles.keyText}>{MARK_HELP_KEYS.text}</Text>
          </View>
          <View style={styles.keyRow}>
            <View style={styles.numberBadge}>
              <Text style={styles.numberBadgeText}>1</Text>
            </View>
            <Text style={styles.keyText}>{MARK_HELP_KEYS.numbers}</Text>
          </View>
        </View>
      </View>
    );
  }
  if (page.kind === 'marks') {
    return (
      <View>
        <Text style={styles.heading}>Each mark</Text>
        {page.entries.map((placed, index) => {
          const entry = ENTRIES_BY_ID.get(placed.id);
          const image = MARK_IMAGES[placed.id]?.picture;
          return entry ? (
            <View key={placed.id} style={[styles.entry, index > 0 && styles.separated]}>
              <View style={styles.nameRow}>
                <Text style={styles.name}>{entry.name}</Text>
                {entry.needsText && <TextBadge />}
              </View>
              {image && (
                <Image
                  source={{uri: image.uri}}
                  style={{width: placed.picture.width, height: placed.picture.height}}
                  resizeMode="contain"
                  accessibilityLabel={`${entry.name}: the marked text, then the text after Apply`}
                />
              )}
              <Text style={styles.body}>
                <Text style={styles.bold}>Draw: </Text>
                {entry.draw}
              </Text>
              <View>
                <Text style={[styles.body, styles.bold]}>Keep in mind:</Text>
                {entry.keep.map(point => (
                  <View key={point} style={styles.bulletRow}>
                    <Text style={styles.bullet}>•</Text>
                    <Text style={[styles.body, styles.bulletText]}>{point}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null;
        })}
      </View>
    );
  }
  return (
    <View>
      <Text style={styles.heading}>Review and apply</Text>
      {page.blocks.map((block, index) => (
        <View key={block.title} style={index > 0 && styles.blockGap}>
          <Text style={styles.name}>{block.title}</Text>
          <Text style={styles.body}>{block.text}</Text>
        </View>
      ))}
    </View>
  );
}

function OverviewRow({
  entry,
  page,
  onJump,
}: {
  entry: MarkHelpEntry;
  page: number;
  onJump: (page: number) => void;
}): React.JSX.Element {
  const icon = MARK_IMAGES[entry.id]?.icon;
  const size = iconSize(entry.id);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${entry.name}: ${entry.glance}. Show on page ${page + 1}`}
      onPress={() => page >= 0 && onJump(page)}
      style={styles.row}>
      <View style={styles.iconBox}>
        {icon && size && <Image source={{uri: icon.uri}} style={size} resizeMode="contain" />}
      </View>
      <View style={styles.rowText}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{entry.name}</Text>
          {entry.needsText && <TextBadge />}
        </View>
        <Text style={styles.glance} numberOfLines={1}>
          {entry.glance}
        </Text>
      </View>
      {page >= 0 && <Text style={styles.glance}>p. {page + 1} ›</Text>}
    </Pressable>
  );
}

function TextBadge(): React.JSX.Element {
  return (
    <View style={styles.textBadge}>
      <Text style={styles.textBadgeText}>+ text</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.background,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.base,
  },
  box: {
    flex: 1,
    overflow: 'hidden',
  },
  heading: {
    fontSize: FONT.medium,
    fontWeight: '700',
    color: COLORS.text,
    height: L.headingHeight,
    lineHeight: L.titleHeight,
  },
  row: {
    height: L.rowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  iconBox: {
    width: ICON_BOX.width,
    height: ICON_BOX.height,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    height: L.titleHeight,
  },
  name: {
    fontSize: FONT.medium,
    lineHeight: L.titleHeight,
    fontWeight: '700',
    color: COLORS.text,
  },
  glance: {
    fontSize: L.fontSize,
    lineHeight: L.lineHeight,
    color: COLORS.muted,
  },
  keys: {
    paddingTop: L.gap,
    gap: L.gap,
  },
  keyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.md,
  },
  keyText: {
    flex: 1,
    fontSize: L.fontSize,
    lineHeight: L.lineHeight,
    color: COLORS.text,
  },
  textBadge: {
    borderWidth: 1.5,
    borderColor: COLORS.text,
    borderRadius: 4,
    paddingHorizontal: 6,
  },
  textBadgeText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  numberBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: COLORS.disabled,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 12,
  },
  numberBadgeText: {
    fontSize: 13,
    color: COLORS.disabled,
  },
  entry: {
    gap: L.gap,
  },
  separated: {
    marginTop: L.sectionGap / 2,
    paddingTop: L.sectionGap / 2,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  body: {
    fontSize: L.fontSize,
    lineHeight: L.lineHeight,
    color: COLORS.text,
  },
  bold: {
    fontWeight: '700',
  },
  bulletRow: {
    flexDirection: 'row',
  },
  bullet: {
    width: L.bulletIndent,
    fontSize: L.fontSize,
    lineHeight: L.lineHeight,
    color: COLORS.text,
  },
  bulletText: {
    flex: 1,
  },
  blockGap: {
    marginTop: L.sectionGap,
  },
});
