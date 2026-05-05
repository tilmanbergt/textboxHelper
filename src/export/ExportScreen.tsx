import React, {useEffect, useMemo, useState} from 'react';
import {
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  createEditableConfig,
  DEFAULT_EXPORT_CLASSIFICATION_CONFIG,
  parseEditableConfig,
  type EditableExportClassificationConfig,
  type EditableRoleRuleConfig,
  type StyleRequirement,
} from './exportConfig';
import {
  exportScannedDocx,
  MAX_EXPORT_ITEM_COUNT,
} from './exportScannedDocx';
import {
  getIncludedScanItems,
  getIncludedRoleCounts,
  scanTextBoxes,
  summarizeExcludedStyles,
  type ExportScope,
  type ScanSummary,
} from './scanTextBoxes';

type RefreshContext = () => Promise<{
  filePath: string;
  page: number | null;
  totalPages?: number | null;
}>;

type ExportScreenProps = {
  pageInfo: string;
  currentPage: number | null;
  onClose: () => void;
  refreshNoteContext: RefreshContext;
};

type ExportView = 'main' | 'config';

const UI_FONT_SIZES = {
  title: 24,
  body: 16,
  meta: 13,
} as const;

const UI_COLORS = {
  black: '#000000',
  white: '#ffffff',
  gray: '#7a7a7a',
  lightGray: '#d0d0d0',
} as const;

const STYLE_REQUIREMENT_OPTIONS: StyleRequirement[] = ['any', 'yes', 'no'];

