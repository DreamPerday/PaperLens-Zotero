import type { ChatMessage, Settings } from '../types';

export function endpointCandidates(baseURL: string, path: string): string[] {
  const base = baseURL.trim().replace(/\/+$/, '').replace(/\/(chat\/completions|models)$/, '');
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Base URL 请输入完整的 HTTP(S) 服务地址，不包含密钥或查询参数。');
  }
  if (/\/v\d+(?:beta\d*)?$/.test(base)) return [`${base}/${path}`];
  return [`${base}/${path}`, `${base}/v1/${path}`];
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(part => part.text || '').join('');
  return '';
}

export class AIClient {
  constructor(private fetcher: typeof fetch = fetch) {}

  private async request(settings: Settings, path: string, body?: object, signal?: AbortSignal) {
    if (!settings.baseURL.trim()) throw new Error('请先配置 AI Base URL。');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (settings.apiKey.trim()) headers.Authorization = `Bearer ${settings.apiKey.trim()}`;
    const candidates = endpointCandidates(settings.baseURL, path);
    for (let i = 0; i < candidates.length; i++) {
      const response = await this.fetcher(candidates[i], {
        method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, signal,
      });
      if ([404, 405].includes(response.status) && i < candidates.length - 1) {
        await response.body?.cancel();
        continue;
      }
      if (!response.ok) {
        let detail = '';
        try {
          const json = await response.json();
          detail = String(json.error?.message || json.message || '').slice(0, 400);
          if (settings.apiKey) detail = detail.split(settings.apiKey).join('…');
        } catch { /* Some services return an HTML error page. */ }
        throw new Error(`AI 服务返回 HTTP ${response.status}${detail ? `：${detail}` : '，请检查地址、模型和密钥。'}`);
      }
      return response;
    }
    throw new Error('AI 服务地址不可用。');
  }

  async models(settings: Settings, signal?: AbortSignal): Promise<string[]> {
    const response = await this.request(settings, 'models', undefined, signal);
    const json = await response.json();
    const list = Array.isArray(json) ? json : json.data;
    if (!Array.isArray(list)) throw new Error('服务未返回模型列表，可以手动填写模型 ID。');
    return [...new Set<string>(list.map((item: any) => typeof item === 'string' ? item : item.id).filter(Boolean))].sort();
  }

  async test(settings: Settings, signal?: AbortSignal) {
    if (!settings.model.trim()) throw new Error('请先填写或选择模型。');
    const response = await this.request(settings, 'chat/completions', {
      model: settings.model.trim(), stream: false,
      messages: [{ role: 'user', content: 'Reply only: OK' }],
    }, signal);
    const json = await response.json();
    if (!contentText(json.choices?.[0]?.message?.content)) throw new Error('连接成功，但模型没有返回可用文本。');
    return `已连接 ${settings.model}，请保存设置后开始阅读。`;
  }

  async stream(settings: Settings, messages: ChatMessage[], onText: (text: string) => void, signal?: AbortSignal) {
    if (!settings.model.trim()) throw new Error('请先在设置中选择模型。');
    const response = await this.request(settings, 'chat/completions', {
      model: settings.model.trim(), messages, stream: true,
    }, signal);
    if (response.headers.get('content-type')?.includes('application/json')) {
      const json = await response.json();
      const text = contentText(json.choices?.[0]?.message?.content);
      if (!text) throw new Error('模型未返回文本。');
      onText(text);
      if (json.choices[0].finish_reason === 'length') throw new Error('回答达到模型长度上限，已保留内容，可继续追问。');
      return;
    }
    if (!response.body) throw new Error('AI 服务没有返回回答内容。');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '', finished = false, received = false;
    const consume = (line: string) => {
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (!data) return;
      if (data === '[DONE]') { finished = true; return; }
      const chunk = JSON.parse(data);
      if (chunk.error) throw new Error('AI 服务中断回答，请检查模型后重试。');
      for (const choice of chunk.choices || []) {
        const text = contentText(choice.delta?.content);
        if (text) { received = true; onText(text); }
        if (choice.finish_reason === 'length') throw new Error('回答达到模型长度上限，已保留内容，可继续追问。');
        if (choice.finish_reason) finished = true;
      }
    };
    try {
      while (true) {
        const { done, value } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() || '';
        for (const line of lines) consume(line);
        if (finished) break;
        if (done) { if (pending) consume(pending); break; }
      }
      if (!finished) throw new Error('回答连接中断，已保留收到的内容，可以重试。');
      if (!received) throw new Error('模型没有返回可见文本，请选择支持对话的模型。');
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
