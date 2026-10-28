// Live online lookup check. Requires network access to OpenAlex, Crossref and arXiv.
if (!Zotero.DataDirectory.dir.replaceAll('\\', '/').endsWith('/output/zotero-dev/data')) {
  throw new Error('Use the isolated development profile.');
}
const title = 'EfficientNet: Rethinking Model Scaling for Convolutional Neural Networks';
const fake = {
  itemTypeID: Zotero.ItemTypes.getID('journalArticle'),
  isRegularItem: () => true,
  isAttachment: () => false,
  getField: name => name === 'title' ? title : '',
  getTags: () => [],
};
const result = await Zotero.PaperLens.paperOnline.lookupPublication(fake);
const assert = (value, message) => { if (!value) throw new Error(message); };
assert(result.type === 'conference', 'Online lookup did not identify a conference paper: ' + JSON.stringify(result));
assert(/International Conference on Machine Learning/i.test(result.venue), 'Online lookup did not find ICML');
assert(result.ccf === 'A', 'CCF-A classification was not resolved');
assert(result.core === 'A*', 'CORE-A* classification was not resolved');
const temp = new Zotero.Item('journalArticle');
temp.libraryID = Zotero.Libraries.userLibraryID;
temp.setField('title', title);
await temp.saveTx();
try {
  await Zotero.PaperLens.paperOnline.applyPublicationLookup(temp, result);
  assert(Zotero.ItemTypes.getName(temp.itemTypeID) === 'conferencePaper', 'Confirmed lookup did not update item type');
  assert(/International Conference on Machine Learning/i.test(temp.getField('proceedingsTitle')),
    'Confirmed lookup did not fill the conference venue');
  const tags = temp.getTags().map(entry => entry.tag);
  assert(tags.includes('PaperLens/CCF-A'), 'CCF-A tag was not written');
  assert(tags.includes('PaperLens/CORE-A*'), 'CORE-A* tag was not written');
} finally {
  await temp.eraseTx();
}
return {
  title: result.title, venue: result.venue, year: result.year, source: result.source,
  ccf: result.ccf, core: result.core,
  passed: ['OpenAlex title match', 'arXiv conference metadata', 'CCF rank', 'CORE rank',
    'confirmed item type update', 'confirmed venue and tag write'],
};
