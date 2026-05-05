import React from 'react';
import {
  ScrollView,
  StatusBar,
  Text,
  TextStyle,
  TouchableOpacity,
  View,
} from 'react-native';
import {UI_COLORS, styles} from './pluginUiStyles';
import type {
  EditMarkerHighlightRange,
  EditMarkerPreview,
  EditMarkerPreviewBlock,
  EditMarkerPreviewScope,
} from '../editMarkerActions';

type MarkerSection = 'recognition' | 'calibration' | 'help';

type EditMarkerReviewViewProps = {
  markerPreview: EditMarkerPreview | null;
  markerPreviewScope: EditMarkerPreviewScope;
  activeMarkerSection: MarkerSection;
  markerBeforePreviewContent: React.ReactNode;
  markerAfterPreviewContent: React.ReactNode;
  markerOffsetX: number;
  markerWidthAdjustment: number;
  isMarkerBusy: boolean;
  isMarkerPreviewLoading: boolean;
  canApplyMarkers: boolean;
  status: string;
  backupPath: string;
  onClose: () => void;
  onApply: () => void;
  onSetActiveMarkerSection: (section: MarkerSection) => void;
  onChangeCalibration: (nextCalibration: {
    offsetX?: number;
    widthAdjustment?: number;
  }) => void;
  onResetCalibration: () => void;
  onRefreshCalibration: () => void;
};

export function renderHighlightedTextSegments(
  text: string,
  ranges: EditMarkerHighlightRange[],
  highlightStyle: TextStyle,
): React.ReactNode[] {
  if (ranges.length === 0) {
    return [<Text key="plain">{text || '(empty)'}</Text>];
  }

  const segments: React.ReactNode[] = [];
  let cursor = 0;

  ranges.forEach((range, index) => {
    const safeStart = Math.max(cursor, Math.min(range.start, text.length));
    const safeEnd = Math.max(safeStart, Math.min(range.end, text.length));

    if (safeStart > cursor) {
      segments.push(
        <Text key={`plain-${index}-${cursor}`}>
          {text.slice(cursor, safeStart)}
        </Text>,
      );
    }

    if (safeEnd > safeStart) {
      segments.push(
        <Text key={`highlight-${index}-${safeStart}`} style={highlightStyle}>
          {text.slice(safeStart, safeEnd)}
        </Text>,
      );
    }

    cursor = safeEnd;
  });

  if (cursor < text.length) {
    segments.push(<Text key={`plain-tail-${cursor}`}>{text.slice(cursor)}</Text>);
  }

  if (segments.length === 0) {
    return [<Text key="empty">(empty)</Text>];
  }

  return segments;
}

export function renderHighlightedPreviewBlocks(
  blocks: EditMarkerPreviewBlock[],
  emptyMessage: string,
  highlightStyle: TextStyle,
): React.ReactNode {
  if (blocks.length === 0) {
    return <Text style={styles.previewText}>{emptyMessage}</Text>;
  }

  return blocks.map((block, index) => (
    <View key={block.id || `block-${index}`} style={styles.previewBlock}>
      <Text style={styles.previewText}>
        {renderHighlightedTextSegments(block.text, block.highlightRanges, highlightStyle)}
      </Text>
      {index < blocks.length - 1 ? (
        <Text style={styles.previewSeparator}>----</Text>
      ) : null}
    </View>
  ));
}

function getMarkerCountText(
  markerPreview: EditMarkerPreview | null,
  markerPreviewScope: EditMarkerPreviewScope,
): string {
  if (!markerPreview) {
    return 'Loading markers...';
  }

  const count = markerPreview.selectedMarkerCount;

  if (markerPreviewScope === 'page') {
    return count === 1
      ? '1 marker found on this page'
      : `${count} markers found on this page`;
  }

  return count === 1 ? '1 marker selected' : `${count} markers selected`;
}

