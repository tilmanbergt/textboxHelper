import RNFS from 'react-native-fs';
import {PluginManager} from 'sn-plugin-lib';
import {
  buildBrokenPenEditIndexPath,
  buildPenEditDir,
  buildPenEditEntryDir,
  buildPenEditIndexPath,
} from '../domain/backupPaths';
import {
  PEN_EDIT_INDEX_VERSION,
  parsePenEditIndex,
  serializePenEditIndex,
  type PenEditIndex,
  type PenEditStrokeData,
} from '../domain/penEditModel';

/**
 * The pen-edit files in the plugin folder (technical-design-pen-edits.md §3.3):
 * `pen-edits/index.json` with every entry, and per entry `pen-edits/<id>/strokes.json` and
 * `picture.png`. Index changes run one at a time, each on a fresh read, and are written through
 * a temporary file, so a crash never leaves half an index.
 */

const STROKES_FILE = 'strokes.json';
const PICTURE_FILE = 'picture.png';

async function pluginDir(): Promise<string> {
  const dir = await PluginManager.getPluginDirPath();
  if (!dir) {
    throw new Error('Could not find the plugin folder.');
  }
  return dir;
}

let queue: Promise<unknown> = Promise.resolve();

function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  // The caller gets the error from `run`; this tail only keeps the queue going.
  queue = run.catch(() => undefined);
  return run;
}

/** Reads the index. A broken file is moved aside (and logged); the result is then empty. */
async function readIndexUnqueued(dir: string): Promise<{index: PenEditIndex; warning: string | null}> {
  const path = buildPenEditIndexPath(dir);
  const json = (await RNFS.exists(path)) ? await RNFS.readFile(path, 'utf8') : null;
  const parsed = parsePenEditIndex(json);
  if (parsed.broken) {
    const aside = buildBrokenPenEditIndexPath(dir, new Date().toISOString());
    await RNFS.moveFile(path, aside);
    console.warn('[PenEditStore] unreadable index moved aside', aside);
    return {index: parsed.index, warning: 'The list of pen edits could not be read and was set aside.'};
  }
  if (parsed.dropped > 0) {
    console.warn('[PenEditStore] unreadable entries dropped', parsed.dropped);
  }
  return {index: parsed.index, warning: null};
}

async function writeIndexUnqueued(dir: string, index: PenEditIndex): Promise<void> {
  await RNFS.mkdir(buildPenEditDir(dir));
  const path = buildPenEditIndexPath(dir);
  const temp = `${path}.tmp`;
  await RNFS.writeFile(temp, serializePenEditIndex(index), 'utf8');
  if (await RNFS.exists(path)) {
    await RNFS.unlink(path);
  }
  await RNFS.moveFile(temp, path);
}

/** The current index; `warning` is set when a broken file had to be set aside. */
export function readPenEditIndex(): Promise<{index: PenEditIndex; warning: string | null}> {
  return serial(async () => readIndexUnqueued(await pluginDir()));
}

/** Changes the index on a fresh read and writes it; returns the new index. */
export function changePenEditIndex(change: (index: PenEditIndex) => PenEditIndex): Promise<PenEditIndex> {
  return serial(async () => {
    const dir = await pluginDir();
    const {index} = await readIndexUnqueued(dir);
    const next = change(index);
    await writeIndexUnqueued(dir, {...next, version: PEN_EDIT_INDEX_VERSION});
    return next;
  });
}

/**
 * Stores an entry's handwriting: the strokes, and the picture moved in from its temporary place.
 * A picture that couldn't be kept is reported with the reason, not as an error.
 */
export async function savePenEditData(
  data: PenEditStrokeData,
  temporaryPicture: string | null,
): Promise<{kept: boolean; error: string | null}> {
  const dir = buildPenEditEntryDir(await pluginDir(), data.id);
  await RNFS.mkdir(dir);
  await RNFS.writeFile(`${dir}/${STROKES_FILE}`, JSON.stringify(data), 'utf8');
  if (!temporaryPicture) {
    return {kept: false, error: 'no picture from the host'};
  }
  const source = temporaryPicture.replace(/^file:\/\//, '');
  try {
    if (!(await RNFS.exists(source))) {
      return {kept: false, error: `picture not found at ${source}`};
    }
    await RNFS.copyFile(source, `${dir}/${PICTURE_FILE}`);
    await RNFS.unlink(source).catch(() => undefined);
    return {kept: true, error: null};
  } catch (error) {
    console.warn('[PenEditStore] picture not kept', JSON.stringify({id: data.id, source, error: String(error)}));
    return {kept: false, error: String(error)};
  }
}

/** An entry's stored strokes, or null when the file is missing or unreadable. */
export async function readPenEditStrokes(id: string): Promise<PenEditStrokeData | null> {
  try {
    const path = `${buildPenEditEntryDir(await pluginDir(), id)}/${STROKES_FILE}`;
    if (!(await RNFS.exists(path))) {
      return null;
    }
    const data = JSON.parse(await RNFS.readFile(path, 'utf8')) as PenEditStrokeData;
    return data && Array.isArray(data.strokes) ? data : null;
  } catch (error) {
    console.warn('[PenEditStore] strokes not read', JSON.stringify({id, error: String(error)}));
    return null;
  }
}

/** The picture's path for an `Image` (`file://…`). */
export async function penEditPictureUri(id: string): Promise<string> {
  return `file://${buildPenEditEntryDir(await pluginDir(), id)}/${PICTURE_FILE}`;
}

/** A temporary path for the lasso picture, in the app's cache folder (as Kept GTD's temp folder). */
export function temporaryPicturePath(id: string): string {
  return `${RNFS.CachesDirectoryPath}/pen-edit-${id}.png`;
}
