// Verify journal and quartile metadata through Zotero's item API and information pane.
if (!Zotero.DataDirectory.dir.replaceAll('\\', '/').endsWith('/output/zotero-dev/data')) {
  throw new Error('Use the isolated development profile.');
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async (check, message) => {
  for (let index = 0; index < 120; index++) { if (check()) return; await pause(50); }
  throw new Error(message);
};
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const directory = PathUtils.parent(Zotero.DataDirectory.dir);
const seed = await IOUtils.readJSON(PathUtils.join(directory, 'fixture-state.json'));
const parent = Zotero.Items.get(seed.parentID);
const metadata = Zotero.PaperLens.paperMetadata;
const oldJournal = metadata.getJournal(parent);
const oldQuartile = metadata.getQuartile(parent);
try {
  await metadata.saveJournal(parent, 'Journal of PaperLens Testing');
  await metadata.saveQuartile(parent, 'JCR-Q1');
  assert(metadata.getJournal(parent) === 'Journal of PaperLens Testing', 'Journal was not saved');
  assert(metadata.getQuartile(parent) === 'JCR-Q1', 'Quartile tag was not saved');

  const win = Zotero.getMainWindow();
  await win.ZoteroPane.selectItem(parent.id);
  await wait(() => win.document.querySelector('item-details'), 'Item details pane did not render');
  const details = win.document.querySelector('item-details');
  await details.render();
  const journalRow = () => details.querySelector('[data-custom-row-id$="-journal"]');
  const quartileRow = () => details.querySelector('[data-custom-row-id$="-quartile"]');
  await wait(() => journalRow()?.querySelector('.custom-row-value') && quartileRow()?.querySelector('.custom-row-value'),
    'PaperLens information rows did not render');
  const input = journalRow().querySelector('.custom-row-value');
  const quartile = quartileRow().querySelector('.custom-row-value');
  assert(input.value === 'Journal of PaperLens Testing', 'Information pane shows the wrong journal');
  assert(quartile.value === 'JCR Q1', 'Information pane shows the wrong quartile');
  input.focus(); input._input.value = 'Journal Updated From Pane';
  input._input.dispatchEvent(new win.Event('input', { bubbles: true })); input.blur();
  quartile.focus(); quartile._input.value = '中科院 2区';
  quartile._input.dispatchEvent(new win.Event('input', { bubbles: true })); quartile.blur();
  await wait(() => metadata.getJournal(parent) === 'Journal Updated From Pane' && metadata.getQuartile(parent) === 'CAS-2',
    'Information pane changes were not saved');
  return { passed: ['journal field', 'JCR quartile tag', 'CAS quartile tag', 'information pane rendering', 'information pane editing'] };
} finally {
  await metadata.saveJournal(parent, oldJournal);
  await metadata.saveQuartile(parent, oldQuartile);
}