function serializeLogPayload(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function logExportUi(message: string, payload?: unknown): void {
  if (payload === undefined) {
    console.log(`[DocxExportUI] ${message}`);
    return;
  }

  console.log(`[DocxExportUI] ${message}`, serializeLogPayload(payload));
}

function parseOptionalPositiveInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

function formatPages(pages: number[]): string {
  if (pages.length === 0) {
    return 'No pages';
  }

  if (pages.length === 1) {
    return `Page ${pages[0] + 1}`;
  }

  return `Pages ${pages[0] + 1}-${pages[pages.length - 1] + 1}`;
}

function ScopeButton(props: {
  label: string;
  isSelected: boolean;
  onPress: () => void;
}) {
  const {label, isSelected, onPress} = props;

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      style={[styles.scopeButton, isSelected && styles.scopeButtonSelected]}
      onPress={onPress}>
      <Text
        style={[
          styles.scopeButtonText,
          isSelected && styles.scopeButtonTextSelected,
        ]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function CheckboxRow(props: {
  label: string;
  checked: boolean;
  onPress: () => void;
  hint?: string;
}) {
  const {label, checked, onPress, hint} = props;

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      style={styles.checkboxRow}
      onPress={onPress}>
      <View style={[styles.checkboxBox, checked && styles.checkboxBoxChecked]}>
        <Text style={[styles.checkboxMark, checked && styles.checkboxMarkChecked]}>
          {checked ? 'X' : ''}
        </Text>
      </View>
      <View style={styles.checkboxCopy}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

function RequirementButton(props: {
  label: string;
  isSelected: boolean;
  onPress: () => void;
}) {
  const {label, isSelected, onPress} = props;

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      style={[
        styles.requirementButton,
        isSelected && styles.requirementButtonSelected,
      ]}
      onPress={onPress}>
      <Text
        style={[
          styles.requirementButtonText,
          isSelected && styles.requirementButtonTextSelected,
        ]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function RequirementSelector(props: {
  label: string;
  value: StyleRequirement;
  onChange: (value: StyleRequirement) => void;
}) {
  const {label, value, onChange} = props;

  return (
    <View style={styles.requirementGroup}>
      <Text style={styles.requirementLabel}>{label}</Text>
      <View style={styles.requirementRow}>
        {STYLE_REQUIREMENT_OPTIONS.map(option => (
          <RequirementButton
            key={option}
            label={option}
            isSelected={value === option}
            onPress={() => onChange(option)}
          />
        ))}
      </View>
    </View>
  );
}

function RuleCard(props: {
  title: string;
  rule: EditableRoleRuleConfig;
  onChange: (nextRule: EditableRoleRuleConfig) => void;
}) {
  const {title, rule, onChange} = props;

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{title}</Text>

      <View style={styles.rangeRow}>
        <View style={styles.rangeField}>
          <Text style={styles.label}>Min size</Text>
          <TextInput
            value={rule.minFontSize}
            onChangeText={value =>
              onChange({
                ...rule,
                minFontSize: value,
              })
            }
            keyboardType="number-pad"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            placeholder="0"
            placeholderTextColor={UI_COLORS.gray}
          />
        </View>
        <View style={styles.rangeField}>
          <Text style={styles.label}>Max size</Text>
          <TextInput
            value={rule.maxFontSize}
            onChangeText={value =>
              onChange({
                ...rule,
                maxFontSize: value,
              })
            }
            keyboardType="number-pad"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            placeholder="0"
            placeholderTextColor={UI_COLORS.gray}
          />
        </View>
      </View>

      <RequirementSelector
        label="Bold"
        value={rule.bold}
        onChange={value =>
          onChange({
            ...rule,
            bold: value,
          })
        }
      />
      <RequirementSelector
        label="Italic"
        value={rule.italic}
        onChange={value =>
          onChange({
            ...rule,
            italic: value,
          })
        }
      />
      <RequirementSelector
        label="Border"
        value={rule.border}
        onChange={value =>
          onChange({
            ...rule,
            border: value,
          })
        }
      />
    </View>
  );
}

export default function ExportScreen(props: ExportScreenProps): React.JSX.Element {
  const {pageInfo, currentPage, onClose, refreshNoteContext} = props;

  const [view, setView] = useState<ExportView>('main');
  const [scope, setScope] = useState<ExportScope>('currentPage');
  const [includeComments, setIncludeComments] = useState(false);
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [config, setConfig] = useState<EditableExportClassificationConfig>(() =>
    createEditableConfig(DEFAULT_EXPORT_CLASSIFICATION_CONFIG),
  );
  const [isScanning, setIsScanning] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [status, setStatus] = useState(
    'Choose a scope, scan text boxes, then export the included content.',
  );
  const [scanSummary, setScanSummary] = useState<ScanSummary | null>(null);

  useEffect(() => {
    if (currentPage !== null) {
      const oneBased = String(currentPage + 1);
      setRangeStart(existing => existing || oneBased);
      setRangeEnd(existing => existing || oneBased);
    }
  }, [currentPage]);

  const updateStatus = (message: string, extra?: unknown) => {
    setStatus(message);
    logExportUi('status', {message, extra});
  };

  const parsedConfig = useMemo(() => {
    try {
      return parseEditableConfig(config);
    } catch {
      return null;
    }
  }, [config]);

  const includedCounts = useMemo(() => {
    if (!scanSummary) {
      return null;
    }

    return getIncludedRoleCounts(scanSummary, includeComments);
  }, [includeComments, scanSummary]);

  const excludedStyles = useMemo(() => {
    if (!scanSummary) {
      return [];
    }

    return summarizeExcludedStyles(scanSummary, includeComments);
  }, [includeComments, scanSummary]);

  const includedItemCount = useMemo(() => {
    if (!scanSummary) {
      return 0;
    }

    return getIncludedScanItems(scanSummary, includeComments).length;
  }, [includeComments, scanSummary]);

  const handleScan = async () => {
    setIsScanning(true);
    updateStatus('Scanning note text boxes...');

    try {
      const nextConfig = parseEditableConfig(config);
        const {filePath, page, totalPages} = await refreshNoteContext();      if (!filePath) {
        throw new Error('Could not determine the current note path.');
      }

     const nextScan = await scanTextBoxes({
       notePath: filePath,
       currentPage: page,
       totalPages: totalPages ?? null,
       scope,
       config: nextConfig,
       pageRangeStart: parseOptionalPositiveInteger(rangeStart),
       pageRangeEnd: parseOptionalPositiveInteger(rangeEnd),
     });

      setScanSummary(nextScan);
      updateStatus(
        `Scan complete. Found ${nextScan.items.length} text boxes across ${formatPages(nextScan.scannedPages)}. ${getIncludedScanItems(nextScan, includeComments).length} are currently eligible for export.`,
        {
          pages: nextScan.scannedPages,
          totalItems: nextScan.items.length,
          includedItems: getIncludedScanItems(nextScan, includeComments).length,
          counts: nextScan.counts,
        },
      );
      setView('main');
    } catch (error) {
      setScanSummary(null);
      updateStatus(`Scan failed: ${String(error)}`, {
        error: String(error),
      });
    } finally {
      setIsScanning(false);
    }
  };

  const handleExport = async () => {
    if (!scanSummary) {
      updateStatus('Run a scan before exporting.');
      return;
    }

    setIsExporting(true);
    updateStatus('Exporting DOCX to the Supernote EXPORT folder...');

    try {
      const result = await exportScannedDocx({
        scan: scanSummary,
        includeComments,
        onProgress: message => {
          updateStatus(message);
        },
      });

      updateStatus(
        `Exported ${result.exportedItemCount} text boxes to ${result.exportPath} (base64 length ${result.base64Length}).`,
        {
          exportedItemCount: result.exportedItemCount,
          exportPath: result.exportPath,
          base64Length: result.base64Length,
        },
      );
    } catch (error) {
      updateStatus(`Export failed: ${String(error)}`, {
        error: String(error),
      });
    } finally {
      setIsExporting(false);
    }
  };

  if (view === 'config') {
    return (
      <View style={styles.screen}>
        <StatusBar barStyle="dark-content" backgroundColor={UI_COLORS.white} />
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled">
          <View style={styles.headerRow}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>Docx Export</Text>
              <Text style={styles.title}>Classification Config</Text>
              <Text style={styles.subtitle}>
                Define what counts as heading, paragraph, comment, and meta.
                These rules apply to the next scan.
              </Text>
            </View>
            <TouchableOpacity
              activeOpacity={0.75}
              style={styles.closeButton}
              onPress={() => setView('main')}>
              <Text style={styles.closeButtonText}>Back</Text>
            </TouchableOpacity>
          </View>

          <CheckboxRow
            label="Treat text boxes inside Supernote title areas as headings"
            checked={config.treatTitleTextBoxesAsHeadings}
            onPress={() =>
              setConfig(current => ({
                ...current,
                treatTitleTextBoxesAsHeadings:
                  !current.treatTitleTextBoxesAsHeadings,
              }))
            }
            hint="This uses title-area overlap as an extra heading signal."
          />

          <RuleCard
            title="Heading"
            rule={config.heading}
            onChange={nextRule =>
              setConfig(current => ({
                ...current,
                heading: nextRule,
              }))
            }
          />
          <RuleCard
            title="Paragraph"
            rule={config.paragraph}
            onChange={nextRule =>
              setConfig(current => ({
                ...current,
                paragraph: nextRule,
              }))
            }
          />
          <RuleCard
            title="Comment"
            rule={config.comment}
            onChange={nextRule =>
              setConfig(current => ({
                ...current,
                comment: nextRule,
              }))
            }
          />
          <RuleCard
            title="Meta"
            rule={config.meta}
            onChange={nextRule =>
              setConfig(current => ({
                ...current,
                meta: nextRule,
              }))
            }
          />

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Defaults</Text>
            <Text style={styles.contextText}>
              The defaults match the current style guide: heading 40 bold,
              paragraph 32 regular, comment 32 italic, meta 24.
            </Text>
            <TouchableOpacity
              activeOpacity={0.75}
              style={[styles.button, styles.secondaryButton]}
              onPress={() =>
                setConfig(createEditableConfig(DEFAULT_EXPORT_CLASSIFICATION_CONFIG))
              }>
              <Text style={styles.secondaryButtonText}>Reset defaults</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Config status</Text>
            <Text style={styles.statusText}>
              {parsedConfig
                ? 'Configuration is valid and ready for scanning.'
                : 'Configuration is incomplete. Check your size ranges.'}
            </Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={UI_COLORS.white} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled">
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>Docx Export</Text>
            <Text style={styles.title}>Scan and Export</Text>
            <Text style={styles.subtitle}>
              Scan note text boxes using configurable rules, review what gets
              included, then export the selected content to DOCX.
            </Text>
          </View>
          <TouchableOpacity
            activeOpacity={0.75}
            style={styles.closeButton}
            onPress={onClose}>
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Current note</Text>
          <Text style={styles.contextText}>{pageInfo}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Scope</Text>
          <View style={styles.scopeRow}>
            <ScopeButton
              label="Current page"
              isSelected={scope === 'currentPage'}
              onPress={() => setScope('currentPage')}
            />
            <ScopeButton
              label="Whole note"
              isSelected={scope === 'wholeNote'}
              onPress={() => setScope('wholeNote')}
            />
            <ScopeButton
              label="Page range"
              isSelected={scope === 'pageRange'}
              onPress={() => setScope('pageRange')}
            />
          </View>

          {scope === 'pageRange' ? (
            <>
              <View style={styles.rangeRow}>
                <View style={styles.rangeField}>
                  <Text style={styles.label}>Start page</Text>
                  <TextInput
                    value={rangeStart}
                    onChangeText={setRangeStart}
                    keyboardType="number-pad"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                    placeholder="1"
                    placeholderTextColor={UI_COLORS.gray}
                  />
                </View>
                <View style={styles.rangeField}>
                  <Text style={styles.label}>End page</Text>
                  <TextInput
                    value={rangeEnd}
                    onChangeText={setRangeEnd}
                    keyboardType="number-pad"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                    placeholder="1"
                    placeholderTextColor={UI_COLORS.gray}
                  />
                </View>
              </View>
              <Text style={styles.hint}>Page ranges are 1-based and inclusive.</Text>
            </>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Options</Text>
          <CheckboxRow
            label="Include comments"
            checked={includeComments}
            onPress={() => setIncludeComments(current => !current)}
          />
          <TouchableOpacity
            activeOpacity={0.75}
            style={[styles.button, styles.secondaryButton]}
            onPress={() => setView('config')}>
            <Text style={styles.secondaryButtonText}>Open config page</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            activeOpacity={0.75}
            style={[styles.button, (isScanning || isExporting) && styles.buttonDisabled]}
            onPress={handleScan}
            disabled={isScanning || isExporting}>
            <Text style={styles.buttonText}>
              {isScanning ? 'Scanning...' : 'Scan text boxes'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.75}
            style={[
              styles.button,
              styles.secondaryButton,
              (!scanSummary || isScanning || isExporting) && styles.buttonDisabled,
            ]}
            onPress={handleExport}
            disabled={!scanSummary || isScanning || isExporting}>
            <Text style={styles.secondaryButtonText}>
              {isExporting ? 'Exporting...' : 'Export DOCX'}
            </Text>
          </TouchableOpacity>
        </View>

        {scanSummary ? (
          <>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Scan summary</Text>
              <Text style={styles.contextText}>{formatPages(scanSummary.scannedPages)}</Text>
              <View style={styles.statsRow}>
                <View style={styles.statTile}>
                  <Text style={styles.statValue}>{scanSummary.counts.heading}</Text>
                  <Text style={styles.statLabel}>Headings</Text>
                </View>
                <View style={styles.statTile}>
                  <Text style={styles.statValue}>{scanSummary.counts.paragraph}</Text>
                  <Text style={styles.statLabel}>Paragraphs</Text>
                </View>
                <View style={styles.statTile}>
                  <Text style={styles.statValue}>{scanSummary.counts.comment}</Text>
                  <Text style={styles.statLabel}>Comments</Text>
                </View>
              </View>
              <View style={styles.statsRow}>
                <View style={styles.statTile}>
                  <Text style={styles.statValue}>{scanSummary.counts.meta}</Text>
                  <Text style={styles.statLabel}>Meta</Text>
                </View>
                <View style={styles.statTile}>
                  <Text style={styles.statValue}>{scanSummary.counts.unknown}</Text>
                  <Text style={styles.statLabel}>Unknown</Text>
                </View>
                <View style={styles.statTile}>
                  <Text style={styles.statValue}>{scanSummary.items.length}</Text>
                  <Text style={styles.statLabel}>Total</Text>
                </View>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Will export</Text>
              <Text style={styles.contextText}>
                {includedCounts
                  ? `${includedCounts.heading} headings, ${includedCounts.paragraph} paragraphs, ${includedCounts.comment} comments`
                  : 'No included content yet.'}
              </Text>
              <Text style={styles.hint}>
                Temporary safety limit: {MAX_EXPORT_ITEM_COUNT} included text
                boxes per export. Current selection: {includedItemCount}.
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Excluded styles</Text>
              {excludedStyles.length > 0 ? (
                excludedStyles.map(group => (
                  <Text style={styles.statusText} key={group.styleSignature}>
                    {group.styleSignature}: {group.count}
                  </Text>
                ))
              ) : (
                <Text style={styles.contextText}>
                  Nothing is excluded with the current settings.
                </Text>
              )}
            </View>
          </>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Status</Text>
          <Text style={styles.statusText}>{status}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: UI_COLORS.white,
  },
  content: {
    paddingHorizontal: 24,
    paddingVertical: 20,
    gap: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  headerCopy: {
    flex: 1,
    gap: 6,
  },
  eyebrow: {
    fontSize: UI_FONT_SIZES.meta,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: UI_COLORS.gray,
  },
  title: {
    fontSize: UI_FONT_SIZES.title,
    fontWeight: '700',
    color: UI_COLORS.black,
  },
  subtitle: {
    fontSize: UI_FONT_SIZES.body,
    lineHeight: 22,
    color: UI_COLORS.black,
  },
  closeButton: {
    borderWidth: 1,
    borderColor: UI_COLORS.black,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: UI_COLORS.white,
  },
  closeButtonText: {
    fontSize: UI_FONT_SIZES.body,
    fontWeight: '600',
    color: UI_COLORS.black,
  },
  card: {
    borderWidth: 1,
    borderColor: UI_COLORS.black,
    backgroundColor: UI_COLORS.white,
    borderRadius: 16,
    padding: 18,
    gap: 10,
  },
  sectionTitle: {
    fontSize: UI_FONT_SIZES.body,
    fontWeight: '700',
    color: UI_COLORS.black,
  },
  label: {
    fontSize: UI_FONT_SIZES.body,
    fontWeight: '700',
    color: UI_COLORS.black,
  },
  input: {
    borderWidth: 1,
    borderColor: UI_COLORS.black,
    borderRadius: 12,
    backgroundColor: UI_COLORS.white,
    color: UI_COLORS.black,
    fontSize: UI_FONT_SIZES.body,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  hint: {
    fontSize: UI_FONT_SIZES.meta,
    lineHeight: 19,
    color: UI_COLORS.gray,
  },
  contextText: {
    fontSize: UI_FONT_SIZES.body,
    lineHeight: 22,
    color: UI_COLORS.black,
  },
  scopeRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  scopeButton: {
    borderWidth: 1,
    borderColor: UI_COLORS.black,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: UI_COLORS.white,
  },
  scopeButtonSelected: {
    backgroundColor: UI_COLORS.black,
  },
  scopeButtonText: {
    fontSize: UI_FONT_SIZES.body,
    fontWeight: '600',
    color: UI_COLORS.black,
  },
  scopeButtonTextSelected: {
    color: UI_COLORS.white,
  },
  rangeRow: {
    flexDirection: 'row',
    gap: 12,
  },
  rangeField: {
    flex: 1,
    gap: 8,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  checkboxBox: {
    width: 26,
    height: 26,
    borderWidth: 1,
    borderColor: UI_COLORS.black,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: UI_COLORS.white,
    marginTop: 2,
  },
  checkboxBoxChecked: {
    backgroundColor: UI_COLORS.black,
  },
  checkboxMark: {
    fontSize: UI_FONT_SIZES.body,
    fontWeight: '700',
    color: UI_COLORS.white,
  },
  checkboxMarkChecked: {
    color: UI_COLORS.white,
  },
  checkboxCopy: {
    flex: 1,
    gap: 4,
  },
  toggleLabel: {
    flex: 1,
    fontSize: UI_FONT_SIZES.body,
    color: UI_COLORS.black,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: UI_COLORS.black,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButton: {
    backgroundColor: UI_COLORS.white,
    borderWidth: 1,
    borderColor: UI_COLORS.black,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    color: UI_COLORS.white,
    fontSize: UI_FONT_SIZES.body,
    fontWeight: '700',
  },
  secondaryButtonText: {
    color: UI_COLORS.black,
    fontSize: UI_FONT_SIZES.body,
    fontWeight: '700',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statTile: {
    flex: 1,
    borderWidth: 1,
    borderColor: UI_COLORS.black,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 14,
    gap: 4,
  },
  statValue: {
    fontSize: UI_FONT_SIZES.title,
    fontWeight: '700',
    color: UI_COLORS.black,
  },
  statLabel: {
    fontSize: UI_FONT_SIZES.meta,
    color: UI_COLORS.gray,
  },
  statusText: {
    fontSize: UI_FONT_SIZES.body,
    lineHeight: 22,
    color: UI_COLORS.black,
  },
  requirementGroup: {
    gap: 8,
  },
  requirementLabel: {
    fontSize: UI_FONT_SIZES.body,
    fontWeight: '700',
    color: UI_COLORS.black,
  },
  requirementRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  requirementButton: {
    borderWidth: 1,
    borderColor: UI_COLORS.black,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: UI_COLORS.white,
  },
  requirementButtonSelected: {
    backgroundColor: UI_COLORS.black,
  },
  requirementButtonText: {
    fontSize: UI_FONT_SIZES.meta,
    fontWeight: '600',
    color: UI_COLORS.black,
  },
  requirementButtonTextSelected: {
    color: UI_COLORS.white,
  },
});
