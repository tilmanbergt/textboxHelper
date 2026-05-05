import {Document, HeadingLevel, Packer, Paragraph, TextRun} from 'docx';
import RNFS from 'react-native-fs';
import {FileUtils} from 'sn-plugin-lib';
import {getIncludedScanItems, type ScanSummary} from './scanTextBoxes';

export const MAX_EXPORT_ITEM_COUNT = 120;

function buildTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function logExport(message: string, payload?: unknown): void {
  if (payload === undefined) {
    console.log(`[DocxExport] ${message}`);
    return;
  }

  try {
    console.log(`[DocxExport] ${message}`, JSON.stringify(payload));
  } catch {
    console.log(`[DocxExport] ${message}`, String(payload));
  }
}

export async function exportScannedDocx(params: {
  scan: ScanSummary;
  includeComments: boolean;
  onProgress?: (message: string) => void;
}): Promise<{
  exportPath: string;
  tempPath: string;
  exportedItemCount: number;
  base64Length: number;
}> {
  const {scan, includeComments, onProgress} = params;
  const includedItems = getIncludedScanItems(scan, includeComments);

  logExport('prepare:start', {
    scope: scan.scope,
    scannedPages: scan.scannedPages.length,
    totalItems: scan.items.length,
    includedItems: includedItems.length,
    includeComments,
  });

  if (includedItems.length === 0) {
    logExport('prepare:empty');
    throw new Error('There is no exportable content in the current scan.');
  }

  if (includedItems.length > MAX_EXPORT_ITEM_COUNT) {
    logExport('prepare:tooManyItems', {
      includedItems: includedItems.length,
      limit: MAX_EXPORT_ITEM_COUNT,
    });
    throw new Error(
      `This export contains ${includedItems.length} text boxes, which is above the temporary safety limit of ${MAX_EXPORT_ITEM_COUNT}. Please try a smaller page range first.`,
    );
  }

  const exportDir = await FileUtils.getExportPath();
  const fileName = `notedraft-export-${buildTimestamp()}.docx`;
  const tempPath = `${RNFS.DocumentDirectoryPath}/${fileName}`;
  const exportPath = `${exportDir}/${fileName}`;

  onProgress?.('Preparing export directory...');
  logExport('filesystem:prepareDir', {exportDir, tempPath, exportPath});
  await FileUtils.makeDir(exportDir);

  onProgress?.('Building DOCX document...');
  const children = includedItems.map(item => {
    if (item.role === 'heading') {
      return new Paragraph({
        text: item.text,
        heading: HeadingLevel.HEADING_1,
      });
    }

    if (item.role === 'comment') {
      return new Paragraph({
        children: [
          new TextRun({
            text: item.text,
            italics: true,
          }),
        ],
      });
    }

    return new Paragraph({
      text: item.text,
    });
  });

  logExport('document:childrenBuilt', {
    paragraphCount: children.length,
  });

  const document = new Document({
    sections: [
      {
        children,
      },
    ],
  });

  onProgress?.('Packing DOCX into memory...');
  logExport('packer:start');
  const base64 = await Packer.toBase64String(document);
  const base64Length = base64.length;
  logExport('packer:done', {base64Length});

  onProgress?.('Writing temporary DOCX file...');
  logExport('filesystem:writeTemp:start', {tempPath});
  await RNFS.writeFile(tempPath, base64, 'base64');
  logExport('filesystem:writeTemp:done', {tempPath});

  onProgress?.('Copying DOCX into EXPORT...');
  logExport('filesystem:copyToExport:start', {tempPath, exportPath});
  const copied = await FileUtils.copyFile(tempPath, exportPath);
  if (!copied) {
    logExport('filesystem:copyToExport:failed', {tempPath, exportPath});
    throw new Error('Could not copy the DOCX file into EXPORT.');
  }
  logExport('filesystem:copyToExport:done', {exportPath});

  return {
    exportPath,
    tempPath,
    exportedItemCount: includedItems.length,
    base64Length,
  };
}