export function EditMarkerReviewView({
  markerPreview,
  markerPreviewScope,
  activeMarkerSection,
  markerBeforePreviewContent,
  markerAfterPreviewContent,
  markerOffsetX,
  markerWidthAdjustment,
  isMarkerBusy,
  isMarkerPreviewLoading,
  canApplyMarkers,
  status,
  backupPath,
  onClose,
  onApply,
  onSetActiveMarkerSection,
  onChangeCalibration,
  onResetCalibration,
  onRefreshCalibration,
}: EditMarkerReviewViewProps): React.JSX.Element {
  const renderMarkerOperations = () => {
    if (!markerPreview || markerPreview.operations.length === 0) {
      return <Text style={styles.emptyStateText}>No recognized operations yet.</Text>;
    }

    return markerPreview.operations.map(operation => (
      <View key={operation.id} style={styles.listRow}>
        <Text style={styles.listTitle}>{operation.summary}</Text>
        <Text style={styles.listDetail}>{operation.detail}</Text>
      </View>
    ));
  };

  const renderIgnoredMarkers = () => {
    if (!markerPreview || markerPreview.ignoredMarkers.length === 0) {
      return <Text style={styles.emptyStateText}>No selected markers were ignored.</Text>;
    }

    return markerPreview.ignoredMarkers.map(marker => (
      <View
        key={`${marker.markerUuid}:${marker.markerNumInPage}`}
        style={styles.listRow}>
        <Text style={styles.listTitle}>{marker.summary}</Text>
        <Text style={styles.listDetail}>{marker.reason}</Text>
      </View>
    ));
  };

  const renderMarkerSection = (
    section: MarkerSection,
    title: string,
    content: React.ReactNode,
  ) => {
    const isOpen = activeMarkerSection === section;

    return (
      <View style={styles.sectionCard}>
        <TouchableOpacity
          activeOpacity={0.75}
          style={styles.sectionHeaderButton}
          onPress={() => onSetActiveMarkerSection(section)}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionToggleText}>{isOpen ? 'Hide' : 'Show'}</Text>
        </TouchableOpacity>

        {isOpen ? content : null}
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={UI_COLORS.white} />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>Edit Marker Review</Text>

            <Text style={styles.summaryText}>
              {getMarkerCountText(markerPreview, markerPreviewScope)}
            </Text>

            <Text style={styles.summaryText}>
              {markerPreview?.summaryMessage || 'Analyzing selected markers...'}
            </Text>

            <Text style={styles.summaryText}>
              {markerPreviewScope === 'page' ? 'Global' : 'Current selection'}
            </Text>
          </View>

          <TouchableOpacity
            activeOpacity={0.75}
            style={styles.closeButton}
            onPress={onClose}>
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.previewRow}>
          <View style={styles.previewCard}>
            <Text style={styles.previewTitle}>Current</Text>
            {markerBeforePreviewContent}
          </View>

          <View style={styles.previewCard}>
            <Text style={styles.previewTitle}>Changed</Text>
            {markerAfterPreviewContent}
          </View>
        </View>

        <TouchableOpacity
          activeOpacity={0.75}
          style={[
            styles.executeButton,
            !canApplyMarkers && styles.executeButtonDisabled,
          ]}
          onPress={onApply}
          disabled={!canApplyMarkers}>
          <Text style={styles.executeButtonText}>
            {isMarkerBusy ? 'Applying...' : 'Apply Edit Markers'}
          </Text>
        </TouchableOpacity>

        {renderMarkerSection(
          'recognition',
          'Recognition Details',
          <View style={styles.sectionBody}>
            <Text style={styles.subsectionTitle}>Recognized</Text>
            {renderMarkerOperations()}

            <Text style={styles.subsectionTitle}>Ignored</Text>
            {renderIgnoredMarkers()}
          </View>,
        )}

        {renderMarkerSection(
          'calibration',
          'Calibration',
          <View style={styles.calibrationCompactCard}>
            <View style={styles.calibrationCompactRow}>
              <View style={styles.calibrationInlineGroup}>
                <Text style={styles.calibrationInlineLabel}>X</Text>

                <TouchableOpacity
                  activeOpacity={0.75}
                  style={styles.calibrationButton}
                  onPress={() => onChangeCalibration({offsetX: markerOffsetX - 5})}
                  disabled={isMarkerPreviewLoading || isMarkerBusy}>
                  <Text style={styles.calibrationButtonText}>-5</Text>
                </TouchableOpacity>

                <Text style={styles.calibrationCompactValue}>
                  {markerOffsetX}px
                </Text>

                <TouchableOpacity
                  activeOpacity={0.75}
                  style={styles.calibrationButton}
                  onPress={() => onChangeCalibration({offsetX: markerOffsetX + 5})}
                  disabled={isMarkerPreviewLoading || isMarkerBusy}>
                  <Text style={styles.calibrationButtonText}>+5</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.calibrationInlineGroup}>
                <Text style={styles.calibrationInlineLabel}>Width</Text>

                <TouchableOpacity
                  activeOpacity={0.75}
                  style={styles.calibrationButton}
                  onPress={() =>
                    onChangeCalibration({
                      widthAdjustment: markerWidthAdjustment - 1,
                    })
                  }
                  disabled={isMarkerPreviewLoading || isMarkerBusy}>
                  <Text style={styles.calibrationButtonText}>-1</Text>
                </TouchableOpacity>

                <Text style={styles.calibrationCompactValue}>
                  {markerWidthAdjustment}px
                </Text>

                <TouchableOpacity
                  activeOpacity={0.75}
                  style={styles.calibrationButton}
                  onPress={() =>
                    onChangeCalibration({
                      widthAdjustment: markerWidthAdjustment + 1,
                    })
                  }
                  disabled={isMarkerPreviewLoading || isMarkerBusy}>
                  <Text style={styles.calibrationButtonText}>+1</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.calibrationInlineGroup}>
                <TouchableOpacity
                  activeOpacity={0.75}
                  style={styles.calibrationButton}
                  onPress={onResetCalibration}
                  disabled={isMarkerPreviewLoading || isMarkerBusy}>
                  <Text style={styles.calibrationButtonText}>Reset</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.75}
                  style={styles.calibrationButton}
                  onPress={onRefreshCalibration}
                  disabled={isMarkerPreviewLoading || isMarkerBusy}>
                  <Text style={styles.calibrationButtonText}>Refresh</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>,
        )}

        {renderMarkerSection(
          'help',
          'Help',
          <View style={styles.sectionBody}>
            <Text style={styles.helpText}>
              Delete: draw a horizontal line through the words you want to remove.
            </Text>

            <Text style={styles.helpText}>
              Replace: draw the delete line, then add two short crossing vertical
              lines to mark it as a replacement.
            </Text>

            <Text style={styles.helpText}>
              Replacement text: type a line below the paragraph starting with `#`,
              for example `# corrected phrase`.
            </Text>

            <Text style={styles.helpText}>
              Multiple replacements are matched in reading order. Only recognized
              markers are removed on apply.
            </Text>
          </View>,
        )}

        {status ? <Text style={styles.statusText}>{status}</Text> : null}
        {backupPath ? <Text style={styles.backupText}>{backupPath}</Text> : null}
      </ScrollView>
    </View>
  );
}