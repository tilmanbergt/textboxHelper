/**
 * @format
 */

/**
 * Supernote plugin entry point.
 *
 * This file is intentionally small and declarative:
 * - initialize the plugin runtime
 * - register all lasso and note toolbar entry points
 * - keep button wiring centralized so contributors can quickly verify visibility rules
 */

import {AppRegistry, Image} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';
import App from './App';
import {name as appName} from './app.json';
import {
  BUTTON_ID_EXPORT_DOCX,
  BUTTON_ID_IMPORT_TEXT_FILE,
  BUTTON_ID_NOTE_MANUSCRIPT,
  BUTTON_ID_TEXTBOX_TOOLS,
  BUTTON_ID_TOOLBAR_CLEAN_TEXTBOX_SPACES,
  BUTTON_ID_TOOLBAR_JOIN_TEXTBOXES,
  BUTTON_ID_TOOLBAR_REMOVE_LINE_BREAKS,
  BUTTON_ID_TOOLBAR_SPLIT_TEXTBOX,
  BUTTON_ID_TOOLBAR_SPLIT_PARAGRAPHS_TEXTBOX,
  BUTTON_ID_TOOLBAR_PEN_EDIT,
} from './src/domain/buttonIds';
import {presentEarlyNoMark, presentTagOutcome, tagPenEdit} from './src/actions/penEditTag';
import {initPluginRouting} from './src/supernote/pluginRouting';

AppRegistry.registerComponent(appName, () => App);

PluginManager.init();

// "Insertion or Replacement" (docs/dev/history/technical-design-pen-edits-2.md §3, §4): one tap, no
// plugin screen. A failure or a snippet without its mark opens App's small result card; a mark
// selected from the review opens the review again at that change.
function runPenEditTag() {
  // Opened as soon as the search found no mark; the final outcome then only updates the card.
  let shown = false;
  const show = async () => {
    if (shown) {
      return;
    }
    shown = true;
    try {
      await PluginManager.showPluginView();
    } catch (error) {
      console.error('[PenEdit] showPluginView failed', String(error));
    }
  };
  tagPenEdit({
    onNoMark: notice => {
      presentEarlyNoMark(notice);
      show();
    },
  })
    .then(async outcome => {
      if (presentTagOutcome(outcome)) {
        await show();
      }
    })
    .catch(error => console.error('[PenEdit] tag threw', String(error)));
}

initPluginRouting({
  [BUTTON_ID_TOOLBAR_PEN_EDIT]: () => runPenEditTag(),
});

PluginManager.registerButton(2, ['NOTE'], {
  id: BUTTON_ID_TEXTBOX_TOOLS,
  name: JSON.stringify({
    en: 'Textbox Tools',
    zh_CN: 'Textbox Tools',
    zh_TW: 'Textbox Tools',
    ja: 'Textbox Tools',
  }),
  icon: Image.resolveAssetSource(require('./assets/icon.png')).uri,
  showType: 1,
  editDataTypes: [3],
});

PluginManager.registerButton(1, ['NOTE'], {
  id: BUTTON_ID_IMPORT_TEXT_FILE,
  name: JSON.stringify({
    en: 'Import Text File',
    zh_CN: 'Import Text File',
    zh_TW: 'Import Text File',
    ja: 'Import Text File',
  }),
  icon: Image.resolveAssetSource(require('./assets/icon.png')).uri,
  showType: 1,
});
PluginManager.registerButton(1, ['NOTE'], {
  id: BUTTON_ID_EXPORT_DOCX,
  name: JSON.stringify({
    en: 'Export DOCX',
    zh_CN: 'Export DOCX',
    zh_TW: 'Export DOCX',
    ja: 'Export DOCX',
  }),
  icon: Image.resolveAssetSource(require('./assets/icon.png')).uri,
  showType: 1,
});

PluginManager.registerButton(1, ['NOTE'], {
  id: BUTTON_ID_NOTE_MANUSCRIPT,
  name: JSON.stringify({
    en: 'Manuscript',
    zh_CN: 'Manuscript',
    zh_TW: 'Manuscript',
    ja: 'Manuscript',
  }),
  icon: Image.resolveAssetSource(require('./assets/icon.png')).uri,
  showType: 1,
});

PluginManager.registerButton(2, ['NOTE'], {
  id: BUTTON_ID_TOOLBAR_SPLIT_TEXTBOX,
  name: JSON.stringify({
    en: 'Split Sentences',
    zh_CN: 'Split Sentences',
    zh_TW: 'Split Sentences',
    ja: 'Split Sentences',
  }),
  icon: Image.resolveAssetSource(require('./assets/icon.png')).uri,
  showType: 1,
  editDataTypes: [3],
});

PluginManager.registerButton(2, ['NOTE'], {
  id: BUTTON_ID_TOOLBAR_JOIN_TEXTBOXES,
  name: JSON.stringify({
    en: 'Join Text Boxes',
    zh_CN: 'Join Text Boxes',
    zh_TW: 'Join Text Boxes',
    ja: 'Join Text Boxes',
  }),
  icon: Image.resolveAssetSource(require('./assets/icon.png')).uri,
  showType: 1,
  editDataTypes: [3],
});

PluginManager.registerButton(2, ['NOTE'], {
  id: BUTTON_ID_TOOLBAR_SPLIT_PARAGRAPHS_TEXTBOX,
  name: JSON.stringify({
    en: 'Split Paragraphs',
    zh_CN: 'Split Paragraphs',
    zh_TW: 'Split Paragraphs',
    ja: 'Split Paragraphs',
  }),
  icon: Image.resolveAssetSource(require('./assets/icon.png')).uri,
  showType: 1,
  editDataTypes: [3],
});


PluginManager.registerButton(2, ['NOTE'], {
  id: BUTTON_ID_TOOLBAR_CLEAN_TEXTBOX_SPACES,
  name: JSON.stringify({
    en: 'Clean Spaces',
    zh_CN: 'Clean Spaces',
    zh_TW: 'Clean Spaces',
    ja: 'Clean Spaces',
  }),
  icon: Image.resolveAssetSource(require('./assets/icon.png')).uri,
  showType: 1,
  editDataTypes: [3],
});

PluginManager.registerButton(2, ['NOTE'], {
  id: BUTTON_ID_TOOLBAR_REMOVE_LINE_BREAKS,
  name: JSON.stringify({
    en: 'Remove Line Breaks',
    zh_CN: 'Remove Line Breaks',
    zh_TW: 'Remove Line Breaks',
    ja: 'Remove Line Breaks',
  }),
  icon: Image.resolveAssetSource(require('./assets/icon.png')).uri,
  showType: 1,
  editDataTypes: [3],
});

PluginManager.registerButton(2, ['NOTE'], {
  id: BUTTON_ID_TOOLBAR_PEN_EDIT,
  name: JSON.stringify({
    en: 'Insertion or Replacement',
    zh_CN: 'Insertion or Replacement',
    zh_TW: 'Insertion or Replacement',
    ja: 'Insertion or Replacement',
  }),
  icon: Image.resolveAssetSource(require('./assets/icon.png')).uri,
  showType: 0,
  editDataTypes: [0],
});
