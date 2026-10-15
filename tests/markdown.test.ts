import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown, normalizeMarkdown } from '../src/ui/markdown';

const render = (text: string) => renderToStaticMarkup(createElement(Markdown, { children: text }));

test('AI emphasis with inner spaces renders the screenshot example and preserves word spacing', () => {
  const html = render('**理解时要注意： **这是一段说明。\n\nA ** bold phrase ** follows.');
  assert.match(html, /<strong>理解时要注意：<\/strong> 这是一段说明。/);
  assert.match(html, /A  <strong>bold phrase<\/strong>  follows\./);
  assert(!html.includes('**'));
});

test('Chinese punctuation, quotes and adjacent emphasis do not leak raw markers', () => {
  const html = render('这是**“最小间隙”**的定义。**注意：**不能混同。**第一点。**接着**第二点。**');
  assert.equal((html.match(/<strong>/g) || []).length, 4);
  assert(!html.includes('**'));
});

test('fenced, indented and inline code preserve literal Markdown and TeX delimiters', () => {
  const code = '** 注意： ** \\(x\\) \\[y\\]';
  const text = ['```md', code, '```', '', '    ' + code, '', '`' + code + '`', '', '\\**保留星号**'].join('\n');
  assert.equal(normalizeMarkdown(text), text);
  const html = render(text);
  assert.equal((html.match(/<code/g) || []).length, 3);
  assert(!html.includes('katex'));
  assert(!html.includes('<strong>'));
});

test('math, code and citations can remain inside repaired emphasis', () => {
  const html = render('** 公式 $g_{\\min}$、`node` 和 [第8页](#source-b12)： **仍需核对。');
  assert.match(html, /<strong>公式 <span class="katex"/);
  assert.match(html, /<code>node<\/code>/);
  assert.match(html, /href="#source-b12"/);
  assert(!html.includes('**'));
});

test('inline and block math render including matrices and aligned equations', () => {
  const html = render([
    '行内 \\(x^2\\)。', '', '$$\\frac{1}{n}\\sum_{i=1}^n x_i$$', '',
    '\\[\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}\\]', '',
    '\\begin{equation}\\begin{aligned}a&=b+c\\\\d&=e\\end{aligned}\\end{equation}',
  ].join('\n'));
  assert.equal((html.match(/class="katex-display"/g) || []).length, 3);
  assert.equal((html.match(/class="katex"/g) || []).length, 4);
  assert(!html.includes('katex-error'));
});

test('GFM tables, nested lists and source links retain their structure', () => {
  const html = render('### [第3页 · b12](#source-b12)\n\n- **要点： **解释\n  - 相关段落\n\n| 方法 | 结果 |\n| --- | --- |\n| A | **通过** |');
  assert.match(html, /<h3><a href="#source-b12">/);
  assert.match(html, /<strong>要点：<\/strong>/);
  assert.equal((html.match(/<ul>/g) || []).length, 2);
  assert.match(html, /<table>/);
});

test('unfinished streaming emphasis stays readable until its closing delimiter arrives', () => {
  assert.match(render('解释：**注意'), /解释：\*\*注意/);
  assert.match(render('解释：**注意： **后续'), /<strong>注意：<\/strong> 后续/);
});
