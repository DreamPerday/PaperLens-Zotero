import { AIClient } from './ai/client';
import { ReaderController } from './controller';
import { getJournal, getQuartile, parseQuartileInput, publicationField, quartileLabel, resolvePaperItem, saveJournal, saveQuartile } from './paper-metadata';
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
  const notify = () => {
    for (const { controller } of views.values()) {
      controller.emit();
      void controller.refreshSettings().catch(error => Zotero.logError(error));
    }
  };
  const translations = new TranslationPopups(sidebarURL, storage, ai, show, notify);

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
    paperMetadata: { getJournal, getQuartile, saveJournal, saveQuartile, resolvePaperItem },
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
        onGetData: ({ item }: any) => quartileLabel(getQuartile(item)),
        onSetData: ({ item, value }: any) => saveQuartile(item, parseQuartileInput(value)),
        onItemChange: ({ item, setEnabled, setEditable }: any) => {
          const allowed = Boolean(resolvePaperItem(item));
          setEnabled(allowed); setEditable(allowed);
        },
      });
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
      const update = () => {
        const selected = win.ZoteroPane.getSelectedItems();
        menu.hidden = selected.length !== 1;
        const item = selected[0];
        menu.disabled = !item || !(item.isPDFAttachment() || item.isRegularItem() && item.getAttachments().some((id: number) => Zotero.Items.get(id).isPDFAttachment()));
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
      popup.append(menu); popup.addEventListener('popupshowing', update);
      windows.set(win, () => { popup.removeEventListener('popupshowing', update); menu.remove(); });
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
      Zotero.PreferencePanes.unregister('paperlens-settings');
      await storage.flush();
    },
  };
  return plugin;
}
