if (!Zotero.DataDirectory.dir.replaceAll('\\', '/').endsWith('/output/zotero-dev/data')) {
  throw new Error('Use the isolated development profile.');
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async (check, message) => {
  for (let index = 0; index < 120; index++) {
    if (check()) return;
    await pause(50);
  }
  throw new Error(message);
};
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const plugin = Zotero.PaperLens;
const readerController = [...plugin.views.values()].find(view => view.controller.source)?.controller;
assert(readerController, 'A synthetic reader must be open for the settings refresh check');
const previous = await plugin.storage.getSettings();
await plugin.storage.saveSettings({
  ...previous,
  easyScholarShowAllDatasets: false,
  easyScholarDatasetKeys: ['HZAU'],
  easyScholarDatasetCatalog: [
    { key: 'HZAU', name: '华中农业大学' },
    { key: 'UIBE', name: 'UIBE' },
  ],
});
const win = Zotero.getMainWindow();
const body = win.document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
body.style.cssText = 'position:fixed;left:0;top:0;width:720px;height:850px;z-index:9999;background:white;';
win.document.documentElement.append(body);
try {
  plugin.mountPreferences(body);
  await wait(() => body.querySelector('iframe')?.contentDocument?.querySelector('.dataset-settings'),
    'EasyScholar dataset settings did not render');
  const doc = body.querySelector('iframe').contentDocument;
  const fieldset = doc.querySelector('.dataset-settings');
  const toggle = fieldset.querySelector('input[type=checkbox]');
  const labels = [...fieldset.querySelectorAll('.dataset-choice')].map(label => label.textContent.trim());
  const inputs = [...fieldset.querySelectorAll('input')];
  const keyInput = inputs.find(input => input.value === 'HZAU');
  assert(toggle?.checked === false, 'Show-all dataset toggle has the wrong state');
  assert(labels.includes('华中农业大学') && labels.includes('对外经济贸易大学分级'),
    'Discovered EasyScholar datasets are missing from settings');
  assert(keyInput, 'Selected HZAU dataset is missing from settings');
  await plugin.storage.rememberEasyScholarDatasets([{ key: 'NEWDB', name: '新发现期刊等级' }]);
  await readerController.bridge.saveSettings(await readerController.bridge.getSettings());
  await wait(() => [...fieldset.querySelectorAll('.dataset-choice')]
    .some(label => label.textContent.trim() === '新发现期刊等级'), 'Newly discovered dataset did not appear live');
  return { passed: ['dataset settings rendered', 'show-all toggle', 'catalog choices',
    'selected HZAU value', 'new dataset appeared without reopening settings'] };
} finally {
  body.remove();
  await plugin.storage.saveSettings(previous);
}
