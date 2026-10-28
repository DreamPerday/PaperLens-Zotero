import { AIClient } from './ai/client';
import { discardIncompleteAnswers } from './history';
import { ANNOTATION_FORMAT, buildMessages, chunkBlocks, groupSummaries, sourceText, SYSTEM } from './reading/context';
import { locateBlock } from './reading/position';
import { activeProvider, DEFAULT_SETTINGS } from './settings';
import { Storage } from './storage';
import { extractSource, findReader, identityFor, navigateReader, openReader, readingCursor, readingPosition, saveNote } from './zotero-adapter';
import type { Bridge, Depth, Message, Quote, Session, Settings, Source, Task, ViewState } from './types';

const taskQuestions: Record<Task, string> = {
  chat: '', close: '请逐句解释这段原文，并分析它在论证中的作用和关联段落。',
  overview: '请给出论文的研究问题、方法、结果、贡献和局限，并引用原文。',
  verify: '请核对这段原文中的主张、证据和适用范围。',
};
const makeID = () => Zotero.Utilities.randomString(12);

export class ReaderController {
  private static requests = new Map<string, AbortController>();
  private static noteSaves = new Set<string>();
  source?: Source;
  session?: Session;
  reader: any;
  item: any;
  settings: Settings = { ...DEFAULT_SETTINGS };
  state: ViewState = { title: 'PaperLens', identity: '', task: 'chat', messages: [], draft: '', depth: 'standard',
    hints: true, model: '', providerID: DEFAULT_SETTINGS.activeProviderId, providerName: DEFAULT_SETTINGS.providers[0].name,
    providers: DEFAULT_SETTINGS.providers.map(({ id, name, baseURL, model }) => ({ id, name, baseURL, model })),
    configured: false, readable: false, loading: false, busy: false, models: [], modelsLoading: false,
    error: '', notice: '', sourceInfo: '', returnAvailable: false };
  private listeners = new Set<(state: ViewState) => void>();
  private abort?: AbortController;
  private loadID = 0;
  private loading?: Promise<void>;
  private previousLocation: any;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private availableModels: string[] = [];
  private syncTimer: ReturnType<typeof setInterval>;
  private navigationCursor?: ReturnType<typeof readingCursor>;
  readonly bridge: Bridge;

  constructor(readonly doc: Document, readonly storage: Storage, readonly ai: AIClient, private notifyAll: () => void) {
    this.bridge = {
      mode: 'reader', subscribe: listener => { this.listeners.add(listener); listener(this.snapshot()); return () => this.listeners.delete(listener); },
      setTask: task => { this.state.task = task; if (this.session) this.session.task = task; if (task !== 'close') this.setActiveSource(); this.persistDraft(); this.emit(); },
      setDraft: text => { this.state.draft = text; if (this.session) this.session.draft = text; this.persistDraft(); },
      removeQuote: () => { this.state.quote = undefined; if (this.session) this.session.quote = undefined; this.persistDraft(); this.emit(); },
      setDepth: async depth => { this.settings = { ...await this.storage.getSettings(), depth }; await this.storage.saveSettings(this.settings); this.notifyAll(); },
      send: (text, task) => this.send(text, task), retry: id => this.retry(id), stop: () => ReaderController.requests.get(this.state.identity)?.abort(),
      navigate: (id, messageID) => this.navigate(id, messageID), returnToReading: () => this.returnToReading(),
      saveNote: id => this.save(id), openNote: async id => { await Zotero.getMainWindow().ZoteroPane.selectItem(id); },
      newConversation: async () => {
        if (ReaderController.requests.has(this.state.identity)) return;
        if (this.session) {
          this.session.messages = []; this.session.draft = ''; this.session.quote = undefined;
          this.state.quote = undefined; this.state.draft = ''; this.setActiveSource(); await this.storage.saveSession(this.session); this.notifyAll();
        }
      },
      refreshSource: () => this.load(this.item, this.reader, true), openSettings: () => Zotero.Utilities.Internal.openPreferences('paperlens-settings'),
      refreshModels: () => this.refreshModels(), setModel: model => this.setModel(model), setProvider: id => this.setProvider(id),
      getSettings: () => storage.getSettings(), saveSettings: async settings => {
        await storage.saveSettings(settings);
        this.settings = await storage.getSettings();
        this.availableModels = [];
        this.emit(); this.notifyAll();
      },
      models: settings => ai.models(settings), testConnection: settings => ai.test(settings),
      copy: text => Components.classes['@mozilla.org/widget/clipboardhelper;1'].getService(Components.interfaces.nsIClipboardHelper).copyString(text),
    };
    this.syncTimer = setInterval(() => this.syncAnnotationPosition(), 350);
  }

