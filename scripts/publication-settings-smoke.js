if (!Zotero.DataDirectory.dir.replaceAll('\\', '/').endsWith('/output/zotero-dev/data')) {
  throw new Error('Use the isolated development profile.');
}
const plugin = Zotero.PaperLens;
const previous = await plugin.storage.getSettings();
const win = Zotero.getMainWindow();
const body = win.document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
body.style.cssText = 'position:fixed;left:0;top:0;width:720px;height:850px;z-index:9999;background:white;';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async (check, message) => {
  for (let i = 0; i < 120; i++) { if (await check()) return; await pause(50); }
  throw new Error(message);
};
const assert = (ok, message) => { if (!ok) throw new Error(message); };
try {
  await plugin.storage.saveSettings({ ...previous, autoPublicationLookup: true,
    wordTranslationProviderId: '', providers: previous.providers.map(provider => ({ ...provider, model: '' })) });
  win.document.documentElement.append(body);
  plugin.mountPreferences(body);
  await wait(() => body.querySelector('iframe')?.contentDocument?.querySelector('.dataset-settings'), 'Settings did not mount');
  const doc = body.querySelector('iframe').contentDocument;
  const label = [...doc.querySelectorAll('label')].find(node => node.textContent.includes('首次导入论文后自动补全'));
  const toggle = label?.querySelector('input[type=checkbox]');
  assert(toggle?.checked, 'Automatic lookup toggle must default to enabled');
  const save = [...doc.querySelectorAll('button')].find(button => button.textContent === '保存设置');
  assert(save && !save.disabled, 'Saving lookup preference must not require an AI model');
  toggle.click();
  await pause(50);
  save.click();
  await wait(async () => (await plugin.storage.getSettings()).autoPublicationLookup === false,
    'Automatic lookup toggle was not persisted');
  return { passed: ['automatic lookup setting renders enabled', 'save allowed without AI model',
    'toggle and save persists disabled state'] };
} finally {
  body.remove();
  await plugin.storage.saveSettings(previous);
}
