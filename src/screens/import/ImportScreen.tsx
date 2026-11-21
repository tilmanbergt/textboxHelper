/**
 * Import a text file (technical-design-calmer-screens.md §3.7, canvas "Import text file"), opened
 * from the Manuscript card's Files tab (technical-design-settings-layout-files.md §4).
 * Left: the file (Supernote file selector, any folder, .txt) and how the text is structured.
 * Right: the planned pages drawn to scale, updated by itself after every change. Font sizes and
 * margins are the page layout's, set in the Manuscript card's Settings → Layout. In the Paragraph boxes layout the import can be linked to
 * its file (technical-design-source-link.md §3): then blank lines separate the blocks and headings
 * are always recognized, and the header says what the file holds that is kept as is.
 */
import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {GLYPH} from '../../ui/glyphs';
import {IMPORT_HELP} from '../../domain/helpTexts';
import {isLinkedImport, type TextboxImportSettings} from '../../domain/importSettings';
import {marginsSummary} from '../../domain/pageLayout';
import {plural} from '../../domain/plural';
import {protectedSummaryText} from '../../domain/sourceBlocks';
import Checkbox from '../../ui/Checkbox';
import PageHeader from '../../ui/PageHeader';
import PillButton from '../../ui/PillButton';
import ScreenFrame from '../../ui/ScreenFrame';
import Segmented from '../../ui/Segmented';
import {COLORS, FONT, SPACING} from '../../ui/theme';
import {requestEinkRefresh} from '../../utils/screenRefresh';
import FolderSetupScreen from './FolderSetupScreen';
import PagePreview from './PagePreview';
import {useTextImport} from './useTextImport';
import {getSettings} from '../../storage/settingsFile';

interface Props {
  onClose: () => void;
  /** Back to the Manuscript card; `imported` says whether the note changed. */
  onBack: (imported: boolean, message: string | null) => void;
  /** Opens with "Whole folder" chosen. */
  wholeFolder?: boolean;
  /** Opens Settings → Layout. */
  onOpenLayout: () => void;
}

