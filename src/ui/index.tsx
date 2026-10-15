import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Markdown } from './markdown';
import { ModelSwitcher } from './model-switcher';
import type { Bridge, Message, Settings, Task, ViewState } from '../types';
import './style.css';

const tasks: { id: Task; label: string; description: string; action: string }[] = [
  { id: 'chat', label: '问答', description: '可以围绕选文提问，也可以直接询问论文中的概念、方法和结果。', action: '发送问题' },
  { id: 'close', label: '注解', description: '对选文逐句注释；没有选文时，一键按段落生成全文注解。', action: '生成全文注解' },
  { id: 'overview', label: '概览', description: '梳理论文的研究问题、方法、结果与局限，每个要点关联原文。', action: '生成概览' },
  { id: 'verify', label: '证据核对', description: '把一个具体主张和论文原文对照，判断支持程度、限制和适用条件。', action: '开始核对' },
];

function SettingsPanel({ bridge, onBack }: { bridge: Bridge; onBack?: () => void }) {
  const [settings, setSettings] = useState<Settings>();
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [showKey, setShowKey] = useState(false);
  useEffect(() => { bridge.getSettings().then(setSettings).catch(e => setError(e.message)); }, [bridge]);
  const update = (key: keyof Settings, value: unknown) => setSettings(current => ({ ...current!, [key]: value }));
  const act = async (name: string, work: () => Promise<void>) => {
    setBusy(name); setError(''); setNotice('');
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  };
  return <div className="settings">
    {onBack && <button className="text-button" onClick={onBack}>← 返回论文</button>}
    <h1>PaperLens 设置</h1><p className="muted">连接你自己的 AI 服务，解读当前论文。</p>
    {error && <p role="alert" className="error">{error}</p>}
    {settings ? <>
      <label>Base URL<input value={settings.baseURL} spellCheck={false} placeholder="https://your-service.example/v1" onChange={e => update('baseURL', e.target.value)}/></label>
      <p className="field-help">支持 OpenAI 兼容服务和本地模型。可填写服务根地址或 /v1 地址。</p>
      <label>API Key<div className="input-row"><input value={settings.apiKey} type={showKey ? 'text' : 'password'} autoComplete="off" spellCheck={false} placeholder="本地无密钥服务可留空" onChange={e => update('apiKey', e.target.value)}/><button aria-label={showKey ? '隐藏密钥' : '显示密钥'} onClick={() => setShowKey(!showKey)}>{showKey ? '隐藏' : '显示'}</button></div></label>
      <label>模型<div className="input-row"><input list="paperlens-models" value={settings.model} placeholder="选择或填写模型 ID" onChange={e => update('model', e.target.value)}/><button disabled={Boolean(busy)} onClick={() => act('models', async () => { const list = await bridge.models(settings); setModels(list); setNotice(`已获取 ${list.length} 个模型，可在模型输入框中选择。`); })}>{busy === 'models' ? '获取中…' : '获取模型'}</button></div></label>
      <datalist id="paperlens-models">{models.map(model => <option key={model} value={model}/>)}</datalist>
      {models.length > 0 && <label>可用模型<select value={models.includes(settings.model) ? settings.model : ''} onChange={e => update('model', e.target.value)}><option value="" disabled>从服务返回的模型中选择</option>{models.map(model => <option key={model}>{model}</option>)}</select></label>}
      <p className="field-help">获取列表失败时仍可手动填写模型 ID。</p>
      <label>默认解释深度<select value={settings.depth} onChange={e => update('depth', e.target.value)}><option value="simple">简明</option><option value="standard">标准</option><option value="deep">深入</option></select></label>
      <label className="check"><input type="checkbox" checked={settings.hints} onChange={e => update('hints', e.target.checked)}/>显示阅读提示与示例问题</label>
      <details><summary>高级设置</summary><label>单次原文上下文预算（字符）<input type="number" min="4000" max="160000" step="4000" value={settings.contextChars} onChange={e => update('contextChars', Number(e.target.value))}/></label><p className="field-help">长文概览会分段处理全文。预算应与模型实际上下文容量匹配。</p></details>
      <p className="privacy">密钥保存在本机凭据存储。主动提问或分析时，会将相关论文文字发送给此处配置的服务。</p>
      <div className="actions"><button disabled={Boolean(busy) || !settings.model.trim()} onClick={() => act('test', async () => setNotice(await bridge.testConnection(settings)))}>{busy === 'test' ? '测试中…' : '测试连接'}</button><button className="primary" disabled={Boolean(busy) || !settings.baseURL.trim() || !settings.model.trim()} onClick={() => act('save', async () => {
        if (!Number.isFinite(settings.contextChars) || settings.contextChars < 4000 || settings.contextChars > 160000) throw new Error('上下文预算请设为 4000–160000 字符。');
        await bridge.saveSettings(settings); setNotice('设置已保存。');
      })}>{busy === 'save' ? '保存中…' : '保存设置'}</button></div>
      {notice && <p role="status" className="notice">{notice}</p>}
    </> : <p>正在读取设置…</p>}
  </div>;
}

