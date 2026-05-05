import {PluginCommAPI, PluginFileAPI} from 'sn-plugin-lib';

export type ExportNoteContext = {
  filePath: string;
  page: number | null;
  totalPages: number | null;
  pageInfo: string;
};

function expectApiResult<T>(result: any, fallbackMessage: string): T {
  if (!result?.success) {
    throw new Error(result?.error?.message ?? fallbackMessage);
  }

  return result.result as T;
}

export async function refreshExportNoteContext(): Promise<ExportNoteContext> {
  const filePath = expectApiResult<string>(
    await PluginCommAPI.getCurrentFilePath(),
    'Could not determine the current note path.',
  );

  const page = expectApiResult<number>(
    await PluginCommAPI.getCurrentPageNum(),
    'Could not determine the current page.',
  );

  let totalPages: number | null = null;
  try {
    totalPages = expectApiResult<number>(
      await PluginFileAPI.getNoteTotalPageNum(filePath),
      'Could not determine the note page count.',
    );
  } catch (error) {
    console.log(
      '[DocxExport] noteContext:totalPagesUnavailable',
      JSON.stringify({error: String(error)}),
    );
  }

  return {
    filePath,
    page,
    totalPages,
    pageInfo:
      page === null || page < 0
        ? filePath
        : `${filePath}\nCurrent page: ${page + 1}${
            totalPages ? ` of ${totalPages}` : ''
          }`,
  };
}