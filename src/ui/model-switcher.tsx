import React, { useEffect, useRef, useState } from 'react';
import type { Bridge, ViewState } from '../types';

export function ModelSwitcher({ bridge, state, onSettings }: { bridge: Bridge; state: ViewState; onSettings: () => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const models = [state.model, ...state.models.filter(model => model !== state.model)].filter(Boolean);
  const options = models.filter(model => model.toLowerCase().includes(query.trim().toLowerCase()));
  const dismiss = () => { setOpen(false); trigger.current?.focus(); };
  const refresh = async () => {
    setError(''); setActive(0);
    try { await bridge.refreshModels(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const choose = async (model: string) => {
    if (state.busy || switching) return;
    setError(''); setSwitching(true);
    try { await bridge.setModel(model); dismiss(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSwitching(false); }
  };
  const show = () => {
    setOpen(true); setQuery(''); setActive(0); setError('');
    if (state.configured && !state.models.length && !state.modelsLoading) void refresh();
  };
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const doc = root.current!.ownerDocument;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const blur = () => setOpen(false);
    doc.addEventListener('pointerdown', outside);
    doc.defaultView?.addEventListener('blur', blur);
    return () => { doc.removeEventListener('pointerdown', outside); doc.defaultView?.removeEventListener('blur', blur); };
  }, [open]);
  useEffect(() => {
    const option = list.current?.children[active] as HTMLElement | undefined;
    const container = list.current;
    if (!option || !container) return;
    if (option.offsetTop < container.scrollTop) container.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > container.scrollTop + container.clientHeight)
      container.scrollTop = option.offsetTop + option.offsetHeight - container.clientHeight;
  }, [active, query]);
  return <div className="model-switcher" ref={root} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
  }} onKeyDown={event => {
    if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); }
  }}>
    <button ref={trigger} type="button" className="model-trigger" aria-haspopup="dialog" aria-expanded={open}
      aria-controls="paperlens-model-menu" title={`切换 AI 模型：${state.model || '未配置'}`}
      onClick={() => open ? dismiss() : show()}>
      <span className="model-trigger-label">模型</span><span className="model-name">{state.model || '选择模型'}</span><span className="model-chevron" aria-hidden="true"/>
    </button>
    {open && <section id="paperlens-model-menu" className="model-menu" role="dialog" aria-label="选择 AI 模型">
      <div className="model-menu-heading"><strong>切换模型</strong><span>{state.modelsLoading ? '获取中…' : `${models.length} 个模型`}</span></div>
      <input ref={search} className="model-search" type="search" placeholder="搜索模型名称…" aria-label="搜索 AI 模型"
        role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="paperlens-model-options"
        aria-activedescendant={options[active] ? `paperlens-model-option-${active}` : undefined}
        value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && options.length) {
            event.preventDefault(); setActive((active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
          } else if (event.key === 'Enter' && options[active]) { event.preventDefault(); void choose(options[active]); }
        }}/>
      <div ref={list} id="paperlens-model-options" className="model-options" role="listbox" aria-label="可用模型" aria-busy={state.modelsLoading}>
        {options.map((model, index) => <button key={model} id={`paperlens-model-option-${index}`} type="button" role="option"
          className={`model-option${index === active ? ' is-active' : ''}`} tabIndex={-1} aria-selected={model === state.model}
          disabled={state.busy || switching} onPointerMove={() => setActive(index)} onClick={() => void choose(model)}>
          <span>{model}</span>{model === state.model && <span className="model-current">当前</span>}
        </button>)}
      </div>
      {!options.length && <p className="model-empty" role="status">{state.modelsLoading ? '正在获取模型列表…' : query ? '没有匹配的模型，试试其他名称。' : '配置 AI 连接后，获取可用模型。'}</p>}
      {state.configured && !state.modelsLoading && !state.models.length && !error && <p className="model-hint">服务未返回模型列表时，可在连接设置中手动填写模型 ID。</p>}
      {state.busy && <p className="model-hint" role="status">回答生成中，结束或停止后可切换模型。</p>}
      {error && <p className="model-error" role="alert">{error}</p>}
      <div className="model-menu-actions"><button className="text-button" disabled={!state.configured || state.modelsLoading || switching}
        onClick={() => void refresh()}>{state.modelsLoading ? '正在刷新…' : '刷新列表'}</button>
        <button className="text-button" onClick={() => { setOpen(false); onSettings(); }}>连接设置</button></div>
    </section>}
  </div>;
}
