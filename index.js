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
  BUTTON_ID_NOTE_MANUSCRIPT,
  BUTTON_ID_TEXTBOX_TOOLS,
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