  private snapshot(): ViewState {
    const provider = activeProvider(this.settings);
    return { ...this.state, messages: [...(this.session?.messages || [])],
      depth: this.settings.depth, hints: this.settings.hints, model: provider.model,
      providerID: provider.id, providerName: provider.name,
      providers: this.settings.providers.map(({ id, name, baseURL, model }) => ({ id, name, baseURL, model })),
      models: [...this.availableModels], modelsLoading: this.state.modelsLoading,
      configured: Boolean(provider.baseURL && provider.model), readable: Boolean(this.source),
      busy: ReaderController.requests.has(this.state.identity) };
  }
  emit() { if (!this.disposed) for (const listener of this.listeners) listener(this.snapshot()); }
  private setActiveSource(sourceID?: string, messageID?: string) {
    if (!sourceID) this.navigationCursor = undefined;
    if (this.state.activeSourceID === sourceID && this.state.activeMessageID === messageID) return false;
    this.state.activeSourceID = sourceID;
    this.state.activeMessageID = messageID;
    return true;
  }
  private syncAnnotationPosition() {
    if (this.state.task !== 'close' || !this.source || !this.session || !this.reader || this.state.loading) {
      if (this.setActiveSource()) this.emit();
      return;
    }
    const cursor = readingCursor(this.reader);
    const pinned = this.navigationCursor;
    if (cursor && pinned && cursor.pageIndex === pinned.pageIndex && cursor.x === pinned.x && cursor.y === pinned.y &&
        this.session.messages.some(message => message.id === this.state.activeMessageID && message.sourceVersion === this.source?.version)) return;
    this.navigationCursor = undefined;
    const block = cursor && locateBlock(this.source.blocks, cursor);
    const message = block && [...this.session.messages].reverse().find(candidate =>
      candidate.role === 'assistant' && candidate.task === 'close' && candidate.sourceVersion === this.source?.version &&
      candidate.sourceIds?.includes(block.id) && candidate.content.includes('](#source-' + block.id + ')'));
    if (this.setActiveSource(message ? block?.id : undefined, message?.id)) this.emit();
  }
  async refreshSettings() {
    const previous = activeProvider(this.settings);
    const previousConnection = [previous.id, previous.baseURL, previous.apiKey].join('\n');
    this.settings = await this.storage.getSettings();
    const current = activeProvider(this.settings);
    if ([current.id, current.baseURL, current.apiKey].join('\n') !== previousConnection) this.availableModels = [];
    this.emit();
  }
  async refreshModels() {
    if (this.state.modelsLoading) return;
    const settings = await this.storage.getSettings();
    const provider = activeProvider(settings);
    if (!provider.baseURL.trim()) throw new Error('请先配置当前服务商的 Base URL。');
    this.state.modelsLoading = true; this.emit();
    try {
      this.availableModels = await this.ai.models(provider);
      this.state.notice = `已加载 ${this.availableModels.length} 个模型。`;
    } finally {
      this.state.modelsLoading = false; this.emit();
    }
  }
  async setModel(model: string) {
    const value = model.trim();
    if (!value || value === activeProvider(this.settings).model) return;
    if (ReaderController.requests.has(this.state.identity)) throw new Error('请先停止当前回答，再切换模型。');
    const settings = await this.storage.getSettings();
    settings.providers = settings.providers.map(provider =>
      provider.id === settings.activeProviderId ? { ...provider, model: value } : provider);
    await this.storage.saveSettings(settings);
    this.settings = await this.storage.getSettings();
    if (!this.availableModels.includes(value)) this.availableModels = [value, ...this.availableModels];
    this.state.notice = `已切换模型：${value}`;
    this.emit(); this.notifyAll();
  }
  async setProvider(id: string) {
    const settings = await this.storage.getSettings();
    const provider = settings.providers.find(item => item.id === id);
    if (!provider) throw new Error('未找到要切换的服务商。');
    if (!provider.baseURL || !provider.model) throw new Error('请先在设置中补全该服务商的 Base URL 和模型。');
    if (provider.id === settings.activeProviderId) return;
    if (ReaderController.requests.has(this.state.identity)) throw new Error('请先停止当前回答，再切换服务商。');
    settings.activeProviderId = provider.id;
    await this.storage.saveSettings(settings);
    this.settings = await this.storage.getSettings();
    this.availableModels = [];
    this.state.notice = `已切换服务商：${provider.name}`;
    this.emit(); this.notifyAll();
  }
  private persistDraft() {
    clearTimeout(this.saveTimer);
    const session = this.session;
    this.saveTimer = setTimeout(() => { if (session) void this.storage.saveSession(session).catch(e => this.fail(e)); }, 350);
  }
  private fail(error: unknown) { this.state.error = error instanceof Error ? error.message : String(error); this.emit(); }