export default function ImportScreen({onClose, onBack, wholeFolder = false, onOpenLayout}: Props): React.JSX.Element {
  const flow = useTextImport(wholeFolder);
  const {settings, preview, busy, imported} = flow;
  const [view, setView] = useState<'import' | 'folder'>('import');
  const [pageIndex, setPageIndex] = useState(0);

  useEffect(() => {
    setPageIndex(0);
  }, [preview]);

  useEffect(() => {
    requestEinkRefresh();
  }, [pageIndex]);

  if (view === 'folder' && flow.folder) {
    return (
      <FolderSetupScreen
        folder={flow.folder}
        setup={flow.setup}
        onChange={flow.setSetup}
        status={flow.status}
        onBack={() => setView('import')}
        onClose={onClose}
      />
    );
  }
  const back = () => onBack(imported, imported ? flow.status?.text ?? null : null);

  const setStructure = (next: Partial<TextboxImportSettings['structure']>) =>
    flow.change({...settings, structure: {...settings.structure, ...next}});
  const adding = preview?.addingTo ?? null;
  const whole = flow.wholeFolder && !adding;
  const linked = isLinkedImport(settings) || !!adding || whole;
  const headings = linked || settings.structure.detectMarkdownHeadings;
  const filePath = settings.filePath;
  const fileName = filePath ? filePath.split('/').slice(-1)[0] : '';
  const folder = filePath ? filePath.slice(0, filePath.lastIndexOf('/')).replace(/^\/storage\/emulated\/0\//, '') : '';

  const context = preview
    ? adding
      ? `after page ${adding.afterPage + 1}, the end of the note`
      : preview.effectiveInsertMode === 'currentPage'
      ? `into page ${preview.currentPage + 1}`
      : `on new pages after page ${preview.currentPage + 1}`
    : undefined;

  const primary = imported
    ? {label: 'Back to Manuscript', onPress: back}
    : {
        label: adding ? 'Add' : whole ? `Import ${plural(flow.folderImport?.names.length ?? 0, 'file')}` : 'Import',
        onPress: flow.runImport,
        disabled: !preview || flow.previewing,
        busy,
        busyLabel: 'Importing…',
      };

  const pages = preview?.pages ?? [];
  const shownPage = pages[Math.min(pageIndex, pages.length - 1)];
  const hiddenPages = preview ? preview.plannedPageCount - 1 : 0;

  return (
    <ScreenFrame
      title={adding ? 'Add a file to this note' : 'Import text file'}
      back={{label: 'Manuscript', onPress: back}}
      context={context}
      help={{title: 'Import text file', text: IMPORT_HELP}}
      onClose={onClose}
      status={flow.status ?? (imported ? null : {text: 'Nothing changes until you tap Import.'})}
      primary={primary}
      screenKey={`import-${pageIndex}`}>
      <View style={styles.columns}>
        <View style={styles.left}>
          <Text style={[styles.label, styles.firstLabel]}>File</Text>
          <View style={styles.fileRow}>
            <Text style={[styles.fileName, !fileName && styles.muted]} numberOfLines={1}>
              {fileName || 'No file chosen'}
            </Text>
            <PillButton size="small" label="Choose ›" disabled={busy} onPress={flow.chooseFile} />
          </View>
          <Text style={styles.path} numberOfLines={1}>
            {filePath ? `${folder || 'Storage'}/` : '.txt files from any folder'}
          </Text>

          {!adding && (
            <Segmented
              options={[
                {key: 'file', label: 'This file'},
                {key: 'folder', label: 'Whole folder'},
              ]}
              value={flow.wholeFolder ? 'folder' : 'file'}
              onChange={value => flow.setWholeFolder(value === 'folder')}
            />
          )}
          {whole && (
            <Pressable
              accessibilityRole="button"
              disabled={!flow.folder}
              onPress={() => setView('folder')}
              style={styles.link}>
              <View style={styles.linkText}>
                <Text style={styles.linkTitle}>Files and order</Text>
                <Text style={styles.path}>
                  {flow.folderImport
                    ? `${flow.folderImport.names.length} of ${flow.folder?.files.length ?? 0} · ${
                        flow.folderImport.ordered ? 'ordered (index.txt)' : 'unordered'
                      } · linked, each file under its name as a title`
                    : 'Reading the folder…'}
                </Text>
              </View>
              <Text style={styles.linkTitle}>›</Text>
            </Pressable>
          )}

          {whole ? null : adding ? (
            <Text style={styles.path}>
              This note has {plural(adding.fileCount, 'linked file')}: the file is added linked, with its name as a
              title, after the last page.
            </Text>
          ) : (
            <>
              <Text style={styles.label}>Layout</Text>
              <Segmented
                options={[
                  {key: 'continuous', label: 'Continuous text'},
                  {key: 'paragraphTextboxes', label: 'Paragraph boxes'},
                ]}
                value={settings.structure.layoutMode}
                onChange={layoutMode => setStructure({layoutMode})}
              />
            </>
          )}

          {!adding && !whole && settings.structure.layoutMode === 'paragraphTextboxes' && (
            <Checkbox
              label="Link to file (write changes back)"
              checked={settings.linkToFile}
              onChange={linkToFile => flow.change({...settings, linkToFile})}
            />
          )}

          {!linked && (
            <>
              <Text style={styles.label}>Paragraphs are separated by</Text>
              <Segmented
                options={[
                  {key: 'blankLine', label: 'Blank lines'},
                  {key: 'line', label: 'Every line'},
                ]}
                value={settings.structure.paragraphSeparator}
                onChange={paragraphSeparator => setStructure({paragraphSeparator})}
              />
            </>
          )}

          <Text style={styles.label}>Headings</Text>
          {linked ? (
            <Text style={styles.path}>#, ##, ### and deeper are recognized.</Text>
          ) : (
            <Checkbox
              label="Recognize #, ##, ###"
              checked={headings}
              onChange={detectMarkdownHeadings => setStructure({detectMarkdownHeadings})}
            />
          )}
          <Pressable accessibilityRole="button" disabled={busy} onPress={onOpenLayout} style={styles.link}>
            <View style={styles.linkText}>
              <Text style={styles.linkTitle}>Layout</Text>
              <Text style={styles.path}>{layoutSummary(settings)}</Text>
            </View>
            <Text style={styles.linkTitle}>{GLYPH.next}</Text>
          </Pressable>
        </View>

        <View style={styles.right}>
          <PageHeader
            header={
              preview
                ? [
                    preview.headingCount > 0 ? plural(preview.headingCount, 'heading') : null,
                    plural(preview.paragraphCount, 'paragraph'),
                    plural(preview.expectedTextboxCount, 'textbox', 'textboxes'),
                    plural(preview.plannedPageCount, 'page'),
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : 'Preview'
            }
            hiddenLabel={`+${hiddenPages} ${hiddenPages === 1 ? 'page' : 'pages'}`}
            canPrev={pageIndex > 0}
            canNext={pageIndex < pages.length - 1}
            onPrev={() => setPageIndex(pageIndex - 1)}
            onNext={() => setPageIndex(pageIndex + 1)}
          />
          {preview && shownPage ? (
            <>
              <PagePreview page={shownPage} pageSize={preview.pageSize} />
              <Text style={styles.caption}>
                {flow.previewing
                  ? 'Updating…'
                  : `Page ${pageIndex + 1} of the import, scaled down${
                      preview.plannedPageCount > pages.length ? ` (first ${pages.length} shown)` : ''
                    }`}
              </Text>
              {preview.source && (
                <Text style={styles.caption} numberOfLines={2}>
                  {[
                    `Linked to ${fileName}: changes can be written back.`,
                    protectedSummaryText(preview.source),
                    'Links and formatting stay as text.',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                </Text>
              )}
            </>
          ) : (
            <View style={styles.message}>
              <Text style={styles.messageText}>{flow.previewing ? 'Reading the file…' : flow.previewError ?? ''}</Text>
              {!flow.previewing && !filePath ? (
                <Text style={styles.muted}>Tap Choose › and pick a .txt file, e.g. from INBOX.</Text>
              ) : null}
            </View>
          )}
        </View>
      </View>
    </ScreenFrame>
  );
}

/** "Text 36 · # 52 · Margins 100 · 100 · 280 · 625" */
function layoutSummary(settings: TextboxImportSettings): string {
  return `Text ${settings.fontSize} · # ${settings.structure.heading1.fontSize} · ${marginsSummary(getSettings().layout)}`;
}

const styles = StyleSheet.create({
  columns: {
    flex: 1,
    flexDirection: 'row',
  },
  left: {
    width: 420,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.base,
    paddingBottom: SPACING.base,
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
    gap: SPACING.xs,
  },
  right: {
    flex: 1,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.base,
    paddingBottom: SPACING.sm,
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
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  fileName: {
    flex: 1,
    fontSize: FONT.medium,
    fontWeight: '700',
    color: COLORS.text,
  },
  muted: {
    color: COLORS.muted,
    fontWeight: '400',
    fontSize: FONT.small,
  },
  path: {
    fontSize: FONT.small,
    color: COLORS.muted,
  },
  link: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: SPACING.md,
  },
  linkText: {
    flex: 1,
  },
  linkTitle: {
    fontSize: FONT.medium,
    color: COLORS.text,
  },
  caption: {
    fontSize: FONT.small,
    color: COLORS.muted,
    textAlign: 'center',
    paddingTop: SPACING.sm,
  },
  message: {
    gap: SPACING.sm,
    paddingTop: SPACING.sm,
  },
  messageText: {
    fontSize: FONT.medium,
    color: COLORS.text,
  },
});
