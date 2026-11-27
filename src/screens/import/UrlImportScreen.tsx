/**
 * Import from URL (technical-design-import-from-url.md §1), a sub-screen of the Manuscript card's
 * Files tab. Left: the address, the last five addresses (use, Edit, ✕) and the folder downloads
 * go to. Right: what happens on Download. After a download the card opens the Import screen on
 * the saved file; the note changes only there.
 */
import React, {useRef} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import type {Downloaded} from '../../actions/urlImport';
import {URL_IMPORT_HELP} from '../../domain/helpTexts';
import {GLYPH} from '../../ui/glyphs';
import PillButton from '../../ui/PillButton';
import ScreenFrame from '../../ui/ScreenFrame';
import {COLORS, FONT, LINE_HEIGHT, RADII, SPACING} from '../../ui/theme';
import {useUrlImport} from './useUrlImport';

interface Props {
  onBack: () => void;
  onClose: () => void;
  onDownloaded: (file: Downloaded) => void;
}

const STORAGE_ROOT = /^\/storage\/emulated\/0\//;

export default function UrlImportScreen({onBack, onClose, onDownloaded}: Props): React.JSX.Element {
  const flow = useUrlImport(onDownloaded);
  const field = useRef<TextInput>(null);
  const folderName = flow.folder.replace(STORAGE_ROOT, '') || flow.folder;

  const primary = flow.busy
    ? {label: 'Cancel', onPress: flow.cancel}
    : {label: flow.failed ? 'Try again' : 'Download', onPress: flow.download, disabled: !flow.url.trim()};

  return (
    <ScreenFrame
      title="Import from URL"
      back={{label: 'Manuscript', onPress: onBack}}
      help={{title: 'Import from URL', text: URL_IMPORT_HELP}}
      onClose={onClose}
      status={flow.status ?? {text: 'Uses the network once: one download of this address.'}}
      primary={primary}
      screenKey="url-import">
      <View style={styles.columns}>
        <View style={styles.left}>
          <Text style={[styles.label, styles.firstLabel]}>Address</Text>
          <TextInput
            ref={field}
            style={styles.field}
            value={flow.url}
            onChangeText={flow.setUrl}
            editable={!flow.busy}
            placeholder="http://192.168.1.42:8787/current.md"
            placeholderTextColor={COLORS.disabled}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={flow.download}
            accessibilityLabel="Address"
          />

          {flow.recent.length > 0 && (
            <>
              <Text style={styles.label}>Recent</Text>
              {flow.recent.map(item => (
                <View key={item} style={styles.row}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Use ${item}`}
                    disabled={flow.busy}
                    onPress={() => flow.setUrl(item)}
                    style={styles.rowText}>
                    <Text style={[styles.url, item === flow.url && styles.current]} numberOfLines={1}>
                      {item.replace(/^https?:\/\//, '')}
                    </Text>
                  </Pressable>
                  <PillButton
                    size="small"
                    label="Edit"
                    disabled={flow.busy}
                    accessibilityLabel={`Edit ${item}`}
                    onPress={() => {
                      flow.setUrl(item);
                      field.current?.focus();
                    }}
                  />
                  <PillButton
                    size="small"
                    label="✕"
                    disabled={flow.busy}
                    accessibilityLabel={`Forget ${item}`}
                    onPress={() => flow.forget(item)}
                  />
                </View>
              ))}
            </>
          )}

          <Text style={styles.label}>Save to</Text>
          <Pressable
            accessibilityRole="button"
            disabled={flow.busy}
            onPress={flow.chooseFolder}
            style={styles.folderRow}>
            <Text style={styles.folder} numberOfLines={1}>
              {folderName}
            </Text>
            <Text style={styles.change}>Change {GLYPH.next}</Text>
          </Pressable>
          <Text style={styles.hint}>A new .txt file; nothing is overwritten.</Text>
        </View>

        <View style={styles.right}>
          <Text style={[styles.label, styles.firstLabel]}>What happens</Text>
          <Text style={styles.text}>1. Download: one request for this address. The first one of a session asks for internet access.</Text>
          <Text style={styles.text}>2. Plain text or Markdown is saved as a .txt file in {folderName}.</Text>
          <Text style={styles.text}>3. Import opens on that file with its preview. Your note changes only when you tap Import there.</Text>
          <Text style={styles.hint}>Web pages and other files are refused. Up to 2 MB; the download stops after 15 s without an answer.</Text>
        </View>
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  columns: {
    flex: 1,
    flexDirection: 'row',
  },
  left: {
    flex: 3,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.base,
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
    gap: SPACING.xs,
  },
  right: {
    flex: 2,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.base,
    gap: SPACING.sm,
  },
  label: {
    fontSize: FONT.small,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: COLORS.muted,
    marginTop: SPACING.md,
  },
  firstLabel: {
    marginTop: 0,
  },
  field: {
    borderWidth: 1,
    borderColor: COLORS.text,
    borderRadius: RADII.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: FONT.medium,
    color: COLORS.text,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingVertical: SPACING.xs,
  },
  rowText: {
    flex: 1,
    paddingVertical: SPACING.xs,
  },
  url: {
    fontSize: FONT.medium,
    lineHeight: LINE_HEIGHT.medium,
    color: COLORS.text,
  },
  current: {
    fontWeight: '700',
  },
  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  folder: {
    flex: 1,
    fontSize: FONT.medium,
    fontWeight: '700',
    color: COLORS.text,
  },
  change: {
    fontSize: FONT.medium,
    color: COLORS.text,
  },
  text: {
    fontSize: FONT.medium,
    lineHeight: LINE_HEIGHT.medium,
    color: COLORS.text,
  },
  hint: {
    fontSize: FONT.small,
    lineHeight: LINE_HEIGHT.small,
    color: COLORS.muted,
  },
});
