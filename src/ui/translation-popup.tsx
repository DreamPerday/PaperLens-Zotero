import React, { useEffect, useRef, useState } from 'react';
import type { TranslationBridge, TranslationState } from '../types';
import { Markdown } from './markdown';

export function TranslationPopup({ bridge }: { bridge: TranslationBridge }) {
  const [state, setState] = useState<TranslationState>();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const drag = useRef<{ x: number; y: number }>();
  useEffect(() => bridge.subscribe(setState), [bridge]);
  const action = async (work: () => Promise<void>) => {
    setError('');
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const busy = state?.status === 'streaming';
  return <section className="translation" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); bridge.close(); }
  }}>
    <div className="translation-header" onPointerDown={event => {
      if (event.button !== 0 || (event.target as Element).closest('button,input,label')) return;
      drag.current = { x: event.screenX, y: event.screenY };
      event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
    }} onPointerMove={event => {
      const last = drag.current;
      if (!last) return;
      bridge.move(event.screenX - last.x, event.screenY - last.y);
      drag.current = { x: event.screenX, y: event.screenY };
    }} onPointerUp={() => { drag.current = undefined; }} onLostPointerCapture={() => { drag.current = undefined; }}>
      <div><strong>选文翻译</strong><span>简体中文 · 第 {state?.quote.pageLabel || '…'} 页</span></div>
      <button className="translation-close" aria-label="关闭译文浮窗" title="关闭（Esc）" onClick={() => bridge.close()}>×</button>
    </div>
    <div className="translation-body">
      {!state ? <p className="muted" role="status">正在准备翻译…</p> : <>
        <details className="translation-original"><summary>查看原文</summary><p>{state.quote.text}</p></details>
        {!state.configured ? <div className="translation-setup"><p>连接 AI 模型后，即可翻译选中的原文。</p><button onClick={() => bridge.openSettings()}>配置 AI 服务</button></div> : <>
          <div className="answer translation-answer"><Markdown>{state.content}</Markdown></div>
          {busy && <p className="translation-progress muted" role="status">{state.content ? '正在翻译…' : '正在翻译选文…'}</p>}
          {state.status === 'stopped' && <p className="translation-progress muted" role="status">翻译已停止{state.content ? '，已保留收到的译文。' : '。'}</p>}
          {state.error && <p className="error" role="alert">{state.error}</p>}
        </>}
        {error && <p className="error" role="alert">{error}</p>}
      </>}
    </div>
    <div className="translation-actions">
      <div>{state?.content && <button className="text-button" onClick={() => { bridge.copy(state.content); setCopied(true); }}>{copied ? '已复制' : '复制译文'}</button>}
        <button className="text-button" onClick={() => void action(() => bridge.ask())}>在侧栏追问 ↗</button></div>
      {busy ? <button className="translation-stop" onClick={() => bridge.stop()}>停止</button> : state?.configured && <button className="text-button" onClick={() => { setCopied(false); void action(() => bridge.translate()); }}>{state.status === 'error' || state.status === 'stopped' ? '重试' : '重新翻译'}</button>}
    </div>
    <div className="translation-footer"><label><input type="checkbox" checked={state?.autoTranslate ?? true} disabled={!state}
      onChange={event => void action(() => bridge.setAutoTranslate(event.target.checked))}/>选中后自动翻译</label>
      <span title={state?.model}>{state?.model || '沿用当前 AI 模型'}</span></div>
  </section>;
}
