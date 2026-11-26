/** Putting a picture into the open note (technical-design-release-readiness.md §6.2). */
import {PluginNoteAPI} from 'sn-plugin-lib';
import {assertBooleanSuccess} from './sdkResult';

/** Inserts the PNG at `path` into the open page; where it lands is the host's choice. */
export async function insertImageOnPage(path: string): Promise<void> {
  const response = (await PluginNoteAPI.insertImage(path)) as {success?: boolean; result?: boolean; error?: {message?: string}};
  assertBooleanSuccess(response, 'The picture could not be put on the page.');
}
