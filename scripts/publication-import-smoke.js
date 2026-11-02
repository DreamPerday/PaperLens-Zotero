// Run through command.mjs in the isolated profile. No live lookup or private paper is used.
if (!Zotero.DataDirectory.dir.replaceAll('\\', '/').endsWith('/output/zotero-dev/data')) {
  throw new Error('Use the isolated development profile.');
}
const plugin = Zotero.PaperLens;
if (plugin?.info.version !== '0.3.9') throw new Error('Expected PaperLens 0.3.9');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const wait = async (check, message) => {
  for (let i = 0; i < 240; i++) { if (check()) return; await pause(50); }
  throw new Error(message);
};
const passed = [];
const originalSettings = await plugin.storage.getSettings();
const originalRequest = Zotero.HTTP.request;
const title = 'PaperLens Synthetic Automatic Import';
const rankRetryTitle = 'PaperLens Synthetic Empty Rank Retry';
const venue = 'Journal of PaperLens Testing';
const calls = { metadata: 0, rank: 0, rankRetryMetadata: 0, rankRetry: 0 };
let rankRetryMode = false;
const created = [];
const directory = PathUtils.parent(Zotero.DataDirectory.dir);
const win = Zotero.getMainWindow();
const originalSize = [win.outerWidth, win.outerHeight];
let parent;
try {
  await plugin.storage.saveSettings({ ...originalSettings, autoPublicationLookup: true,
    easyScholarApiKey: 'paperlens-synthetic-key', easyScholarShowAllDatasets: true });
  Zotero.HTTP.request = async (_method, input) => {
    const url = new URL(input);
    if (url.hostname === 'api.openalex.org') {
      const query = url.searchParams.get('search');
      if (query === title) calls.metadata++;
      if (query === rankRetryTitle) calls.rankRetryMetadata++;
      const empty = query === title && calls.metadata === 1;
      return { response: { results: empty ? [] : [{ title: query, doi: '', type: 'article',
        publication_year: 2026, primary_location: { source: { display_name: venue, type: 'journal' } } }] } };
    }
    if (url.hostname === 'api.crossref.org') return { response: { message: { items: [] } } };
    if (url.hostname.endsWith('easyscholar.cc')) {
      if (rankRetryMode) {
        if (++calls.rankRetry === 1) return { response: { code: 200, data: { officialRank: { all: {} } } } };
      } else calls.rank++;
      return { response: { code: 200, data: {
        officialRank: { all: { sci: 'Q1', sciUp: '2区', ccf: 'A' } },
        customRank: { rank: ['hzau-test&&&2'], rankInfo: [
          { uuid: 'hzau-test', abbName: 'hzau', twoRankText: 'A' },
        ] },
      } } };
    }
    throw new Error('Unexpected network request in synthetic test: ' + url.hostname);
  };
  parent = new Zotero.Item('journalArticle');
  parent.libraryID = Zotero.Libraries.userLibraryID;
  parent.setField('title', title);
  await parent.saveTx();
  created.push(parent.id);
  // Adding an attachment produces another item notification but must not queue the parent twice.
  const attachment = await Zotero.Attachments.importFromFile({
    file: PathUtils.join(directory, 'synthetic-paper.pdf'), parentItemID: parent.id,
  });
  created.push(attachment.id);
  await wait(() => plugin.paperMetadata.getJournal(parent) === venue
    && plugin.paperMetadata.getEasyScholarRanks(parent).some(rank => rank.key === 'hzau'),
  'Newly imported paper was not automatically populated');
  assert(parent.getField('date') === '2026', 'Year not filled');
  assert(calls.metadata === 2, 'Expected exactly one retry after empty first lookup: ' + calls.metadata);
  assert(calls.rank === 1, 'Duplicate parent/attachment lookup: ' + calls.rank);
  assert(parent.getTags().some(tag => tag.tag === 'PaperLens/JCR-Q1'), 'JCR missing');
  assert(parent.getTags().some(tag => tag.tag === 'PaperLens/CAS-2'), 'CAS missing');
  passed.push('new parent + PDF attachment automatically filled', 'empty first metadata lookup retried exactly once',
    'JCR/CAS/CCF/custom dataset tags populated');

  // An existing paper edit must not start a new request.
  parent.setField('abstractNote', 'Synthetic edit after import');
  await parent.saveTx();
  await pause(2300);
  assert(calls.metadata === 2, 'Editing an existing item queried again');
  passed.push('later edits do not retrigger lookup');

  const columns = Zotero.ItemTreeManager.getCustomColumns('main', { pluginID: plugin.info.id });
  assert(columns.length === 3, 'Three library columns must be registered');
  const column = kind => columns.find(col => col.dataKey.endsWith('paperlens-' + kind));
  const data = kind => Zotero.ItemTreeManager.getCustomCellData(parent, column(kind).dataKey);
  assert(data('publication') === venue, 'Publication column mismatch');
  assert(data('year') === '2026', 'Year column mismatch');
  assert(data('ranks').includes('JCR Q1') && data('ranks').includes('中科院 2区') && data('ranks').includes('CCF-A')
    && data('ranks').includes('华中农业大学: A'), 'Rank column mismatch');
  assert(!Zotero.ItemTreeManager.getCustomCellData(attachment, column('ranks').dataKey), 'Attachment should not duplicate parent ranks');
  passed.push('three native columns share the saved metadata, including custom datasets');

  win.Zotero_Tabs.select('zotero-pane');
  await win.ZoteroPane.selectItem(parent.id);
  const doc = win.document;
  await wait(() => columns.every(col => [...doc.querySelectorAll('.cell')].some(cell =>
    cell.classList.contains(col.dataKey))), 'Custom cells did not appear in library table');
  for (const kind of ['ranks']) {
    const cell = [...doc.querySelectorAll('.cell')].find(cell => cell.classList.contains(column(kind).dataKey)
      && cell.title === data(kind));
    assert(cell?.querySelector('span')?.style.backgroundColor, kind + ' badges did not render');
  }
  const narrowTitle = doc.querySelector('.virtualized-table-header .cell.title');
  assert(narrowTitle?.getBoundingClientRect().width > 100, 'New columns squeezed out the paper title');
  passed.push('title stays visible in a narrow library window');
  win.resizeTo(1440, 850);
  await pause(300);
  const canvas = doc.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
  canvas.width = win.innerWidth; canvas.height = win.innerHeight;
  canvas.getContext('2d').drawWindow(win, 0, 0, canvas.width, canvas.height, '#ffffff');
  const screenshot = PathUtils.join(directory, 'publication-columns-0.3.9.png');
  await IOUtils.write(screenshot, Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), c => c.charCodeAt(0)));
  passed.push('native library cells visible with colored badges');

  rankRetryMode = true;
  const rankRetryPaper = new Zotero.Item('journalArticle');
  rankRetryPaper.libraryID = Zotero.Libraries.userLibraryID;
  rankRetryPaper.setField('title', rankRetryTitle);
  await rankRetryPaper.saveTx();
  created.push(rankRetryPaper.id);
  await wait(() => rankRetryPaper.getTags().some(tag => tag.tag === 'PaperLens/JCR-Q1'),
    'Empty rank response was not retried');
  assert(calls.rankRetryMetadata === 2 && calls.rankRetry === 2, 'Rank lookup was not retried exactly once');
  passed.push('empty EasyScholar ranks retried once after successful metadata lookup');

  const tree = win.ZoteroPane.itemsView;
  const rankIndex = tree._columns.findIndex(col => col.dataKey === column('ranks').dataKey);
  await tree._handleColumnSort(rankIndex, 1);
  assert(tree.getSortField() === column('ranks').dataKey, 'Rank column did not sort');
  await plugin.paperMetadata.saveConferenceRanks(parent, { ccf: 'B' });
  await wait(() => [...doc.querySelectorAll('.cell')].some(cell => cell.classList.contains(column('ranks').dataKey)
    && cell.title.includes('CCF-B')), 'Changed rank did not refresh in the library');
  passed.push('native sorting and changed metadata refresh work');

  await plugin.storage.saveSettings({ ...await plugin.storage.getSettings(), autoPublicationLookup: false });
  const disabled = new Zotero.Item('journalArticle');
  disabled.libraryID = Zotero.Libraries.userLibraryID;
  disabled.setField('title', 'PaperLens Disabled Automatic Import');
  await disabled.saveTx();
  created.push(disabled.id);
  await pause(2400);
  assert(!plugin.paperMetadata.getJournal(disabled) && calls.metadata === 2, 'Disabled import made a request');
  passed.push('automatic lookup setting disables new requests');
  const report = { version: plugin.info.version, calls, columns: columns.map(col => ({ key: col.dataKey, label: col.label })), screenshot, passed };
  await IOUtils.writeJSON(PathUtils.join(directory, 'publication-import-result.json'), report);
  return report;
} finally {
  win.resizeTo(...originalSize);
  Zotero.HTTP.request = originalRequest;
  await plugin.storage.saveSettings(originalSettings);
  if (created.length) await Zotero.Items.erase(created);
}
