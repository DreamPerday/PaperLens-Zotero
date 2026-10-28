import { AIClient } from './ai/client';
import { ReaderController } from './controller';
import {
  conferenceRankLabel, getConferenceRanks, getJournal, getJournalRanks, getQuartile, journalRanksLabel, parseConferenceRank,
  parseJournalRanksInput, publicationField, quartileLabel, resolvePaperItem, saveConferenceRanks, saveJournal,
  saveJournalRanks, saveQuartile, tagColor,
} from './paper-metadata';
import { applyPublicationLookup, lookupPublication } from './paper-online';
import { Storage } from './storage';
import { TranslationPopups } from './translation/popup';
import { findReader, openReader } from './zotero-adapter';
import type { Bridge, Quote } from './types';

const HTML = 'http://www.w3.org/1999/xhtml';

export function createPlugin(info: { id: string; version: string; rootURI: string }) {
  const sidebarURL = `chrome://paperlens/content/sidebar.xhtml?v=${encodeURIComponent(info.version)}`;
  const storage = new Storage();
  const ai = new AIClient();
  const views = new Map<HTMLElement, { controller: ReaderController; frame: HTMLIFrameElement; unmount?: () => void }>();
  const preferenceFrames = new Map<HTMLIFrameElement, () => void>();
  const windows = new Map<any, () => void>();
  const standalone = new Map<any, { panel: HTMLElement; splitter: HTMLElement; entry: ReturnType<typeof mount>; cleanup: () => void }>();
  let paneID: string;
  let journalRowID: string;
  let quartileRowID: string;
  let conferenceRowID: string;
  let publicationPaneID: string;
  const notify = () => {
    for (const { controller } of views.values()) {
      controller.emit();
      void controller.refreshSettings().catch(error => Zotero.logError(error));
    }
  };
  const translations = new TranslationPopups(sidebarURL, storage, ai, show, notify);

  async function mountPublicationSection(body: HTMLElement, item: any) {
    const paper = resolvePaperItem(item);
    if (!paper) { body.replaceChildren(); return; }
    const doc = body.ownerDocument;
    (doc as any).l10n?.addResourceIds(['paperlens.ftl']);
    let labels = ['在线查询出版信息', '期刊 / 出版物', 'JCR / 中科院分区', '会议等级（CCF / CORE）', '未设置', '查询中…', '保存失败'];
    try {
      labels = await (doc as any).l10n.formatValues([
        { id: 'paperlens-publication-query' }, { id: 'paperlens-journal-label' },
        { id: 'paperlens-quartile-label' }, { id: 'paperlens-conference-rank-label' },
        { id: 'paperlens-quartile-none' }, { id: 'paperlens-publication-querying' },
        { id: 'paperlens-metadata-error' },
      ]);
    } catch { /* Use fallback labels. */ }
    if (!body.isConnected) return;
    const container = doc.createElementNS(HTML, 'div') as HTMLDivElement;
    container.style.cssText = 'display:grid;gap:12px;padding:8px 2px;min-width:0;';
    const render = () => {
      const venue = getJournal(paper) || labels[4];
      const quartiles = getJournalRanks(paper);
      const ranks = getConferenceRanks(paper);
      const section = (title: string, content: Node | string) => {
        const row = doc.createElementNS(HTML, 'div') as HTMLDivElement;
        row.style.cssText = 'display:grid;gap:5px;';
        const heading = doc.createElementNS(HTML, 'strong') as HTMLElement;
        heading.textContent = title;
        heading.style.cssText = 'font-size:12px;';
        const value = doc.createElementNS(HTML, 'div') as HTMLDivElement;
        value.style.cssText = 'font-size:12px;line-height:1.7;overflow-wrap:anywhere;';
        if (typeof content === 'string') value.textContent = content;
        else value.append(content);
        row.append(heading, value);
        return row;
      };
      const badge = (text: string, value: string) => {
        const node = doc.createElementNS(HTML, 'span') as HTMLSpanElement;
        node.textContent = text;
        node.style.cssText = `display:inline-block;margin:0 6px 4px 0;padding:2px 8px;border-radius:999px;` +
          `background:${tagColor(value)};color:#fff;font-size:11px;font-weight:600;`;
        return node;
      };
      const rankWrap = doc.createElementNS(HTML, 'div') as HTMLDivElement;
      if (quartiles.jcr) rankWrap.append(badge(quartileLabel(quartiles.jcr), quartiles.jcr));
      if (quartiles.cas) rankWrap.append(badge(quartileLabel(quartiles.cas), quartiles.cas));
      if (ranks.ccf) rankWrap.append(badge(`CCF-${ranks.ccf}`, `CCF-${ranks.ccf}`));
      if (ranks.core) rankWrap.append(badge(`CORE-${ranks.core}`, `CORE-${ranks.core}`));
      if (!rankWrap.childNodes.length) rankWrap.textContent = labels[4];
      const query = doc.createElementNS(HTML, 'button') as HTMLButtonElement;
      query.textContent = labels[0];
      query.style.cssText = 'justify-self:start;';
      const status = doc.createElementNS(HTML, 'span') as HTMLSpanElement;
      status.setAttribute('role', 'status');
      status.style.cssText = 'font-size:11px;color:var(--fill-secondary);';
      query.addEventListener('click', async () => {
        query.disabled = true; status.textContent = labels[5];
        try {
          const applied = await queryAndApplyPublication(doc.defaultView, paper);
          status.textContent = applied ? '' : '';
          if (applied && body.isConnected) render();
        } catch (error) {
          status.textContent = `${labels[6]}: ${error instanceof Error ? error.message : String(error)}`;
          Zotero.logError(error);
        } finally { query.disabled = false; }
      });
      container.replaceChildren(
        section(labels[1], venue),
        section(`${labels[2]} · ${labels[3]}`, rankWrap),
        query,
        status,
      );
    };
    body.replaceChildren(container);
    render();
  }

  async function queryAndApplyPublication(win: any, item: any): Promise<boolean> {
    const paper = resolvePaperItem(item);
    if (!paper) return false;
    const settings = await storage.getSettings();
    const result = await lookupPublication(paper, fetch, settings.easyScholarApiKey);
    const ranks = [
      result.jcr ? quartileLabel(result.jcr) : '',
      result.cas ? quartileLabel(result.cas) : '',
      result.ccf ? `CCF-${result.ccf}` : '',
      result.core ? `CORE-${result.core}` : '',
    ].filter(Boolean).join(' · ');
    const summary = [
      `匹配论文：${result.title}`,
      `类型：${result.type === 'conference' ? '会议论文' : result.type === 'journal' ? '期刊论文' : result.type === 'preprint' ? '预印本' : '其他'}`,
      `出版来源：${result.venue || '未知'}`,
      `年份：${result.year || '未知'}`,
      `等级：${ranks || '无公开等级数据'}`,
      `等级数据源：${result.rankSource || 'CCFDDL / 本地索引'}`,
      ...(result.rankError ? [`EasyScholar 查询失败：${result.rankError}`] : []),
      `数据源：${result.source}`,
      '',
      '确认后将更新条目类型和出版字段，并写入 PaperLens 分类标签。',
    ].join('\n');
    if (!Services.prompt.confirm(win, 'PaperLens 在线查询结果', summary)) return false;
    await applyPublicationLookup(paper, result);
    await win.ZoteroPane.selectItem(paper.id);
    Zotero.ItemPaneManager.refreshInfoRow(journalRowID);
    Zotero.ItemPaneManager.refreshInfoRow(quartileRowID);
    Zotero.ItemPaneManager.refreshInfoRow(conferenceRowID);
    return true;
  }

  function mount(body: HTMLElement, item?: any, explicitReader?: any) {
    let view = views.get(body);
    if (!view) {
      const doc = body.ownerDocument;
      const controller = new ReaderController(doc, storage, ai, notify);
      const frame = doc.createElementNS(HTML, 'iframe') as HTMLIFrameElement;
      frame.className = 'paperlens-frame';
      frame.setAttribute('title', 'PaperLens 阅读助手');
      frame.style.cssText = `width:100%;height:${explicitReader ? '100%' : 'clamp(350px, calc(100vh - 180px), 1200px)'};border:0;display:block;min-width:0;`;
      view = { controller, frame };
      views.set(body, view);
      const entry = view;
      const ready = () => {
        const win = frame.contentWindow as Window;
        if (!entry.unmount && win?.PaperLensUI) entry.unmount = win.PaperLensUI.mount(controller.bridge);
      };
      frame.addEventListener('load', ready);
      frame.addEventListener('paperlens-ui-ready', ready);
      frame.src = sidebarURL;
      body.style.cssText = 'padding:0;min-width:0;' + (explicitReader ? 'flex:1;min-height:0;overflow:hidden;' : '');
      body.append(frame);
    }
    const details = body.closest('item-details') as any;
    const reader = explicitReader || (details?.tabID && Zotero.Reader.getByTabID(details.tabID)) || findReader(body.ownerDocument, item?.id);
    const attachment = reader ? Zotero.Items.get(reader.itemID) : item?.isPDFAttachment?.() ? item : null;
    if (attachment) void view.controller.load(attachment, reader);
    return view;
  }

  function mountStandalone(reader: any) {
    const win = reader._window, doc = win.document;
    let view = standalone.get(win);
    if (!view) {
      const panel = doc.createXULElement('vbox');
      panel.id = 'paperlens-window-panel'; panel.setAttribute('width', '360');
      panel.style.cssText = 'min-width:280px;max-width:600px;flex-shrink:0;';
      const splitter = doc.createXULElement('splitter');
      splitter.setAttribute('resizebefore', 'closest'); splitter.setAttribute('resizeafter', 'closest');
      const body = doc.createElementNS(HTML, 'div') as HTMLElement;
      panel.append(body);
      doc.getElementById('zotero-reader').parentElement.append(splitter, panel);
      const entry = mount(body, Zotero.Items.get(reader.itemID), reader);
      entry.controller.bridge.closePanel = () => { panel.hidden = true; splitter.hidden = true; };
      const cleanup = () => {
        win.removeEventListener('unload', cleanup);
        entry.unmount?.(); void entry.controller.dispose(); views.delete(body);
        panel.remove(); splitter.remove(); standalone.delete(win);
      };
      win.addEventListener('unload', cleanup, { once: true });
      view = { panel, splitter, entry, cleanup }; standalone.set(win, view);
    }
    view.panel.hidden = false; view.splitter.hidden = false;
    return view.entry;
  }

  async function show(reader: any, quote?: Quote) {
    translations.close(reader);
    if (!reader.tabID) {
      const entry = mountStandalone(reader);
      await entry.controller.load(Zotero.Items.get(reader.itemID), reader);
      if (quote) await entry.controller.select(quote, reader);
      entry.frame.contentDocument?.querySelector<HTMLTextAreaElement>('textarea[data-question]')?.focus();
      return;
    }
    const win = reader._iframe?.ownerDocument.defaultView || reader._window || Zotero.getMainWindow();
    const doc = win.document;
    const context = doc.getElementById('zotero-context-pane');
    context?.setAttribute('collapsed', 'false');
    const splitter = doc.getElementById('zotero-context-splitter');
    splitter?.setAttribute('state', 'open');
    if (context) context.mode = 'item';
    await reader.setContextPaneOpen(true);
    const details = reader.tabID ? doc.querySelector(`item-details[data-tab-id="${reader.tabID}"]`) : doc.querySelector('item-details');
    if (details) {
      await details.render();
      const section = [...details.querySelectorAll('item-pane-custom-section')].find((node: any) => node.dataset.pane === paneID) as any;
      if (section) { section.open = true; await section.render(); }
      await details.scrollToPane(paneID, 'instant');
    }
    let entry = [...views.values()].find(view => view.controller.reader === reader);
    if (!entry && details) {
      const section = [...details.querySelectorAll('item-pane-custom-section')].find((node: any) => node.dataset.pane === paneID) as any;
      if (section) { section.open = true; await section.render(); }
      entry = [...views.values()].find(view => view.controller.reader === reader);
    }
    if (entry && quote) await entry.controller.select(quote, reader);
    entry?.frame.contentDocument?.querySelector<HTMLTextAreaElement>('textarea[data-question]')?.focus();
  }

  const selectionListener = (event: any) => {
    const { reader, doc, params, append } = event;
    if (reader.type !== 'pdf' || !params.annotation?.text) return;
    const annotation = JSON.parse(JSON.stringify(params.annotation));
    const quote: Quote = { text: annotation.text, pageLabel: String(annotation.pageLabel || annotation.position.pageIndex + 1), location: annotation.position };
    const button = doc.createElement('button');
    button.type = 'button'; button.textContent = '问 PaperLens';
    button.style.cssText = 'padding:5px 9px;margin:3px;border:1px solid #7b93b4;border-radius:4px;cursor:pointer;color:inherit;background:transparent;';
    button.addEventListener('click', () => {
      void show(reader, quote).catch(error => Zotero.logError(error));
    });
    const translate = doc.createElement('button');
    translate.type = 'button'; translate.textContent = '翻译';
    translate.setAttribute('title', '用当前 AI 模型翻译选文');
    translate.style.cssText = button.style.cssText;
    translate.addEventListener('click', () => {
      void translations.openFromPreferences(reader, translate, quote).catch(error => Zotero.logError(error));
    });
    append(button, translate);
    translations.schedule(reader, translate, quote);
  };
  const toolbarListener = ({ reader, doc, append }: any) => {
    if (reader.type !== 'pdf') return;
    const button = doc.createElement('button'); button.type = 'button'; button.textContent = 'PaperLens';
    button.setAttribute('title', '打开 PaperLens 阅读助手');
    button.style.cssText = 'padding:4px 8px;margin-inline:4px;color:inherit;background:transparent;border:1px solid #7b93b4;border-radius:4px;cursor:pointer;';
    button.addEventListener('click', () => void show(reader).catch(e => Zotero.logError(e)));
    append(button);
  };

  const plugin = {
    info, storage, ai, views,
    paperMetadata: {
      getJournal, getQuartile, getConferenceRanks, saveJournal, saveQuartile, saveConferenceRanks, resolvePaperItem,
    },
    paperOnline: { lookupPublication, applyPublicationLookup },
    async start() {
      await storage.init();
      paneID = Zotero.ItemPaneManager.registerSection({
        paneID: 'paperlens-reading', pluginID: info.id,
        header: { l10nID: 'paperlens-pane-header', icon: 'chrome://paperlens/content/icon.svg' },
        sidenav: { l10nID: 'paperlens-pane-sidenav', icon: 'chrome://paperlens/content/icon.svg' },
        onItemChange: ({ tabType, setEnabled }: any) => { setEnabled(tabType === 'reader'); return true; },
        onRender: ({ body, item, tabType }: any) => {
          if (tabType !== 'reader') return;
          (body.ownerDocument as any).l10n?.addResourceIds(['paperlens.ftl']);
          mount(body, item);
        },
        onDestroy: ({ body }: any) => {
          const view = views.get(body); if (!view) return;
          view.unmount?.(); void view.controller.dispose(); views.delete(body);
        },
      });
      if (!paneID) throw new Error('PaperLens 侧栏注册失败。');
      journalRowID = Zotero.ItemPaneManager.registerInfoRow({
        rowID: 'paperlens-journal', pluginID: info.id,
        label: { l10nID: 'paperlens-journal-label' },
        position: 'afterCreators', multiline: false, nowrap: true, editable: true,
        onGetData: ({ item }: any) => getJournal(item),
        onSetData: ({ item, value }: any) => saveJournal(item, value),
        onItemChange: ({ item, setEnabled, setEditable }: any) => {
          const paper = resolvePaperItem(item);
          const allowed = Boolean(paper && publicationField(paper));
          setEnabled(allowed); setEditable(allowed);
        },
      });
      quartileRowID = Zotero.ItemPaneManager.registerInfoRow({
        rowID: 'paperlens-quartile', pluginID: info.id,
        label: { l10nID: 'paperlens-quartile-label' },
        position: 'end', multiline: false, nowrap: true, editable: true,
        onGetData: ({ item }: any) => journalRanksLabel(getJournalRanks(item)),
        onSetData: ({ item, value }: any) => saveJournalRanks(item, parseJournalRanksInput(value)),
        onItemChange: ({ item, setEnabled, setEditable }: any) => {
          const allowed = Boolean(resolvePaperItem(item));
          setEnabled(allowed); setEditable(allowed);
        },
      });
      conferenceRowID = Zotero.ItemPaneManager.registerInfoRow({
        rowID: 'paperlens-conference-rank', pluginID: info.id,
        label: { l10nID: 'paperlens-conference-rank-label' },
        position: 'end', multiline: false, nowrap: true, editable: true,
        onGetData: ({ item }: any) => conferenceRankLabel(getConferenceRanks(item)),
        onSetData: async ({ item, value }: any) => {
          await saveConferenceRanks(item, parseConferenceRank(value));
        },
        onItemChange: ({ item, setEnabled, setEditable }: any) => {
          const allowed = Boolean(resolvePaperItem(item));
          setEnabled(allowed); setEditable(allowed);
        },
      });
      publicationPaneID = Zotero.ItemPaneManager.registerSection({
        paneID: 'paperlens-publication', pluginID: info.id,
        header: { l10nID: 'paperlens-publication-header', icon: 'chrome://paperlens/content/icon.svg' },
        sidenav: { l10nID: 'paperlens-publication-sidenav', icon: 'chrome://paperlens/content/icon.svg' },
        onItemChange: ({ item, setEnabled }: any) => { setEnabled(Boolean(resolvePaperItem(item))); },
        onRender: ({ body, item }: any) => { void mountPublicationSection(body, item); },
        onDestroy: ({ body }: any) => { body.replaceChildren(); },
      });
      if (!journalRowID || !quartileRowID || !conferenceRowID || !publicationPaneID) {
        throw new Error('PaperLens 出版信息行注册失败。');
      }
      await Zotero.PreferencePanes.register({ pluginID: info.id, id: 'paperlens-settings', label: 'PaperLens',
        src: info.rootURI + 'content/preferences.xhtml', image: info.rootURI + 'content/icon.svg' });
      Zotero.Reader.registerEventListener('renderTextSelectionPopup', selectionListener, info.id);
      Zotero.Reader.registerEventListener('renderToolbar', toolbarListener, info.id);
    },
    show,
    addWindow(win: any) {
      if (windows.has(win)) return;
      win.document.l10n?.addResourceIds(['paperlens.ftl']);
      const popup = win.document.getElementById('zotero-itemmenu');
      if (!popup) return;
      const menu = win.document.createXULElement('menuitem');
      menu.id = 'paperlens-open-reader'; menu.setAttribute('label', '使用 PaperLens 阅读');
      const queryMenu = win.document.createXULElement('menuitem');
      queryMenu.id = 'paperlens-query-publication'; queryMenu.setAttribute('label', 'PaperLens：在线查询出版信息');
      const update = () => {
        const selected = win.ZoteroPane.getSelectedItems();
        menu.hidden = selected.length !== 1;
        const item = selected[0];
        menu.disabled = !item || !(item.isPDFAttachment() || item.isRegularItem() && item.getAttachments().some((id: number) => Zotero.Items.get(id).isPDFAttachment()));
        const paper = resolvePaperItem(item);
        queryMenu.hidden = selected.length !== 1;
        queryMenu.disabled = !paper;
      };
      menu.addEventListener('command', async () => {
        const selected = win.ZoteroPane.getSelectedItems()[0];
        const attachments = selected.isPDFAttachment() ? [selected] : selected.getAttachments().map((id: number) => Zotero.Items.get(id)).filter((item: any) => item.isPDFAttachment());
        let item = attachments[0];
        if (attachments.length > 1) {
          const index = { value: 0 };
          if (!Services.prompt.select(win, '选择 PDF', '选择要阅读的附件', attachments.map((a: any) => a.getField('title')), index)) return;
          item = attachments[index.value];
        }
        if (!item || !await item.getFilePathAsync()) { Services.prompt.alert(win, 'PaperLens', '请先将 PDF 下载到本机。'); return; }
        try { await show(await openReader(item.id)); }
        catch (error) { Services.prompt.alert(win, 'PaperLens', error instanceof Error ? error.message : String(error)); }
      });
      queryMenu.addEventListener('command', async () => {
        const paper = resolvePaperItem(win.ZoteroPane.getSelectedItems()[0]);
        if (!paper) return;
        try {
          await queryAndApplyPublication(win, paper);
        } catch (error) {
          Services.prompt.alert(win, 'PaperLens 在线查询失败', error instanceof Error ? error.message : String(error));
        }
      });
      popup.append(menu, queryMenu); popup.addEventListener('popupshowing', update);
      windows.set(win, () => {
        popup.removeEventListener('popupshowing', update);
        menu.remove(); queryMenu.remove();
      });
    },
    removeWindow(win: any) { windows.get(win)?.(); windows.delete(win); },
    mountPreferences(body: HTMLElement) {
      const doc = body.ownerDocument;
      const frame = doc.createElementNS(HTML, 'iframe') as HTMLIFrameElement;
      frame.style.cssText = 'width:100%;height:clamp(380px, calc(100vh - 160px), 900px);border:0;'; frame.setAttribute('title', 'PaperLens 设置');
      const controller = new ReaderController(doc, storage, ai, () => {
        for (const view of views.values()) void view.controller.refreshSettings();
      });
      let mounted = false;
      let unmount: (() => void) | undefined;
      const ready = () => {
        if (!mounted && frame.contentWindow?.PaperLensUI) {
          mounted = true; unmount = frame.contentWindow.PaperLensUI.mount({ ...controller.bridge, mode: 'settings' });
        }
      };
      const cleanup = () => {
        doc.defaultView?.removeEventListener('unload', cleanup);
        unmount?.(); void controller.dispose(); frame.remove(); preferenceFrames.delete(frame);
      };
      doc.defaultView?.addEventListener('unload', cleanup, { once: true });
      frame.addEventListener('load', ready);
      frame.addEventListener('paperlens-ui-ready', ready);
      frame.src = sidebarURL; body.replaceChildren(frame); preferenceFrames.set(frame, cleanup);
    },
    async stop() {
      translations.dispose();
      Zotero.Reader.unregisterEventListener('renderTextSelectionPopup', selectionListener);
      Zotero.Reader.unregisterEventListener('renderToolbar', toolbarListener);
      for (const win of windows.keys()) plugin.removeWindow(win);
      for (const view of standalone.values()) view.cleanup();
      for (const view of views.values()) { view.unmount?.(); await view.controller.dispose(); view.frame.remove(); }
      views.clear();
      for (const cleanup of preferenceFrames.values()) cleanup(); preferenceFrames.clear();
      if (paneID) Zotero.ItemPaneManager.unregisterSection(paneID);
      if (journalRowID) Zotero.ItemPaneManager.unregisterInfoRow(journalRowID);
      if (quartileRowID) Zotero.ItemPaneManager.unregisterInfoRow(quartileRowID);
      if (conferenceRowID) Zotero.ItemPaneManager.unregisterInfoRow(conferenceRowID);
      if (publicationPaneID) Zotero.ItemPaneManager.unregisterSection(publicationPaneID);
      Zotero.PreferencePanes.unregister('paperlens-settings');
      await storage.flush();
    },
  };
  return plugin;
}
