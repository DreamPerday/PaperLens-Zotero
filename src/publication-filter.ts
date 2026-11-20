import { publicationRankTag } from './paper-metadata';

export function rankFilterOptions(tags: Iterable<string>, zh: boolean) {
  const groups = new Map<string, { label: string; options: Array<{ tag: string; value: string }> }>();
  for (const tag of new Set(tags)) {
    const rank = publicationRankTag(tag, zh);
    if (!rank) continue;
    let group = groups.get(rank.group);
    if (!group) {
      group = { label: rank.label, options: [] };
      groups.set(rank.group, group);
    }
    group.options.push({ tag, value: rank.value });
  }
  const collator = new Intl.Collator(zh ? 'zh' : 'en', { numeric: true });
  for (const { options } of groups.values()) options.sort((a, b) => collator.compare(a.value, b.value));
  const order = ['JCR', 'CAS', 'CCF', 'CORE'];
  const priority = (key: string) => order.includes(key) ? order.indexOf(key) : order.length;
  return [...groups.entries()]
    .sort(([a, first], [b, second]) => priority(a) - priority(b) || collator.compare(first.label, second.label))
    .map(([, group]) => group);
}

export function nextRankSelection(tags: Iterable<string>, choice: string | null): Set<string> {
  const current = new Set(tags);
  const rank = choice ? publicationRankTag(choice, false) : null;
  if (choice && !rank) return current;
  if (choice && current.delete(choice)) return current;
  for (const tag of current) {
    const selected = publicationRankTag(tag, false);
    if (selected && (!rank || selected.group === rank.group)) current.delete(tag);
  }
  if (choice) current.add(choice);
  return current;
}

export function registerPublicationFilter(win: any): () => void {
  const doc = win.document;
  const search = doc.getElementById('zotero-tb-search');
  if (!search) return () => {};
  const pane = win.ZoteroPane;
  const zh = Zotero.locale.startsWith('zh');
  const button = doc.createXULElement('toolbarbutton');
  const popup = doc.createXULElement('menupopup');
  button.id = 'paperlens-rank-filter';
  button.setAttribute('type', 'menu');
  button.setAttribute('label', zh ? '等级筛选' : 'Filter by rank');
  button.setAttribute('tooltiptext', zh ? 'PaperLens：按分区或等级筛选' : 'PaperLens: filter by quartile or rank');
  button.style.setProperty('flex-shrink', '0');
  button.style.setProperty('width', 'max-content');
  button.append(popup);
  search.before(button);

  let revision = 0;
  async function apply(choice: string | null) {
    if (!pane.tagSelector && choice) await pane.toggleTagSelector();
    const tags: Set<string> | undefined = pane.tagSelector?.getTagSelection();
    if (!tags) return;
    const next = nextRankSelection(tags, choice);
    // Keep the native selector and item tree on the same selection, including ordinary tags.
    tags.clear();
    for (const tag of next) tags.add(tag);
    await pane.updateTagFilter();
  }

  function item(label: string, parent: Element, action?: () => Promise<void>): Element {
    const entry = doc.createXULElement('menuitem');
    entry.setAttribute('label', label);
    if (action) entry.addEventListener('command', () => void action().catch(error => Zotero.logError(error)));
    else entry.setAttribute('disabled', 'true');
    parent.append(entry);
    return entry;
  }

  async function populate() {
    const request = ++revision;
    const rows = pane.getCollectionTreeRows() as Array<{ isCollection(): boolean; isLibrary(group?: boolean): boolean; isSearch(): boolean; ref: { libraryID: number } }>;
    popup.replaceChildren();
    if (!rows.length || !rows.every(row => row.isCollection() || row.isLibrary(true) || row.isSearch())) {
      item(zh ? '请选择文献库、分类或已保存的搜索' : 'Select a library, collection, or saved search', popup);
      return;
    }
    item(zh ? '正在读取等级…' : 'Loading ranks…', popup);
    const libraries = [...new Set(rows.map(row => row.ref.libraryID))];
    const tags = (await Promise.all(libraries.map(id => Zotero.Tags.getAll(id))))
      .flatMap(entries => entries.map(({ tag }: { tag: string }) => tag));
    if (request !== revision) return;

    const selected: Set<string> = pane.tagSelector?.getTagSelection() ?? new Set();
    const selectedRanks = [...selected].filter(tag => publicationRankTag(tag, zh));
    const groups = rankFilterOptions([...tags, ...selectedRanks], zh);
    popup.replaceChildren();
    item(zh ? '清除等级筛选' : 'Clear rank filters', popup, selectedRanks.length ? () => apply(null) : undefined);
    popup.append(doc.createXULElement('menuseparator'));
    if (!groups.length) item(zh ? '此文献库暂无已保存的等级' : 'No saved ranks in this library', popup);
    for (const group of groups) {
      const menu = doc.createXULElement('menu');
      const optionsPopup = doc.createXULElement('menupopup');
      menu.setAttribute('label', group.label);
      for (const { tag, value } of group.options) {
        const option = item(value, optionsPopup, () => apply(tag));
        option.setAttribute('type', 'checkbox');
        option.setAttribute('checked', String(selected.has(tag)));
      }
      menu.append(optionsPopup);
      popup.append(menu);
    }
  }

  popup.addEventListener('popupshowing', (event: Event) => {
    if (event.target !== popup) return;
    void populate().catch(error => {
      Zotero.logError(error);
      popup.replaceChildren();
      item(zh ? '无法读取等级' : 'Could not load ranks', popup);
    });
  });
  popup.addEventListener('popuphidden', (event: Event) => { if (event.target === popup) revision++; });
  return () => { revision++; button.remove(); };
}