  async load(item: any, reader?: any, force = false) {
    if (!force && this.item?.id === item?.id && this.loading) { await this.loading; return; }
    const pending = this.loadSource(item, reader, force);
    this.loading = pending;
    try { await pending; } finally { if (this.loading === pending) this.loading = undefined; }
  }

  private async loadSource(item: any, reader?: any, force = false) {
    if (!item?.isPDFAttachment?.()) {
      this.state.notice = '请打开一份本机 PDF 后使用 PaperLens。'; this.emit(); return;
    }
    if (!force && this.item?.id === item.id && (this.source || this.state.loading)) { this.reader = reader || this.reader; return; }
    this.abort?.abort();
    const id = ++this.loadID;
    this.item = item; this.reader = reader || findReader(this.doc, item.id); this.source = undefined; this.session = undefined;
    this.previousLocation = undefined;
    this.state = { ...this.state, title: item.getField('title') || 'PDF', quote: undefined, draft: '', identity: identityFor(item), loading: true, busy: false, error: '', notice: '正在读取论文文字…', sourceInfo: '', returnAvailable: false, activeSourceID: undefined, activeMessageID: undefined };
    this.emit();
    try {
      const [session, settings] = await Promise.all([this.storage.session(identityFor(item)), this.storage.getSettings()]);
      if (id !== this.loadID || this.disposed) return;
      this.session = session; this.settings = settings;
      this.state.task = session.task; this.state.quote = session.quote; this.state.draft = session.draft;
      const source = await extractSource(item, this.storage, force);
      if (id !== this.loadID || this.disposed) return;
      this.source = source; this.state.title = source.title;
      this.state.sourceInfo = `${source.pageCount} 页 · ${source.blocks.length} 段`;
      if (session.messages.some(m => m.sourceVersion && m.sourceVersion !== source.version)) {
        this.state.notice = 'PDF 已更新。旧解读仍保留，旧位置链接已停用，请重新分析。';
        this.state.quote = undefined; session.quote = undefined;
      } else this.state.notice = '';
    } catch (error) { if (id === this.loadID) this.fail(error); }
    finally { if (id === this.loadID) { this.state.loading = false; this.emit(); } }
  }

  async select(quote: Quote, reader: any) {
    await this.load(Zotero.Items.get(reader.itemID), reader);
    if (!this.session || this.disposed) return;
    quote.blockIds = this.source?.blocks.filter(b => b.location.pageIndex === quote.location.pageIndex &&
      (b.text.includes(quote.text.trim().slice(0, 60)) || quote.text.includes(b.text.slice(0, 60)))).map(b => b.id);
    this.state.quote = quote; this.session.quote = quote; this.state.task = 'chat'; this.session.task = 'chat';
    await this.storage.saveSession(this.session); this.emit();
  }

