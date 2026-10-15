import type { Block, Location } from '../types';

export function nodeText(node: any): string {
  if (typeof node.text === 'string') return node.text;
  const children = node.content || node.children || [];
  return children.map(nodeText).join(children.some((n: any) => n.type === 'paragraph') ? '\n' : '');
}

function anchors(node: any): Location[] {
  const anchor = node.anchor || node.position;
  const found: Location[] = [];
  for (const rect of anchor?.pageRects || []) {
    const [pageIndex, ...coordinates] = rect;
    found.push({ pageIndex, rects: [coordinates] });
  }
  if (anchor && Number.isInteger(anchor.pageIndex)) {
    found.push({ pageIndex: anchor.pageIndex, ...(anchor.rects ? { rects: anchor.rects } : {}) });
  }
  for (const child of node.content || node.children || []) found.push(...anchors(child));
  return found;
}

export function normalizeStructured(structure: any): Block[] {
  const blocks: Block[] = [];
  let section = '';
  const walk = (node: any, inheritedPage = 0) => {
    const kind = node.type || node.kind || 'paragraph';
    const locations = anchors(node);
    const pageIndex = locations[0]?.pageIndex ?? node.pageIndex ?? inheritedPage;
    if (['doc', 'document', 'section', 'page'].includes(kind) || (!node.text && !node.anchor && !node.position && !node.type)) {
      for (const child of node.content || node.children || []) walk(child, pageIndex);
      return;
    }
    const text = nodeText(node).replace(/\u00ad/g, '').trim();
    if (!text) return;
    if (/heading|title/.test(kind)) section = text;
    const location: Location = { pageIndex, rects: locations.filter(p => p.pageIndex === pageIndex).flatMap(p => p.rects || []) };
    if (!location.rects?.length) delete location.rects;
    const page = structure.catalog?.pages?.[pageIndex];
    blocks.push({ id: `b${blocks.length + 1}`, text, section, kind,
      pageLabel: String(page?.label || page?.pageLabel || pageIndex + 1), location, locations });
  };
  for (const node of structure.content || []) walk(node);
  return blocks;
}
