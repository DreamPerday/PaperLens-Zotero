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
const oldRanks = metadata.getConferenceRanks(parent);
const oldEasyScholarRanks = metadata.getEasyScholarRanks(parent);
try {
  await metadata.saveJournal(parent, 'Journal of PaperLens Testing');
  await metadata.saveQuartile(parent, 'JCR-Q1');
  await metadata.saveConferenceRanks(parent, { ccf: 'A', core: 'A*', conference: 'International Conference on Machine Learning' });
  assert(metadata.getJournal(parent) === 'Journal of PaperLens Testing', 'Journal was not saved');
  assert(metadata.getQuartile(parent) === 'JCR-Q1', 'Quartile tag was not saved');
  assert(JSON.stringify(metadata.getConferenceRanks(parent)) === JSON.stringify({
    ccf: 'A', core: 'A*', conference: 'International Conference on Machine Learning',
  }), 'Conference ranks were not saved');
  assert(Zotero.Tags.getColor(parent.libraryID, 'PaperLens/CCF-A')?.color, 'CCF tag has no Zotero color');
  assert(Zotero.Tags.getColor(parent.libraryID, 'PaperLens/CORE-A*')?.color, 'CORE tag has no Zotero color');
  await metadata.saveEasyScholarRanks(parent, { hzau: 'A', sci: 'Q1', ccf: 'A' });
  assert(JSON.stringify(metadata.getEasyScholarRanks(parent)) === JSON.stringify([
    { key: 'hzau', name: '华中农业大学', value: 'A' },
  ]), 'EasyScholar custom dataset was not saved');
  assert(Zotero.Tags.getColor(parent.libraryID, 'PaperLens/EasyScholar:hzau=A')?.color,
    'EasyScholar custom dataset tag has no Zotero color');

  const win = Zotero.getMainWindow();
  await win.ZoteroPane.selectItem(parent.id);
  await wait(() => win.document.querySelector('item-details'), 'Item details pane did not render');
  const details = win.document.querySelector('item-details');
  await details.render();
  const journalRow = () => details.querySelector('[data-custom-row-id$="-journal"]');
  const quartileRow = () => details.querySelector('[data-custom-row-id$="-quartile"]');
  const conferenceRow = () => details.querySelector('[data-custom-row-id$="-conference-rank"]');
  const easyScholarRow = () => details.querySelector('[data-custom-row-id$="-easyscholar-ranks"]');
  await wait(() => journalRow()?.querySelector('.custom-row-value') && quartileRow()?.querySelector('.custom-row-value') &&
    conferenceRow()?.querySelector('.custom-row-value') && easyScholarRow()?.querySelector('.custom-row-value'),
    'PaperLens information rows did not render');
  assert(journalRow().querySelector('.custom-row-value').value === 'Journal of PaperLens Testing',
    'Information pane shows the wrong journal');
  assert(quartileRow().querySelector('.custom-row-value').value === 'JCR Q1',
    'Information pane shows the wrong quartile');
  assert(conferenceRow().querySelector('.custom-row-value').value === 'CCF-A · CORE-A*',
    'Information pane shows the wrong conference rank');
  assert(easyScholarRow().querySelector('.custom-row-value').value === '华中农业大学: A',
    'Information pane shows the wrong EasyScholar dataset');
  const editCustomRow = async (row, value) => {
    await details.render();
    const input = row().querySelector('.custom-row-value');
    win.focus();
    input.focus();
    input._input.focus();
    await wait(() => input._input.hasAttribute('data-initial-value'), 'Custom row editor did not open');
    input._input.value = value;
    input._input.dispatchEvent(new win.Event('input', { bubbles: true }));
    input._input.dispatchEvent(new win.Event('change', { bubbles: true }));
    details.blurOpenField();
  };
  await editCustomRow(journalRow, 'Journal Updated From Pane');
  await wait(() => metadata.getJournal(parent) === 'Journal Updated From Pane', 'Journal pane change was not saved');
  await editCustomRow(quartileRow, '中科院 2区');
  await wait(() => metadata.getQuartile(parent) === 'CAS-2', 'Quartile pane change was not saved');
  await editCustomRow(conferenceRow, 'CCF-B');
  await wait(() => metadata.getConferenceRanks(parent).ccf === 'B', 'Conference rank change was not saved');
  const publicationSection = () => [...details.querySelectorAll('item-pane-custom-section')]
    .find(node => String(node.dataset.pane || '').endsWith('-paperlens-publication'));
  await wait(() => publicationSection(), 'Publication information section is missing');
  publicationSection().open = true;
  await publicationSection().render();
  await wait(() => publicationSection().querySelector('button')?.textContent.includes('在线查询'),
    'Online publication query button is missing');
  assert([...publicationSection().querySelectorAll('span')].some(node => node.textContent === '华中农业大学: A'),
    'Publication section is missing the EasyScholar dataset badge');
  return { passed: ['journal field', 'JCR quartile tag', 'CAS quartile tag', 'CCF/CORE rank tags',
    'EasyScholar custom dataset tag and name', 'colored tag assignment', 'information pane rendering',
    'publication section and query button', 'information pane editing'] };
} finally {
  await metadata.saveJournal(parent, oldJournal);
  await metadata.saveQuartile(parent, oldQuartile);
  await metadata.saveConferenceRanks(parent, oldRanks);
  await metadata.saveEasyScholarRanks(parent,
    Object.fromEntries(oldEasyScholarRanks.map(rank => [rank.key, rank.value])));
}