  async send(text: string, task: Task = this.state.task, retryMessage?: Message) {
    if (!this.source || !this.session || ReaderController.requests.has(this.state.identity)) return;
    if (task === 'verify' && !text.trim() && !this.state.quote) { this.fail(new Error('请输入要核对的主张，或在原文中选中结论。')); return; }
    text = text.trim() || taskQuestions[task];
    if (!text) return;
    const source = this.source, session = this.session, item = this.item;
    const abort = new (this.doc.defaultView as any).AbortController() as AbortController;
    this.abort = abort; ReaderController.requests.set(session.identity, abort);
    this.setActiveSource();
    this.state.busy = true; this.state.error = ''; this.state.notice = ''; this.notifyAll(); this.emit();
    let answer: Message | undefined;
    const isCurrent = () => this.session === session && !this.disposed;
    const progress = (notice: string) => { if (isCurrent()) { this.state.notice = notice; this.emit(); } };
    try {
      this.settings = await this.storage.getSettings();
      if (abort.signal.aborted) return;
      const provider = activeProvider(this.settings);
      if (!provider.baseURL || !provider.model) { this.bridge.openSettings(); return; }
      const settings = this.settings;
      answer = retryMessage || { id: makeID(), role: 'assistant', content: '', task, status: 'streaming', createdAt: new Date().toISOString() };
      let history: Message[];
      if (retryMessage) {
        const index = session.messages.indexOf(retryMessage);
        const user = session.messages[index - 1];
        text = user.content; history = session.messages.slice(0, index - 1);
        answer.quote = user.quote;
      } else {
        session.messages = discardIncompleteAnswers(session.messages, task);
        history = [...session.messages];
        const quote = task === 'overview' ? undefined : this.state.quote;
        session.messages.push({ id: makeID(), role: 'user', content: text, quote, status: 'complete', task, createdAt: new Date().toISOString() });
        answer.quote = quote; session.messages.push(answer);
        this.state.draft = ''; session.draft = '';
      }
      const response = answer;
      Object.assign(response, { content: '', status: 'streaming', error: undefined, noteID: undefined, model: provider.model,
        provider: provider.name, sourceVersion: source.version, sourceIds: [] });
      this.emit(); await this.storage.saveSession(session);
      // Re-check before every request: a replaced PDF invalidates old positions.
      if (await item.attachmentHash !== source.version) throw new Error('PDF 已更新，请重新读取原文后再分析。');
      const fullTextAnnotation = task === 'close' && !response.quote;
      const chunks = task === 'overview' || fullTextAnnotation ? chunkBlocks(source.blocks, settings.contextChars) : [];
      if (chunks.length > 1) {
        response.sourceIds = source.blocks.map(b => b.id);
        const summaries: string[] = [];
        const segmentInstruction = fullTextAnnotation
          ? '按原文顺序逐段注解以下论文片段。对每个有文字的段落标出来源编号，并说明：段落主旨、关键术语或公式、在论证中的作用、与相邻段落的关系。不要把没有给出的内容补进来。' + ANNOTATION_FORMAT
          : '提取以下论文片段的研究问题、方法、结果、贡献、局限，保留 #source-b编号 引用。不要当作整篇论文。';
        for (let i = 0; i < chunks.length; i++) {
          if (abort.signal.aborted) throw new Error('已停止');
          response.range = `部分完成 · ${i}/${chunks.length} 部分`;
          progress(`正在分析第 ${i + 1}/${chunks.length} 部分；已完成 ${i} 部分`);
          let summary = '';
          await this.ai.stream(provider, [{ role: 'system', content: SYSTEM }, { role: 'user', content:
            `${segmentInstruction} 控制在 ${fullTextAnnotation ? 2200 : 1200} 字内。\n${sourceText(chunks[i])}` }], chunk => { summary += chunk; }, abort.signal);
          summaries.push(summary);
          response.content = summaries.map((s, index) => `### ${fullTextAnnotation ? '全文注解分段' : '原文分段'} ${index + 1}\n${s}`).join('\n\n');
          response.range = `部分完成 · ${i + 1}/${chunks.length} 部分`;
          this.emit(); await this.storage.saveSession(session);
        }
        const partial = response.content;
        let final = '';
        progress(fullTextAnnotation ? '各部分注解已完成。' : '各部分已完成，正在汇总整篇概览…');
        try {
          if (fullTextAnnotation) {
            response.range = `全文注解 · ${source.pageCount} 页 · ${chunks.length} 部分`;
          } else {
          let groups = groupSummaries(summaries, settings.contextChars);
          for (let round = 0; groups.length > 1; round++) {
            if (round === 4) throw new Error('分段摘要超出上下文预算，已保留各段解读。请提高预算后重试。');
            const reduced: string[] = [];
            for (let i = 0; i < groups.length; i++) {
              progress(`正在合并摘要 · 第 ${round + 1} 轮 · ${i + 1}/${groups.length}`);
              let result = '';
              await this.ai.stream(provider, [{ role: 'system', content: SYSTEM }, { role: 'user', content:
                `合并以下片段摘要，保留研究问题、方法、结果、限制和来源编号，控制在 ${Math.min(1200, Math.floor(settings.contextChars / 4))} 字内。\n${groups[i]}` }], chunk => { result += chunk; }, abort.signal);
              reduced.push(result);
            }
            groups = groupSummaries(reduced, settings.contextChars);
          }
          await this.ai.stream(provider, [{ role: 'system', content: SYSTEM }, { role: 'user', content:
            `${text}\n解释深度：${settings.depth}。下文为按顺序分析全文所得的摘要，请合并去重，并保留有效来源编号：\n${groups[0]}` }],
          chunk => { final += chunk; response.content = final; this.emit(); }, abort.signal);
          }
        } catch (error) { response.content = partial; throw error; }
        if (!fullTextAnnotation) response.range = `全文 · ${source.pageCount} 页 · ${chunks.length} 部分`;
      } else {
        const request = buildMessages(source, task === 'overview' ? [] : history, text, response.quote, task, settings.depth, settings.contextChars);
        response.sourceIds = request.blocks.map(b => b.id); response.range = request.range;
        await this.ai.stream(provider, request.messages, chunk => { response.content += chunk; this.emit(); }, abort.signal);
      }
      response.status = 'complete';
      progress('点击回答中的来源可以回到原文。');
    } catch (error) {
      if (answer) {
        answer.status = abort.signal.aborted ? 'stopped' : 'error';
        answer.error = abort.signal.aborted ? '已停止，已保留收到的内容。' : (error instanceof Error ? error.message : '请求失败，请重试。');
      } else if (isCurrent()) this.fail(error);
    } finally {
      try { if (answer) await this.storage.saveSession(session); } catch (error) { if (isCurrent()) this.fail(error); }
      if (ReaderController.requests.get(session.identity) === abort) ReaderController.requests.delete(session.identity);
      if (this.abort === abort) { this.abort = undefined; this.state.busy = false; }
      if (isCurrent() && answer?.error) this.state.notice = answer.error;
      this.notifyAll(); this.emit();
    }
  }

