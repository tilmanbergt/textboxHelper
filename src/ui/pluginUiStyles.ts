import {StyleSheet} from 'react-native';

export const UI_FONT_SIZES = {
  title: 24,
  body: 16,
  meta: 13,
} as const;

export const UI_COLORS = {
  black: '#000000',
  white: '#ffffff',
  gray: '#7a7a7a',
  lightGray: '#d0d0d0',
  softGray: '#f4f4f4',
} as const;

export const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: UI_COLORS.white,
  },
  content: {
    paddingHorizontal: 20,
    paddingVertical: 18,
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
    gap: 4,
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
  summaryText: {
    fontSize: UI_FONT_SIZES.body,
    lineHeight: 21,
    color: UI_COLORS.gray,
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
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  actionButton: {
    width: '48%',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: UI_COLORS.black,
    backgroundColor: UI_COLORS.white,
    paddingHorizontal: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  actionButtonSelected: {
    backgroundColor: UI_COLORS.black,
  },
  actionButtonDisabled: {
    opacity: 0.35,
  },
  actionButtonText: {
    color: UI_COLORS.black,
    fontSize: UI_FONT_SIZES.body,
    fontWeight: '700',
    textAlign: 'center',
  },
  actionButtonTextSelected: {
    color: UI_COLORS.white,
  },
  previewRow: {
    flexDirection: 'row',
    gap: 12,
  },
  previewCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: UI_COLORS.lightGray,
    backgroundColor: UI_COLORS.softGray,
    padding: 16,
    gap: 10,
    minHeight: 280,
  },
  previewTitle: {
    fontSize: UI_FONT_SIZES.body,
    fontWeight: '700',
    color: UI_COLORS.black,
  },
  previewText: {
    fontSize: UI_FONT_SIZES.body,
    lineHeight: 21,
    color: UI_COLORS.black,
  },
  deletedPreviewText: {
    textDecorationLine: 'underline',
    textDecorationColor: UI_COLORS.black,
    fontWeight: '700',
  },
  insertedPreviewText: {
    textDecorationLine: 'underline',
    textDecorationColor: UI_COLORS.black,
    fontWeight: '700',
  },
  previewBlock: {
    gap: 10,
  },
  previewSeparator: {
    fontSize: UI_FONT_SIZES.body,
    lineHeight: 21,
    color: UI_COLORS.gray,
  },
  calibrationRow: {
    gap: 10,
  },
  calibrationLabel: {
    fontSize: UI_FONT_SIZES.meta,
    lineHeight: 18,
    color: UI_COLORS.gray,
    fontWeight: '600',
  },
  calibrationControls: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  calibrationButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: UI_COLORS.black,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: UI_COLORS.white,
  },
  calibrationButtonText: {
    fontSize: UI_FONT_SIZES.meta,
    fontWeight: '700',
    color: UI_COLORS.black,
  },
  calibrationValue: {
    fontSize: UI_FONT_SIZES.body,
    fontWeight: '700',
    color: UI_COLORS.black,
    minWidth: 64,
  },
  calibrationCompactCard: {
    gap: 8,
  },
  calibrationCompactRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  },
  calibrationInlineGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  calibrationInlineLabel: {
    fontSize: UI_FONT_SIZES.meta,
    lineHeight: 18,
    color: UI_COLORS.gray,
    fontWeight: '600',
  },
  calibrationCompactValue: {
    fontSize: UI_FONT_SIZES.meta,
    fontWeight: '700',
    color: UI_COLORS.black,
    minWidth: 54,
  },
  sectionCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: UI_COLORS.lightGray,
    backgroundColor: UI_COLORS.softGray,
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    fontSize: UI_FONT_SIZES.body,
    fontWeight: '700',
    color: UI_COLORS.black,
  },
  sectionHeaderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionToggleText: {
    fontSize: UI_FONT_SIZES.meta,
    color: UI_COLORS.gray,
    fontWeight: '600',
  },
  sectionBody: {
    gap: 12,
  },
  subsectionTitle: {
    fontSize: UI_FONT_SIZES.meta,
    lineHeight: 18,
    color: UI_COLORS.gray,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  listRow: {
    gap: 4,
  },
  listTitle: {
    fontSize: UI_FONT_SIZES.body,
    lineHeight: 21,
    color: UI_COLORS.black,
    fontWeight: '600',
  },
  listDetail: {
    fontSize: UI_FONT_SIZES.meta,
    lineHeight: 18,
    color: UI_COLORS.gray,
  },
  emptyStateText: {
    fontSize: UI_FONT_SIZES.body,
    lineHeight: 21,
    color: UI_COLORS.gray,
  },
  helpText: {
    fontSize: UI_FONT_SIZES.body,
    lineHeight: 21,
    color: UI_COLORS.black,
  },
  executeButton: {
    borderRadius: 16,
    backgroundColor: UI_COLORS.black,
    paddingHorizontal: 16,
    paddingVertical: 15,
    alignItems: 'center',
  },
  executeButtonDisabled: {
    opacity: 0.35,
  },
  executeButtonText: {
    color: UI_COLORS.white,
    fontSize: UI_FONT_SIZES.body,
    fontWeight: '700',
  },
  statusText: {
    fontSize: UI_FONT_SIZES.body,
    lineHeight: 21,
    color: UI_COLORS.black,
  },
  backupText: {
    fontSize: UI_FONT_SIZES.meta,
    lineHeight: 18,
    color: UI_COLORS.gray,
  },
  dialogScreen: {
    flex: 1,
    backgroundColor:  'transparent',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  dialogCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: UI_COLORS.lightGray,
    backgroundColor: UI_COLORS.softGray,
    paddingHorizontal: 20,
    paddingVertical: 22,
    gap: 10,
  },
  dialogEyebrow: {
    fontSize: UI_FONT_SIZES.meta,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: UI_COLORS.gray,
  },
  dialogTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: UI_COLORS.black,
  },
  dialogMessage: {
    fontSize: UI_FONT_SIZES.body,
    lineHeight: 22,
    color: UI_COLORS.black,
  },
  dialogMeta: {
    fontSize: UI_FONT_SIZES.meta,
    lineHeight: 18,
    color: UI_COLORS.gray,
  },
  dialogButtonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 6,
  },
  secondaryButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: UI_COLORS.black,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: UI_COLORS.white,
  },
  secondaryButtonText: {
    fontSize: UI_FONT_SIZES.body,
    fontWeight: '600',
    color: UI_COLORS.black,
  },
  primaryButton: {
    borderRadius: 999,
    backgroundColor: UI_COLORS.black,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  primaryButtonText: {
    fontSize: UI_FONT_SIZES.body,
    fontWeight: '700',
    color: UI_COLORS.white,
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
  urlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  importNumberRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  importNumberField: {
    width: '23%',
    gap: 6,
  },
  importNumberWide: {
    width: '48%',
  },
  importNumberLabel: {
    fontSize: UI_FONT_SIZES.meta,
    lineHeight: 18,
    color: UI_COLORS.gray,
    fontWeight: '700',
  },
importCompactCard: {
  borderRadius: 16,
  borderWidth: 1,
  borderColor: UI_COLORS.lightGray,
  backgroundColor: UI_COLORS.softGray,
  paddingHorizontal: 16,
  paddingVertical: 14,
  gap: 10,
},
compactActionButton: {
  paddingHorizontal: 12,
  paddingVertical: 10,
},
});