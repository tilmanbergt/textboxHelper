/* eslint-disable no-restricted-imports -- scrolls until the calmer-screens step replaces this screen */
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
import {UI_COLORS, styles} from '../ui/pluginUiStyles';
import type {
  TextboxImportPreview,
} from '../actions/textImport';
import type {
  TextboxImportLayoutMode,
  TextboxImportParagraphSeparator,
} from '../domain/importSettings';
import type {TextboxImportSettings} from '../domain/importSettings';
import {resolveTextboxImportPath} from '../domain/importSettings';

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

type HeadingStyleKey =
  | 'heading1'
  | 'heading2'
  | 'heading3';

function formatEffectiveInsertMode(mode: 'currentPage' | 'afterCurrentPage'): string {
  return mode === 'currentPage' ? 'Current page' : 'New page after current';
}

function formatLayoutMode(mode: TextboxImportLayoutMode): string {
  return mode === 'paragraphTextboxes'
    ? 'Paragraph textboxes'
    : 'Continuous text';
}

function formatParagraphSeparator(separator: TextboxImportParagraphSeparator): string {
  return separator === 'line' ? 'Every line' : 'Blank lines';
}

function ImportHelpPanel(): React.JSX.Element {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <View style={styles.sectionCard}>
      <TouchableOpacity
        activeOpacity={0.75}
        style={styles.sectionHeaderButton}
        onPress={() => setExpanded(current => !current)}>
        <Text style={styles.sectionTitle}>Text file formatting help</Text>
        <Text style={styles.sectionToggleText}>
          {expanded ? 'Hide' : 'Show'}
        </Text>
      </TouchableOpacity>

      {expanded ? (
        <View style={styles.sectionBody}>
          <Text style={styles.helpText}>
            Use a plain UTF-8 .txt file. Windows and Unix line endings are both
            handled automatically.
          </Text>

          <View style={styles.listRow}>
            <Text style={styles.listTitle}>Paragraphs</Text>
            <Text style={styles.listDetail}>
              Choose how paragraphs are detected. “Blank lines” means paragraphs
              are separated by an empty line. “Every line” means each non-empty
              line becomes its own textbox.
            </Text>
          </View>

          <View style={styles.listRow}>
            <Text style={styles.listTitle}>Paragraph textboxes</Text>
            <Text style={styles.listDetail}>
              When enabled, each paragraph starts as a separate editable
              Supernote textbox. Several textboxes may appear on the same page.
              Very long paragraphs may continue in additional textboxes.
            </Text>
          </View>

          <View style={styles.listRow}>
            <Text style={styles.listTitle}>Headings</Text>
            <Text style={styles.listDetail}>
              Use Markdown-style headings:
              {'\n\n'}
              # Main heading
              {'\n'}
              ## Section heading
              {'\n'}
              ### Small heading
              {'\n\n'}
              Only these three levels are recognized. Leave a space after the #
              marker. The marker itself is removed during import.
            </Text>
          </View>

          <View style={styles.listRow}>
            <Text style={styles.listTitle}>Example</Text>
            <Text style={styles.listDetail}>
              # My Topic
              {'\n\n'}
              This is the first paragraph.
              {'\n'}
              This line stays in the same paragraph when “Blank lines” is used.
              {'\n\n'}
              ## A Section
              {'\n\n'}
              This becomes another paragraph textbox.
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
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

  const updateStructure = (
    nextStructure: Partial<TextboxImportSettings['structure']>,
  ) => {
    onChangeSettings({
      ...settings,
      structure: {
        ...settings.structure,
        ...nextStructure,
      },
    });
  };

  const setNumericSetting = (key: NumericSettingKey, value: string) => {
    const parsed = Number.parseInt(value, 10);

    if (!Number.isFinite(parsed) || parsed < 0) {
      return;
    }

    if (key === 'fontSize') {
      onChangeSettings({
        ...settings,
        fontSize: parsed,
        structure: {
          ...settings.structure,
          paragraph: {
            ...settings.structure.paragraph,
            fontSize: parsed,
          },
        },
      });
      return;
    }

    onChangeSettings({
      ...settings,
      [key]: parsed,
    });
  };

  const setHeadingFontSize = (
    key: HeadingStyleKey,
    value: string,
  ) => {
    const parsed = Number.parseInt(value, 10);

    if (!Number.isFinite(parsed) || parsed < 0) {
      return;
    }

    onChangeSettings({
      ...settings,
      structure: {
        ...settings.structure,
        [key]: {
          ...settings.structure[key],
          fontSize: parsed,
        },
      },
    });
  };

  const setHeadingsBold = (bold: boolean) => {
    onChangeSettings({
      ...settings,
      structure: {
        ...settings.structure,
        heading1: {
          ...settings.structure.heading1,
          bold,
        },
        heading2: {
          ...settings.structure.heading2,
          bold,
        },
        heading3: {
          ...settings.structure.heading3,
          bold,
        },
      },
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

  const renderHeadingSizeInput = (
    label: string,
    key: HeadingStyleKey,
  ) => (
    <View style={styles.importNumberField}>
      <Text style={styles.importNumberLabel}>{label}</Text>
      <TextInput
        value={String(settings.structure[key].fontSize)}
        onChangeText={value => setHeadingFontSize(key, value)}
        editable={!isBusy && settings.structure.detectMarkdownHeadings}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="numeric"
        style={styles.input}
        placeholder="0"
        placeholderTextColor={UI_COLORS.gray}
      />
    </View>
  );

  const renderChoiceButton = (params: {
    label: string;
    selected: boolean;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <TouchableOpacity
      activeOpacity={0.75}
      style={[
        styles.actionButton,
        params.selected && styles.actionButtonSelected,
        (isBusy || params.disabled) && styles.actionButtonDisabled,
      ]}
      onPress={params.onPress}
      disabled={isBusy || params.disabled}>
      <Text
        style={[
          styles.actionButtonText,
          params.selected && styles.actionButtonTextSelected,
        ]}>
        {params.label}
      </Text>
    </TouchableOpacity>
  );

  const headingsAreBold =
    settings.structure.heading1.bold &&
    settings.structure.heading2.bold &&
    settings.structure.heading3.bold;

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

        <ImportHelpPanel />

        <View style={styles.previewCard}>
          <Text style={styles.previewTitle}>Structure</Text>

          <View style={styles.sectionBody}>
            <Text style={styles.subsectionTitle}>Import layout</Text>
            <View style={styles.actionsGrid}>
              {renderChoiceButton({
                label: 'Continuous text',
                selected: settings.structure.layoutMode === 'continuous',
                onPress: () =>
                  updateStructure({
                    layoutMode: 'continuous',
                  }),
              })}

              {renderChoiceButton({
                label: 'Paragraph textboxes',
                selected: settings.structure.layoutMode === 'paragraphTextboxes',
                onPress: () =>
                  updateStructure({
                    layoutMode: 'paragraphTextboxes',
                  }),
              })}
            </View>
          </View>

          <View style={styles.sectionBody}>
            <Text style={styles.subsectionTitle}>Paragraphs are separated by</Text>
            <View style={styles.actionsGrid}>
              {renderChoiceButton({
                label: 'Blank lines',
                selected: settings.structure.paragraphSeparator === 'blankLine',
                onPress: () =>
                  updateStructure({
                    paragraphSeparator: 'blankLine',
                  }),
              })}

              {renderChoiceButton({
                label: 'Every line',
                selected: settings.structure.paragraphSeparator === 'line',
                onPress: () =>
                  updateStructure({
                    paragraphSeparator: 'line',
                  }),
              })}
            </View>
          </View>

          <View style={styles.sectionBody}>
            <Text style={styles.subsectionTitle}>Headings</Text>
            <View style={styles.actionsGrid}>
              {renderChoiceButton({
                label: 'Recognize #, ##, ###',
                selected: settings.structure.detectMarkdownHeadings,
                onPress: () =>
                  updateStructure({
                    detectMarkdownHeadings: !settings.structure.detectMarkdownHeadings,
                  }),
              })}

              {renderChoiceButton({
                label: 'Bold headings',
                selected: headingsAreBold,
                disabled: !settings.structure.detectMarkdownHeadings,
                onPress: () => setHeadingsBold(!headingsAreBold),
              })}
            </View>

            <View style={styles.importNumberRow}>
              {renderHeadingSizeInput('# size', 'heading1')}
              {renderHeadingSizeInput('## size', 'heading2')}
              {renderHeadingSizeInput('### size', 'heading3')}
            </View>
          </View>
        </View>

        <View style={styles.previewCard}>
          <Text style={styles.previewTitle}>Layout</Text>

          <View style={styles.importNumberRow}>
            {renderNumericInput('Paragraph font size', 'fontSize', styles.importNumberWide)}
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
                  `Layout mode: ${formatLayoutMode(preview.layoutMode)}`,
                  `Paragraph separation: ${formatParagraphSeparator(preview.paragraphSeparator)}`,
                  `Words: ${preview.wordCount}`,
                  `Characters: ${preview.characterCount}`,
                  `Lines: ${preview.lineCount}`,
                  `Blocks: ${preview.blockCount}`,
                  `Paragraphs: ${preview.paragraphCount}`,
                  `Headings: ${preview.headingCount} (#: ${preview.h1Count}, ##: ${preview.h2Count}, ###: ${preview.h3Count})`,
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
