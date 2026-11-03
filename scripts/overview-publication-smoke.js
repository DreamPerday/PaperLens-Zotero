// Regression checks use synthetic text, mocked AI/metadata and the isolated Zotero profile.
if (!Zotero.DataDirectory.dir.replaceAll('\\', '/').endsWith('/output/zotero-dev/data')) {
  throw new Error('Use the isolated development profile.');
}
const plugin = Zotero.PaperLens;
const entry = [...plugin.views.values()].find(view => view.controller.source);
if (!entry) throw new Error('Open the synthetic reader first.');
const c = entry.controller, reader = c.reader, win = Zotero.getMainWindow();
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const wait = async (check, message) => {
  for (let i = 0; i < 160; i++) {
    if (check()) return;
    await Zotero.Promise.delay(50);
  }
  throw new Error(message);
};
const previousSettings = await plugin.storage.getSettings();
const source = c.source, previousMessages = [...c.session.messages];
const previousTask = c.state.task, previousQuote = c.state.quote;
const originalStream = plugin.ai.stream;
const originalSelect = win.ZoteroPane.selectItem;
let testPlugin, hostStopped = false;
const paper = Zotero.Items.get(c.item.parentID);
const fields = Object.fromEntries(['title', 'publicationTitle', 'DOI', 'date'].map(name => [name, paper.getField(name)]));
const originalTags = paper.getTags();
const passed = [];
try {
  await c.bridge.saveSettings({ ...previousSettings, contextChars: 4000, autoPublicationLookup: false,
    easyScholarApiKey: 'synthetic-only', easyScholarShowAllDatasets: false, easyScholarDatasetKeys: ['CCF'],
    providers: previousSettings.providers.map(provider => provider.id === previousSettings.activeProviderId
      ? { ...provider, baseURL: 'https://synthetic.invalid/v1', apiKey: '', model: 'synthetic' } : provider),
  });
  const block = (id, section, text, page, kind = 'paragraph') => ({
    id, section, text, pageLabel: String(page), kind, location: { pageIndex: page - 1 },
  });
  c.source = { ...source, pageCount: 5, blocks: [
    block('b1', 'Abstract', 'Abstract. We study retrieval with a fixed generator.', 1),
    block('b2', 'Methods', 'Controlled generator and corpus. '.repeat(190), 2),
    block('b3', 'Results', 'Evidence coverage improves under these tested conditions.', 3),
    block('b4', 'Results', 'Table 1\nCondition | Coverage\nBaseline | 62%\nRetrieval | 74%', 3, 'table'),
    block('b5', 'Conclusion', 'Conclusion. The result is conditional, not a universal accuracy claim.', 4),
    block('b6', 'References', 'References. Synthetic citation. '.repeat(100), 5),
  ] };
  const requests = [];
  let segments = 0;
  plugin.ai.stream = async (_provider, messages, onText) => {
    requests.push(messages);
    const prompt = messages.at(-1).content;
    if (prompt.startsWith('全文第 ')) {
      segments++;
      onText(`MAP_NOTE_${segments} [依据](#source-b1) ` + '分段实验笔记。'.repeat(180));
    } else if (prompt.includes('合并以下片段笔记')) {
      onText([...new Set(prompt.match(/MAP_NOTE_\d+/g) || [])].join(' ') + ' [方法](#source-b2)');
    } else {
      onText('### 结果\n覆盖率由62%到74%，结论只适用于本实验。[表格](#source-b4) [结论](#source-b5)');
    }
  };
  await c.bridge.send('生成全文概览', 'overview');
  const answer = c.session.messages.at(-1);
  assert(answer.status === 'complete', 'Overview failed: ' + answer.error);
  const maps = requests.filter(messages => messages.at(-1).content.startsWith('全文第 '));
  assert(maps.length > 1, 'Long paper was not processed in segments');
  for (const block of c.source.blocks) {
    const pieces = maps.flatMap(messages => messages.at(-1).content.split(/\n\n(?=\[b)/))
      .filter(part => part.includes(`[${block.id} |`))
      .map(part => part.slice(part.indexOf(']\n') + 2));
    assert(pieces.join('') === block.text, `Raw block ${block.id} was omitted or truncated`);
  }
  const final = requests.at(-1);
  assert(final[0].content.includes('全部 6 段，文字覆盖 5/5 页'), 'Final scope is not based on full extraction');
  assert(final[0].content.includes('摘要：已读取') && final[0].content.includes('结论：已读取'), 'Key section coverage missing');
  for (let i = 1; i <= segments; i++) assert(final[1].content.includes(`MAP_NOTE_${i}`), 'A segment summary was lost');
  assert(final[1].content.includes('Baseline | 62%\nRetrieval | 74%'), 'Raw table cells are missing from final synthesis');
  assert(final[1].content.includes('Abstract. We study retrieval') && final[1].content.includes('Conclusion. The result is conditional'),
    'Abstract/conclusion evidence missing from final synthesis');
  passed.push('all long-paper text processed', 'all segment notes reach synthesis', 'full coverage recorded',
    'abstract/table/conclusion originals reach synthesis');

  c.source = source;
  c.session.messages = previousMessages;
  c.bridge.setTask(previousTask);
  c.state.quote = previousQuote;
  c.emit();
  await plugin.storage.saveSession(c.session);

  paper.setField('DOI', '10.1000/synthetic-ccf');
  await paper.saveTx();
  const title = paper.getField('title');
  let confirms = 0, selections = 0;
  const queriedHosts = [];
  const json = value => ({ ok: true, status: 200, json: async () => value });
  const fixtureFetch = async input => {
    const url = String(input);
    queriedHosts.push(url.split('/')[2]);
    if (url.includes('api.crossref.org/works/')) return json({ message: {
      DOI: '10.1000/synthetic-ccf', title: [title], type: 'journal-article',
      'container-title': ['Synthetic CCF Journal'], published: { 'date-parts': [[2026]] },
    } });
    if (url.includes('api.openalex.org')) return json({ results: [] });
    if (url.includes('easyscholar.cc')) return json({ code: 200, data: { officialRank: {
      all: { sci: 'Q1', sciBase: '工程技术2区', sciUp: '计算机科学1区', ccf: 'A' },
    } } });
    return json({ message: { items: [] } });
  };
  // Load the built host with fixture services; keep native Zotero UI and item APIs.
  await plugin.stop(); hostStopped = true;
  const fixtureZotero = Object.create(Zotero);
  Object.defineProperty(fixtureZotero, 'HTTP', { value: {
    request: async (_method, url) => ({ response: await (await fixtureFetch(url)).json() }),
  } });
  const scope = Components.utils.Sandbox(Services.scriptSecurityManager.getSystemPrincipal(), {
    sandboxName: 'PaperLens synthetic query regression', wantXrays: false,
  });
  Object.assign(scope, { Zotero: fixtureZotero, IOUtils, PathUtils,
    Services: { logins: Services.logins, prompt: { confirm: () => { confirms++; return true; } } },
    fetch: fixtureFetch, XMLHttpRequest, TextDecoder, TextEncoder, URL, setTimeout, clearTimeout });
  Services.scriptloader.loadSubScript(plugin.info.rootURI + 'content/host.js', scope);
  testPlugin = scope.PaperLensHost.createPlugin(plugin.info);
  await testPlugin.start();
  for (const window of Zotero.getMainWindows()) testPlugin.addWindow(window);
  await testPlugin.show(reader);
  const fixtureLookup = await testPlugin.paperOnline.lookupPublication(paper, undefined, 'synthetic-only', ['CCF'], false)
    .catch(error => { throw new Error(error.message + ': fixture calls ' + JSON.stringify(queriedHosts)); });
  assert(fixtureLookup.ccf === 'A', 'Fixture host lookup did not resolve CCF');
  queriedHosts.length = 0;
  win.ZoteroPane.selectItem = function (...args) { selections++; return originalSelect.apply(this, args); };
  win.Zotero_Tabs.select(reader.tabID);
  const details = [...win.document.querySelectorAll('item-details')].find(node => node.dataset.tabId === reader.tabID);
  await details.render();
  const section = [...details.querySelectorAll('item-pane-custom-section')]
    .find(node => String(node.dataset.pane).endsWith('-paperlens-publication'));
  assert(section, 'Publication section missing in reader');
  section.open = true;
  await section.render();
  await wait(() => [...section.querySelectorAll('button')].some(button => button.textContent.includes('在线查询')), 'Query button missing');
  const button = [...section.querySelectorAll('button')].find(button => button.textContent.includes('在线查询'));
  const view = reader._internalReader._primaryView;
  const container = view._iframeWindow.document.getElementById('viewerContainer');
  const scrollTop = container.scrollTop;
  button.click();
  await wait(() => confirms === 1 && testPlugin.paperMetadata.getConferenceRanks(paper).ccf === 'A', 'CCF rank not saved from query')
    .catch(error => { throw new Error(error.message + ': ' + JSON.stringify({ confirms, queriedHosts, section: section.textContent.slice(-600) })); });
  await wait(() => !button.disabled, 'Manual query did not finish');
  await wait(() => [...section.querySelectorAll('span')].some(node => node.textContent === 'CCF-A'), 'Reader CCF badge missing');
  assert(win.Zotero_Tabs.selectedID === reader.tabID, 'Manual query switched away from the PDF');
  assert(selections === 0, 'Manual query selected a library item');
  assert(Math.abs(container.scrollTop - scrollTop) < 3, 'Manual query changed PDF scroll position');
  passed.push('selected CCF saved for journal', 'CCF badge visible in reader',
    'manual query stays in reader', 'manual query retains PDF position');
  return { version: plugin.info.version, passed, segmentRequests: segments };
} finally {
  plugin.ai.stream = originalStream;
  win.ZoteroPane.selectItem = originalSelect;
  if (testPlugin) await testPlugin.stop();
  c.source = source;
  c.session.messages = previousMessages;
  c.state.task = previousTask; c.session.task = previousTask;
  c.state.quote = previousQuote; c.session.quote = previousQuote;
  await plugin.storage.saveSession(c.session);
  for (const [name, value] of Object.entries(fields)) paper.setField(name, value);
  paper.setTags(originalTags);
  await paper.saveTx();
  await plugin.storage.saveSettings(previousSettings);
  if (hostStopped) {
    await plugin.start();
    for (const window of Zotero.getMainWindows()) plugin.addWindow(window);
    await plugin.show(reader);
  }
  c.emit();
}
