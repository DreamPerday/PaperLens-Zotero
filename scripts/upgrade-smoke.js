// Install the built version over an already running older version, without restarting Zotero.
if (!Zotero.DataDirectory.dir.replaceAll('\\', '/').endsWith('/output/zotero-dev/data')) {
  throw new Error('Use the isolated development profile.');
}
const previous = Zotero.PaperLens;
const entry = [...previous.views.values()].find(view => view.controller.source);
if (!entry) throw new Error('Run native-smoke.js on the previous version first.');
const reader = entry.controller.reader;
const oldVersion = previous.info.version;
const root = PathUtils.parent(PathUtils.parent(PathUtils.parent(Zotero.DataDirectory.dir)));
const manifest = await IOUtils.readJSON(PathUtils.join(root, 'addon', 'manifest.json'));
if (oldVersion === manifest.version) throw new Error('An older version must be running for the upgrade check.');
const oldStylesheet = entry.frame.contentDocument.querySelector('link').href;
const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
const install = await AddonManager.getInstallForFile(Zotero.File.pathToFile(PathUtils.join(root, 'dist', `paperlens-zotero-${manifest.version}.xpi`)));
await install.install();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async (check, message) => {
  for (let i = 0; i < 200; i++) { if (check()) return; await pause(50); }
  throw new Error(message);
};
await wait(() => Zotero.PaperLens?.info.version === manifest.version, 'Plugin upgrade did not start');
await Zotero.PaperLens.show(reader);
let next;
await wait(() => {
  next = [...Zotero.PaperLens.views.values()].find(view => view.controller.reader === reader);
  return next?.frame.contentDocument?.querySelector('.model-trigger');
}, 'New UI did not mount after upgrade');
const doc = next.frame.contentDocument;
doc.querySelector('.model-trigger').click();
await wait(() => doc.querySelector('.model-menu'), 'Upgraded model menu did not open');
const css = doc.querySelector(`link[href="ui-${manifest.version}.css"]`);
if (!css?.sheet || doc.defaultView.getComputedStyle(doc.querySelector('.model-menu')).position !== 'absolute') {
  throw new Error('Upgraded UI is using stale or missing styles');
}
doc.querySelector('.model-trigger').click();
return { from: oldVersion, to: manifest.version, oldStylesheet, newStylesheet: css.href, restarted: false, styledMenu: true };