  async retry(id: string) {
    const messages = this.session?.messages || [];
    const answer = messages.at(-1);
    if (!answer || answer.id !== id || answer.role !== 'assistant' || answer.status === 'complete') return;
    await this.send(messages.at(-2)?.content || '', answer.task, answer);
  }

  async navigate(id: string, messageID?: string) {
    const message = this.session?.messages.find(m => m.id === messageID);
    if (message && message.sourceVersion !== this.source?.version) throw new Error('该解读来自旧版 PDF，请重新分析。');
    if (await this.item.attachmentHash !== this.source?.version) throw new Error('PDF 已更新，请重新读取原文。');
    const block = this.source?.blocks.find(b => b.id === id);
    if (id !== 'selection' && (!block || (message && !message.sourceIds?.includes(id)))) return;
    this.reader ||= findReader(this.doc, this.item.id) || await openReader(this.item.id);
    const location = id === 'selection' ? this.state.quote?.location : block?.location;
    if (!location) return;
    this.previousLocation ||= readingPosition(this.reader);
    await navigateReader(this.reader, location.rects?.length ? { position: location } : { pageIndex: location.pageIndex });
    if (id !== 'selection' && message?.task === 'close') {
      this.setActiveSource(id, messageID);
      this.navigationCursor = readingCursor(this.reader);
    }
    this.state.returnAvailable = true; this.emit();
  }
  async returnToReading() {
    if (this.previousLocation && this.reader) await navigateReader(this.reader, this.previousLocation);
    this.previousLocation = undefined; this.state.returnAvailable = false; this.emit();
  }
  async save(id: string) {
    const message = this.session?.messages.find(m => m.id === id);
    if (!message || message.noteID || !message.content || !this.source || ReaderController.noteSaves.has(message.id)) return;
    if (message.sourceVersion !== this.source.version) throw new Error('这是旧版 PDF 的解读，请重新分析后保存来源笔记。');
    const index = this.session!.messages.indexOf(message);
    ReaderController.noteSaves.add(message.id);
    try {
      message.noteID = await saveNote(this.item, message, this.session!.messages[index - 1], this.source);
      await this.storage.saveSession(this.session!); this.notifyAll();
    } finally { ReaderController.noteSaves.delete(message.id); }
  }
  async dispose() {
    this.disposed = true; this.abort?.abort(); clearTimeout(this.saveTimer); clearInterval(this.syncTimer); this.listeners.clear();
    if (this.session) await this.storage.saveSession(this.session);
  }
}
