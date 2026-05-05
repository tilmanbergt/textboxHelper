import React from 'react';
import {
  Keyboard,
  ScrollView,
  StatusBar,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {UI_COLORS, styles} from './pluginUiStyles';
import type {
  TextboxImportPreview,
  TextboxImportSettings,
} from '../textboxImportActions';
import {resolveTextboxImportPath} from '../textboxImportActions';

type ImportTextFileViewProps = {
  settings: TextboxImportSettings;
  preview: TextboxImportPreview | null;
  isBusy: boolean;
  status: string;
  onChangeSettings: (settings: TextboxImportSettings) => void;
  onPreview: () => void;
  onImport: () => void;
  onClose: () => void;
};

type NumericSettingKey =
  | 'fontSize'
  | 'marginLeft'
  | 'marginTop'
  | 'marginRight'
  | 'marginBottom';



function formatEffectiveInsertMode(mode: 'currentPage' | 'afterCurrentPage'): string {
  return mode === 'currentPage' ? 'Current page' : 'New page after current';
}

export function ImportTextFileView({
  settings,
  preview,
  isBusy,
  status,
  onChangeSettings,
  onPreview,
  onImport,
  onClose,
}: ImportTextFileViewProps): React.JSX.Element {
  let sourcePath = '';

  try {
    sourcePath = resolveTextboxImportPath(settings);
  } catch (error) {
    sourcePath = String(error);
  }



  const setNumericSetting = (key: NumericSettingKey, value: string) => {
    const parsed = Number.parseInt(value, 10);

    if (!Number.isFinite(parsed) || parsed < 0) {
      return;
    }

    onChangeSettings({
      ...settings,
      [key]: parsed,
    });
  };



  const renderNumericInput = (
    label: string,
    key: NumericSettingKey,
    widthStyle?: object,
  ) => (
    <View style={[styles.importNumberField, widthStyle]}>
      <Text style={styles.importNumberLabel}>{label}</Text>
      <TextInput
        value={String(settings[key])}
        onChangeText={value => setNumericSetting(key, value)}
        editable={!isBusy}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="numeric"
        style={styles.input}
        placeholder="0"
        placeholderTextColor={UI_COLORS.gray}
      />
    </View>
  );

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={UI_COLORS.white} />

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>Import</Text>
            <Text style={styles.title}>Import Text File</Text>
            <Text style={styles.summaryText}>
              Read a plain text file and insert it into this note as fitted textboxes.
            </Text>
          </View>

          <TouchableOpacity
            activeOpacity={0.75}
            style={styles.closeButton}
            onPress={() => {
              Keyboard.dismiss();
              onClose();
            }}
            disabled={isBusy}>
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </View>

      <View style={styles.importCompactCard}>
        <Text style={styles.previewTitle}>Source file</Text>

        <TextInput
          value={settings.filename}
          onChangeText={filename =>
            onChangeSettings({
              ...settings,
              filename,
            })
          }
          editable={!isBusy}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          placeholder="import.txt"
          placeholderTextColor={UI_COLORS.gray}
        />

        <Text style={styles.backupText}>{sourcePath}</Text>
      </View>



        <View style={styles.previewCard}>
          <Text style={styles.previewTitle}>Layout</Text>

          <View style={styles.importNumberRow}>
            {renderNumericInput('Font size', 'fontSize', styles.importNumberWide)}
          </View>

          <View style={styles.importNumberRow}>
            {renderNumericInput('Left', 'marginLeft')}
            {renderNumericInput('Top', 'marginTop')}
            {renderNumericInput('Right', 'marginRight')}
            {renderNumericInput('Bottom', 'marginBottom')}
          </View>
        </View>

        <View style={styles.actionsGrid}>
          <TouchableOpacity
            activeOpacity={0.75}
            style={[styles.actionButton, isBusy && styles.actionButtonDisabled]}
            onPress={() => {
              Keyboard.dismiss();
              onPreview();
            }}
            disabled={isBusy}>
            <Text style={styles.actionButtonText}>Preview</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.75}
            style={[styles.executeButton, isBusy && styles.executeButtonDisabled]}
            onPress={() => {
              Keyboard.dismiss();
              onImport();
            }}
            disabled={isBusy}>
            <Text style={styles.executeButtonText}>
              {isBusy ? 'Importing...' : 'Import'}
            </Text>
          </TouchableOpacity>
        </View>

        {preview ? (
          <View style={styles.previewRow}>
            <View style={styles.previewCard}>
              <Text style={styles.previewTitle}>File summary</Text>
              <Text style={styles.previewText}>
                {[
                  `Path: ${preview.sourcePath}`,
                  `Words: ${preview.wordCount}`,
                  `Characters: ${preview.characterCount}`,
                  `Lines: ${preview.lineCount}`,
                  `Paragraphs: ${preview.paragraphCount}`,
                  `Expected textboxes: ${preview.expectedTextboxCount}`,
                  `New pages to create: ${preview.expectedCreatedPageCount}`,
                   `Start: ${formatEffectiveInsertMode(preview.effectiveInsertMode)}`,
                     preview.currentPageHasImportAreaContent
                       ? 'Reason: current import area contains content'
                       : 'Reason: current import area appears empty',
                ].join('\n')}
              </Text>
            </View>

            <View style={styles.previewCard}>
              <Text style={styles.previewTitle}>Start of file</Text>
              <Text style={styles.previewText}>{preview.startPreview}</Text>
            </View>

            <View style={styles.previewCard}>
              <Text style={styles.previewTitle}>End of file</Text>
              <Text style={styles.previewText}>{preview.endPreview}</Text>
            </View>
          </View>
        ) : null}

        {status ? <Text style={styles.statusText}>{status}</Text> : null}
      </ScrollView>
    </View>
  );
}