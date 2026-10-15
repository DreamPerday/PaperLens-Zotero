import { normalizeStructured } from './reading/normalize';
import type { Location, Message, Source } from './types';
import type { Storage } from './storage';

export const identityFor = (item: any) => `${item.libraryID}_${item.key}`;

export async function extractSource(item: any, storage: Storage, force = false): Promise<Source> {
  const identity = identityFor(item);
  const version = await item.attachmentHash;
  const cached = !force && await storage.source(identity);
  if (cached && cached.version === version) return cached;
  if (!Zotero.SDT?.getReader) throw new Error('当前 Zotero 版本缺少结构化文本接口，请升级到 Zotero 10.0.6 或更新版本。');
  const pack = await Zotero.SDT.getReader(item.id, { isPriority: true });
  if (!pack) throw new Error('未能读取 PDF。请确认文件已下载，且已在 Zotero 中解锁加密文件。');
  const structure = await pack.materialize();
  const blocks = normalizeStructured(structure);
  if (!blocks.length) throw new Error('未读取到可用文字。扫描件需要先获得文字层；你仍可使用 Zotero 阅读原文。');
  const parent = item.parentID ? await Zotero.Items.getAsync(item.parentID) : null;
  const source: Source = { identity, version, itemID: item.id,
    title: parent?.getField('title') || item.getField('title') || 'PDF', blocks,
    pageCount: structure.catalog?.pages?.length || Math.max(...blocks.map(b => b.location.pageIndex)) + 1,
  };
  await storage.saveSource(source);
  return source;
}

export function findReader(doc: Document, itemID?: number): any {
  const details = doc.querySelector('item-details[data-tab-id]:not([hidden])') as any;
  const win = doc.defaultView as any;
  const selected = win?.Zotero_Tabs?.selectedID;
  const reader = selected && Zotero.Reader.getByTabID(selected);
  if (reader && (!itemID || reader.itemID === itemID)) return reader;
  return Zotero.Reader._readers.find((r: any) => (!itemID || r.itemID === itemID) &&
    (r._window === win || r._iframe?.ownerDocument === doc || r.tabID === details?.tabID));
}

export async function openReader(itemID: number) {
  let reader = await Zotero.Reader.open(itemID);
  // Restoring an unloaded tab is asynchronous and Zotero returns no instance yet.
  for (let i = 0; !reader && i < 100; i++) {
    await Zotero.Promise.delay(50);
    reader = findReader(Zotero.getMainWindow().document, itemID);
  }
  if (!reader) throw new Error('阅读器尚未加载，请稍后重新打开 PaperLens。');
  await reader._initPromise;
  return reader;
}

export function readingPosition(reader: any) {
  const view = reader._internalReader._lastView;
  const pdf = view._iframeWindow.PDFViewerApplication.pdfViewer;
  const first = pdf._getVisiblePages().first;
  const container = view._iframeWindow.document.getElementById('viewerContainer');
  const point = first?.view.getPagePoint(container.scrollLeft - first.x, container.scrollTop - first.y);
  return first ? { dest: [first.id - 1, { name: 'XYZ' }, point[0], point[1], pdf.currentScale] } :
    { pageIndex: reader._internalReader._state.primaryViewState?.pageIndex ?? 0 };
}

export async function navigateReader(reader: any, location: object) {
  // Zotero's public navigate() drops the options and returns before navigation.
  // An immediate jump keeps source links usable in background and split views too.
  await reader._internalReader.navigate(
    Components.utils.cloneInto(location, reader._iframeWindow),
    Components.utils.cloneInto({ behavior: 'instant' }, reader._iframeWindow));
}

export function pageLink(item: any, location: Location) {
  const library = Zotero.Libraries.get(item.libraryID);
  const prefix = library.libraryType === 'group' ? `groups/${library.libraryTypeID}` : 'library';
  return `zotero://open-pdf/${prefix}/items/${item.key}?page=${location.pageIndex + 1}${location.annotationID ? `&annotation=${location.annotationID}` : ''}`;
}

const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

export async function saveNote(item: any, message: Message, question: Message | undefined, source: Source) {
  const note = new Zotero.Item('note');
  note.libraryID = item.libraryID;
  if (item.parentID) note.parentID = item.parentID;
  const references = source.blocks.filter(block => message.sourceIds?.includes(block.id));
  const citedIDs = new Set([...message.content.matchAll(/#source-(b\d+)/g)].map(match => match[1]));
  const citations = references.filter(block => citedIDs.has(block.id));
  const text = escape(message.content).replace(/\[([^\]]+)\]\(#source-(b\d+)\)/g, (_match, label, id) => {
    const block = citations.find(b => b.id === id);
    return block ? `<a href="${escape(pageLink(item, block.location))}">${label}</a>` : label;
  });
  note.setNote(`<div data-schema-version="9"><h1>PaperLens · ${escape(source.title)}</h1>` +
    (question ? `<h2>问题</h2><p>${escape(question.content)}</p>` : '') +
    (message.quote ? `<blockquote>${escape(message.quote.text)}</blockquote>` : '') +
    `<h2>解读</h2><p>${text.replace(/\n/g, '<br/>')}</p>` +
    (citations.length ? `<h2>原文依据</h2>${citations.map(b => `<p><a href="${escape(pageLink(item, b.location))}">第${escape(b.pageLabel)}页 · ${b.id}</a>：${escape(b.text.slice(0, 550))}</p>`).join('')}` : '') +
    `<p><a href="${escape(pageLink(item, { pageIndex: message.quote?.location.pageIndex || 0 }))}">打开来源 PDF</a></p>` +
    `<p>模型：${escape(message.model || '')} · ${escape(message.createdAt)} · ${escape(message.range || '')}</p></div>`);
  await note.saveTx();
  return note.id as number;
}
