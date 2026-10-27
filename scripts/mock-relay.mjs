// Local synthetic integration fixture. Not packaged or used by the plugin.
import { createServer } from 'node:http';
const requests = [];
const server = createServer(async (req, res) => {
  if (req.url === '/health') { res.end(JSON.stringify({ requests })); return; }
  if (req.url === '/models' || req.url === '/chat/completions') { res.writeHead(404).end(); return; }
  if (req.url === '/v1/models') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'paperlens-fixture' }, { id: 'paperlens-slow' }, { id: 'paperlens-interrupted' }] })); return; }
  if (req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  requests.push({ model: body.model, stream: body.stream, hasAuth: Boolean(req.headers.authorization), messageCount: body.messages.length });
  res.setHeader('Content-Type', body.stream ? 'text/event-stream' : 'application/json');
  if (!body.stream) { res.end(JSON.stringify({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] })); return; }
  const prompt = body.messages.map(m => m.content).join('\n');
  const answer = /PaperLens 学术翻译助手/.test(prompt) ?
    '为了隔离检索带来的影响，我们在各个实验条件中固定生成模型。\n\n准确率提高了 **12%**；变量 $x_i$ 保持不变。\n\n$$\\frac{a+b}{c}=\\sum_{i=1}^{n}x_i$$' :
    /逐句注释/.test(prompt) ?
    '### 这段说了什么\n固定生成模型，让实验主要检验检索带来的影响。[第1页](#source-b6)\n\n### 论证作用\n交代控制变量，帮助判断结果变化能否归因于检索。\n\n### 关联段落\n结果段提供支持，但局限段限制了外推范围。[第2页](#source-b11) [局限](#source-b14)' :
    /核对用户主张/.test(prompt) ?
    '### 判断：部分支持\n相关检索在测试条件下改善证据覆盖。[结果依据](#source-b11)\n\n### 适用范围\n只评估了一个模型和一个语料库，不能据此断言检索总能提升准确性。[局限依据](#source-b14)' :
    /结构化概览|提取以下论文片段|合并去重/.test(prompt) ?
    '### 研究问题\n检索能否改善科学问答的证据覆盖？\n\n### 方法\n固定生成模型，每次检索五段，并对比不同检索条件。[方法](#source-b6)\n\n### 结果与局限\n相关材料有帮助，无关材料可能降低质量；外推尚未验证。[结果](#source-b11) [局限](#source-b14)' :
    '固定生成模型，是为了把比较中的主要变化限制在检索条件上。[第1页 · 原文依据](#source-b6)\n\n背景知识：这是控制变量的思路，用于减少其他因素对比较的干扰。\n\n还可以核对提示词、解码参数和评价方式是否一致。[实验条件](#source-b7)';
  const pieces = answer.match(/.{1,12}|\n/g) || [];
  let timer;
  let index = 0;
  const emit = () => {
    if (res.destroyed) return;
    if (index === pieces.length) {
      res.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'); return;
    }
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: pieces[index++] } }] }) + '\n\n');
    if (body.model === 'paperlens-interrupted' && index > 3) { res.end(); return; }
    timer = setTimeout(emit, body.model === 'paperlens-slow' ? 120 : 8);
  };
  res.on('close', () => clearTimeout(timer));
  emit();
});
server.listen(18791, '127.0.0.1', () => console.log('Synthetic relay listening at http://127.0.0.1:18791'));
