import type { Block } from '../types';

export interface ReadingCursor {
  pageIndex: number;
  x?: number;
  y?: number;
}

function rectDistance(x: number, y: number, rect: number[]) {
  if (rect.length < 4) return Number.POSITIVE_INFINITY;
  const left = Math.min(rect[0], rect[2]);
  const right = Math.max(rect[0], rect[2]);
  const top = Math.min(rect[1], rect[3]);
  const bottom = Math.max(rect[1], rect[3]);
  const dx = x < left ? left - x : x > right ? x - right : 0;
  const dy = y < top ? top - y : y > bottom ? y - bottom : 0;
  return Math.hypot(dx, dy);
}

export function locateBlock(blocks: Block[], cursor: ReadingCursor): Block | undefined {
  const pageBlocks = blocks.filter(block => block.location.pageIndex === cursor.pageIndex ||
    block.locations?.some(location => location.pageIndex === cursor.pageIndex));
  if (!pageBlocks.length) return undefined;
  if (cursor.x === undefined || cursor.y === undefined) return pageBlocks[0];

  const ranked = pageBlocks.map((block, index) => {
    const locations = (block.locations?.length ? block.locations : [block.location])
      .filter(location => location.pageIndex === cursor.pageIndex);
    const distance = locations.reduce((best, location) => Math.min(best,
      ...(location.rects || []).map(rect => rectDistance(cursor.x!, cursor.y!, rect))), Number.POSITIVE_INFINITY);
    return { block, index, distance };
  });
  const positioned = ranked.filter(item => Number.isFinite(item.distance));
  if (!positioned.length) return pageBlocks[0];
  return positioned.sort((a, b) => a.distance - b.distance || a.index - b.index)[0].block;
}
