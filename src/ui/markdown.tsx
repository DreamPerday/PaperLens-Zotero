import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Nodes } from 'mdast';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

export function normalizeMarkdown(markdown: string) {
  const literals: string[] = [];
  const store = (text: string) => `\u0000${literals.push(text) - 1}\u0000`;
  const ranges: { start: number; end: number }[] = [];
  const collect = (node: Nodes) => {
    if (['code', 'inlineCode', 'html'].includes(node.type) && node.position) {
      ranges.push({ start: node.position.start.offset!, end: node.position.end.offset! });
    } else if ('children' in node) node.children.forEach(collect);
  };
  collect(fromMarkdown(markdown));
  let value = markdown;
  // Parse code boundaries rather than rewriting Markdown examples inside code.
  for (const { start, end } of ranges.reverse()) {
    value = value.slice(0, start) + store(markdown.slice(start, end)) + value.slice(end);
  }
  value = value
    .replace(/\\\[/g, () => '$$').replace(/\\\]/g, () => '$$')
    .replace(/\\\(/g, '$').replace(/\\\)/g, '$')
    .replace(/\\begin\{(?:equation|equation\*)\}/g, () => '$$')
    .replace(/\\end\{(?:equation|equation\*)\}/g, () => '$$')
    .replace(/(^|\n)[ \t]*\$\$[ \t]*([^\n]+?)[ \t]*\$\$[ \t]*(?=\n|$)/g,
      (_match, prefix, formula) => prefix + '$$\n' + formula + '\n$$');
  // Keep emphasis-like characters inside TeX and escaped asterisks literal.
  value = value.replace(/\$\$[\s\S]*?\$\$|(?<!\\)\$(?!\$)(?:\\.|[^$\n\\])+\$/g, store)
    .replace(/\\[\\*]/g, store)
    .replace(/(?<!\*)\*\*(?!\*)([^\n]+?)(?<!\*)\*\*(?!\*)/g, (match, text: string) => {
      const content = text.trim();
      if (!content || content === text) return match;
      const leading = text.match(/^\s*/)?.[0] || '';
      const trailing = text.match(/\s*$/)?.[0] || '';
      return leading + '**' + content + '**' + trailing;
    });
  // Later literals can contain earlier protected code, so restore in reverse order.
  for (let i = literals.length - 1; i >= 0; i--) value = value.replaceAll(`\u0000${i}\u0000`, () => literals[i]);
  return value;
}

export function Markdown({ children, components }: { children: string; components?: Components }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath, remarkCjkFriendly]}
    rehypePlugins={[[rehypeKatex, { throwOnError: false }]]} components={components}>
    {normalizeMarkdown(children)}
  </ReactMarkdown>;
}
