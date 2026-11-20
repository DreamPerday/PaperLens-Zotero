import assert from 'node:assert/strict';
import test from 'node:test';
import { nextRankSelection, rankFilterOptions, registerPublicationFilter } from '../src/publication-filter';

const q1 = 'PaperLens/JCR-Q1';
const q2 = 'PaperLens/JCR-Q2';
const cas = 'PaperLens/CAS-2';
const ccf = 'PaperLens/CCF-A';
const core = 'PaperLens/CORE-A*';
const custom = 'PaperLens/EasyScholar:CustomSet=Tier=A';

test('rank menu groups saved tags, omits unrelated tags, and preserves unknown dataset names', () => {
  const groups = rankFilterOptions([core, q2, q1, q1, cas, ccf, custom, 'PaperLens/Conference-ICML', 'Q1',
    'PaperLens/EasyScholar:HZAU=A', 'PaperLens/EasyScholar:sciUp=计算机科学1区'], true);
  assert.deepEqual(groups.slice(0, 4).map(group => group.label), ['JCR', '中科院分区', 'CCF', 'CORE']);
  assert.deepEqual(groups[0].options, [{ tag: q1, value: 'Q1' }, { tag: q2, value: 'Q2' }]);
  assert.deepEqual(groups.find(group => group.label === 'CustomSet')?.options, [{ tag: custom, value: 'Tier=A' }]);
  assert.ok(groups.some(group => group.label === '华中农业大学'));
  assert.ok(groups.some(group => group.label === '中科院升级版分区'));
  assert.equal(groups.length, 7);
});

test('rank selection replaces the current tier, combines datasets, and clears only rank tags', () => {
  const original = new Set(['reading', q1, cas, 'PaperLens/Conference-ICML', 'PaperLens/EasyScholar:customset=B']);
  const replaced = nextRankSelection(original, q2);
  assert.deepEqual(replaced, new Set(['reading', q2, cas, 'PaperLens/Conference-ICML', 'PaperLens/EasyScholar:customset=B']));
  const selected = nextRankSelection(replaced, custom);
  assert.deepEqual(selected, new Set(['reading', q2, cas, 'PaperLens/Conference-ICML', custom]));
  assert.ok(!nextRankSelection(selected, q2).has(q2));
  assert.deepEqual(nextRankSelection(selected, null), new Set(['reading', 'PaperLens/Conference-ICML']));
  assert.ok(original.has(q1));
});

test('the toolbar menu applies and clears filters through the native item-list callback', async () => {
  class MenuNode extends EventTarget {
    id = '';
    children: MenuNode[] = [];
    attributes = new Map<string, string>();
    style = { setProperty() {} };
    removed = false;
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    append(...nodes: MenuNode[]) { this.children.push(...nodes); }
    before(node: MenuNode) { toolbar.append(node); }
    replaceChildren(...nodes: MenuNode[]) { this.children = nodes; }
    remove() { this.removed = true; }
    byLabel(label: string) { return this.children.find(node => node.attributes.get('label') === label)!; }
    fire(type: string) { this.dispatchEvent(new Event(type)); }
  }
  const toolbar = new MenuNode();
  const search = new MenuNode();
  const selected = new Set(['reading']);
  const papers = [[q1, 'reading'], [q2, 'reading'], [q1]];
  let visible: string[][] = [];
  let libraryID: number | undefined;
  const tagSelector = { getTagSelection: () => selected };
  const pane = {
    tagSelector: null as typeof tagSelector | null,
    getCollectionTreeRows: () => [{ isCollection: () => true, ref: { libraryID: 12 } }],
    async toggleTagSelector() { this.tagSelector = tagSelector; },
    async updateTagFilter() { visible = papers.filter(tags => [...selected].every(tag => tags.includes(tag))); },
  };
  const runtime = globalThis as { Zotero?: unknown };
  runtime.Zotero = {
    locale: 'zh-CN',
    Tags: { async getAll(id: number) { libraryID = id; return [{ tag: q1 }, { tag: q2 }]; } },
    logError(error: unknown) { throw error; },
  };
  try {
    const cleanup = registerPublicationFilter({
      ZoteroPane: pane,
      document: { getElementById: () => search, createXULElement: () => new MenuNode() },
    });
    const button = toolbar.children[0];
    const menu = button.children[0];
    menu.fire('popupshowing');
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(libraryID, 12);
    menu.byLabel('JCR').children[0].byLabel('Q1').fire('command');
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(visible, [papers[0]]);

    menu.fire('popupshowing');
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(menu.byLabel('JCR').children[0].byLabel('Q1').attributes.get('checked'), 'true');
    menu.byLabel('清除等级筛选').fire('command');
    assert.deepEqual(visible, [papers[0], papers[1]]);
    assert.deepEqual(selected, new Set(['reading']));
    cleanup();
    assert.ok(button.removed);
  } finally {
    delete runtime.Zotero;
  }
});