function App({ bridge }: { bridge: Bridge }) {
  const [state, setState] = useState<ViewState>();
  const [settingsOpen, setSettingsOpen] = useState(bridge.mode === 'settings');
  const [actionError, setActionError] = useState('');
  const [saving, setSaving] = useState<string>();
  const [copied, setCopied] = useState<string>();
  const [showHistory, setShowHistory] = useState(false);
  const [followAnnotations, setFollowAnnotations] = useState(true);
  const [draft, setDraft] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const output = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const lastAnnotationTarget = useRef<{ element: HTMLElement; sourceID: string; messageID: string }>();
  useEffect(() => bridge.subscribe(value => {
    setState(value); setDraft(value.draft);
  }), [bridge]);
  useEffect(() => { setActionError(''); setShowHistory(false); setConfirmClear(false); setFollowAnnotations(true); follow.current = true; }, [state?.identity]);
  useEffect(() => {
    if (state?.task === 'close' && followAnnotations && state.activeSourceID && !showHistory) return;
    if (follow.current && output.current) output.current.scrollTop = output.current.scrollHeight;
  }, [state?.messages.at(-1)?.content, state?.busy]);
  useEffect(() => {
    const container = output.current;
    if (settingsOpen || showHistory || !followAnnotations || state?.task !== 'close' || !container || !state.activeSourceID || !state.activeMessageID) {
      lastAnnotationTarget.current = undefined;
      return;
    }
    const matches = [...container.querySelectorAll<HTMLElement>('[data-source-id]')]
      .filter(element => element.dataset.sourceId === state.activeSourceID && element.dataset.messageId === state.activeMessageID);
    // Prefer the paragraph's own heading over references in other paragraphs.
    const citation = matches.find(element => element.closest('h1,h2,h3,h4')) || matches[0];
    const target = citation?.closest<HTMLElement>('h1,h2,h3,h4,p,li,blockquote') || citation;
    const last = lastAnnotationTarget.current;
    if (!target || target === last?.element && last.sourceID === state.activeSourceID && last.messageID === state.activeMessageID) return;
    lastAnnotationTarget.current = { element: target, sourceID: state.activeSourceID, messageID: state.activeMessageID };
    const bounds = container.getBoundingClientRect(), rect = target.getBoundingClientRect();
    if (rect.top < bounds.top + 12 || rect.bottom > bounds.bottom - 12) {
      container.scrollTop += rect.top - bounds.top - 16;
    }
  }, [state?.activeSourceID, state?.activeMessageID, state?.messages.at(-1)?.content, state?.task, settingsOpen, showHistory, followAnnotations]);
  const action = async (work: () => Promise<void>) => {
    setActionError(''); try { await work(); } catch (e) { setActionError(e instanceof Error ? e.message : String(e)); }
  };
  if (settingsOpen) return <SettingsPanel bridge={bridge} onBack={bridge.mode === 'settings' ? undefined : () => setSettingsOpen(false)}/>;
  if (!state) return <p className="muted">正在打开 PaperLens…</p>;
  const task = tasks.find(t => t.id === state.task)!;
  const messages = showHistory ? state.messages : state.messages.filter(m => m.task === state.task);
  const annotationAction = state.task === 'close' && state.quote ? '分析选文' : task.action;
  const send = () => {
    if (state.busy || state.loading || !state.readable || state.task === 'chat' && !draft.trim()) return;
    follow.current = true;
    void action(() => bridge.send(draft));
  };
  const renderAnswer = (message: Message) => <div className="answer" key={message.id}>
    <Markdown components={{
      a: ({ href, children }) => {
        const match = href?.match(/^#source-(b\d+)$/);
        if (match && message.sourceIds?.includes(match[1])) {
          const active = state.activeSourceID === match[1] && state.activeMessageID === message.id;
          return <button className={`citation${active ? ' source-active' : ''}`} data-source-id={match[1]} data-message-id={message.id} aria-current={active ? 'location' : undefined} onClick={() => action(() => bridge.navigate(match[1], message.id))}>{children}</button>;
        }
        return href ? <a href={href} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span>;
      },
    }}>{message.content}</Markdown>
    {!message.content && message.status === 'streaming' && <p className="muted" role="status">正在思考…</p>}
    {message.error && <p className="error" role="alert">{message.error}</p>}
    <div className="answer-meta">{message.model}{message.range && ` · ${message.range}`}</div>
    {message.status !== 'streaming' && <div className="message-actions">
      {message.content && <><button className="text-button" onClick={() => { bridge.copy(message.content); setCopied(message.id); }}>{copied === message.id ? '已复制' : '复制'}</button>
      {message.noteID ? <button className="text-button" onClick={() => action(() => bridge.openNote(message.noteID!))}>打开笔记 ↗</button> :
        <button className="text-button" disabled={saving === message.id} onClick={async () => { setSaving(message.id); await action(() => bridge.saveNote(message.id)); setSaving(undefined); }}>{saving === message.id ? '保存中…' : '保存为笔记'}</button>}</>}
      {state.messages.at(-1)?.id === message.id && message.status !== 'complete' && <button className="text-button" disabled={state.busy} onClick={() => action(() => bridge.retry(message.id))}>重试</button>}
    </div>}
  </div>;
  return <div className="app">
    <header><div className="header-top"><strong>PaperLens</strong><div className="header-actions"><ModelSwitcher bridge={bridge} state={state} onSettings={() => setSettingsOpen(true)}/><button className="header-button" title="AI 连接与阅读设置" onClick={() => setSettingsOpen(true)}>设置</button>{bridge.closePanel && <button className="header-button" title="收起侧栏，可从阅读器工具栏重新打开" onClick={() => bridge.closePanel?.()}>收起</button>}</div></div><p className="paper-title" title={state.title}>{state.title}</p></header>
    <nav aria-label="阅读任务">{tasks.map(t => <button key={t.id} aria-current={state.task === t.id ? 'page' : undefined} onClick={() => { bridge.setTask(t.id); setShowHistory(false); }}>{t.label}</button>)}</nav>
    <div className="toolbar"><span>{state.sourceInfo || (state.loading ? '正在读取原文…' : '从原文开始')}</span><div>{state.task === 'close' && !showHistory && messages.some(message => message.role === 'assistant') && <button className="text-button annotation-follow" aria-pressed={followAnnotations} title={followAnnotations ? '正文滚动时定位对应注解；点击暂停跟随' : '点击恢复跟随正文'} onClick={() => setFollowAnnotations(!followAnnotations)}>跟随正文</button>}<button className="text-button" onClick={() => setShowHistory(!showHistory)}>{showHistory ? '当前任务' : '历史'}</button><button className="text-button" disabled={state.busy || state.loading} onClick={() => action(() => bridge.refreshSource())}>重读原文</button></div></div>
    <div className="output" ref={output} onScroll={() => { const el = output.current!; follow.current = el.scrollHeight - el.clientHeight - el.scrollTop < 70; }}>
      {!state.configured && <div className="setup"><strong>连接你的 AI 模型</strong><p>填写服务地址和模型，即可围绕论文提问。</p><button onClick={() => setSettingsOpen(true)}>配置 AI 服务</button></div>}
      {state.quote && state.task !== 'overview' && <blockquote className="quote"><div><span>当前选文 · 第 {state.quote.pageLabel} 页</span><button className="text-button" onClick={() => bridge.removeQuote()}>移除</button></div><p>{state.quote.text}</p><button className="text-button" onClick={() => action(() => bridge.navigate('selection'))}>定位选文</button></blockquote>}
      {messages.length === 0 && <div className="empty"><h2>{task.label === '问答' ? '读到哪里，就问到哪里' : task.label}</h2><p>{task.description}</p>
      {state.task === 'close' && !state.quote && <div className="annotation-callout"><strong>全文注解</strong><p>按论文原文顺序解释每个段落的主旨、术语或公式、论证作用和段落关系。</p><button className="primary" disabled={!state.configured || !state.readable || state.loading || state.busy} onClick={send}>立即生成全文注解</button></div>}
      {state.task === 'verify' && <div className="task-guide"><strong>证据核对看什么？</strong><p>输入一个可核对的具体主张，或选中论文中的结论。回答会先给出支持程度，再列出原文证据、限制和适用条件。</p><div className="verification-levels"><span>支持</span><span>部分支持</span><span>当前依据不足</span></div></div>}
      {state.hints && <div className="suggestions">{(state.task === 'chat' ? ['这句话是什么意思？', '为什么这样设计实验？', '这个结论有哪些限制？'] : state.task === 'verify' ? ['论文的实验能否支持这个结论？'] : []).map(text => <button key={text} onClick={() => { setDraft(text); bridge.setDraft(text); input.current?.focus(); }}>{text}</button>)}</div>}</div>}
      {showHistory && <div className="history-heading"><strong>本篇阅读记录</strong><button className="text-button" disabled={state.busy || !state.messages.length} onClick={() => setConfirmClear(!confirmClear)}>清空记录</button></div>}
      {confirmClear && <div className="confirm"><p>清空本篇的对话和分析记录？已保存的 Zotero 笔记会保留。</p><button onClick={() => setConfirmClear(false)}>取消</button><button onClick={() => action(async () => { await bridge.newConversation(); setConfirmClear(false); })}>清空本篇记录</button></div>}
      {messages.map(message => message.role === 'user' ? <div className="question" key={message.id}>{showHistory && <small>{tasks.find(t => t.id === message.task)?.label} · </small>}{message.content}
        {message.quote && <details className="question-quote"><summary>提问时的选文 · 第 {message.quote.pageLabel} 页</summary><p>{message.quote.text}</p></details>}
      </div> : renderAnswer(message))}
      {state.error && <p className="error" role="alert">{state.error}</p>}
      {actionError && <p className="error" role="alert">{actionError}</p>}
      {state.returnAvailable && <button className="return" onClick={() => action(() => bridge.returnToReading())}>← 返回阅读位置</button>}
    </div>
    <div className="composer"><label htmlFor="paperlens-question">{state.task === 'chat' ? '继续追问' : state.task === 'verify' ? '要核对的主张（可编辑）' : state.task === 'close' && !state.quote ? '全文注解设置（可选）' : '补充关注点（可选）'}</label>
      <textarea ref={input} data-question="true" id="paperlens-question" rows={3} value={draft} placeholder={state.task === 'chat' ? '输入自己的问题…' : state.task === 'verify' ? '输入主张，或核对当前选文…' : state.task === 'close' && !state.quote ? '无需选文，直接点击“生成全文注解”…' : '例如：重点解释实验设计…'} onChange={e => { setDraft(e.target.value); bridge.setDraft(e.target.value); }} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}/>
      <div className="composer-bottom"><label className="depth">解释深度<select aria-label="解释深度" value={state.depth} onChange={e => action(() => bridge.setDepth(e.target.value as Settings['depth']))}><option value="simple">简明</option><option value="standard">标准</option><option value="deep">深入</option></select></label>
      {state.busy ? <button onClick={() => bridge.stop()}>停止生成</button> : <button className="primary" disabled={!state.configured || !state.readable || state.loading || state.task === 'chat' && !draft.trim() || state.task === 'verify' && !draft.trim() && !state.quote} onClick={send}>{annotationAction}</button>}</div>
    </div>
    <footer aria-live="polite">{state.notice || (state.model ? `${state.model} · Ctrl/⌘ + Enter 发送` : '配置 AI 后开始阅读')}</footer>
  </div>;
}

window.PaperLensUI = { mount(bridge) {
  const root = createRoot(document.getElementById('root')!);
  root.render(<App bridge={bridge}/>);
  return () => root.unmount();
} };
const announceReady = () => window.frameElement?.dispatchEvent(new CustomEvent('paperlens-ui-ready'));
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', announceReady, { once: true });
else announceReady();
