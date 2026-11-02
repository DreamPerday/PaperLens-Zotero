import {
  customTagColor, getConferenceRanks, getEasyScholarRanks, getJournal, getJournalRanks,
  quartileLabel, tagColor,
} from './paper-metadata';

const HTML = 'http://www.w3.org/1999/xhtml';
type ColumnKind = 'publication' | 'year' | 'ranks';

export function publicationColumnData(item: any, kind: ColumnKind): string {
  // Keep attachment/note rows empty; the parent paper owns the metadata.
  if (!item?.isRegularItem?.()) return '';
  if (kind === 'publication') return getJournal(item);
  if (kind === 'year') return String(item.getField('date') || '').match(/\b(?:1[5-9]|20|21)\d{2}\b/)?.[0] || '';
  return publicationBadges(item).map(badge => badge.label).join(' · ');
}

function publicationBadges(item: any) {
  const journal = getJournalRanks(item);
  const conference = getConferenceRanks(item);
  return [journal.jcr, journal.cas, conference.ccf ? `CCF-${conference.ccf}` : '',
    conference.core ? `CORE-${conference.core}` : ''].filter(Boolean).map(value => ({
    label: quartileLabel(value) || value, color: tagColor(value),
  })).concat(getEasyScholarRanks(item).map(rank => ({
    label: `${rank.name}: ${rank.value}`, color: customTagColor(rank.key),
  })));
}

export function registerPublicationColumns(pluginID: string): () => void {
  const zh = Zotero.locale.startsWith('zh');
  const badgeColors = new Map<string, string>();
  const definitions: Array<{ kind: ColumnKind; label: string; width?: string }> = [
    { kind: 'publication', label: zh ? '期刊 / 出版物' : 'Publication' },
    { kind: 'year', label: zh ? '年份' : 'Year', width: '64' },
    { kind: 'ranks', label: zh ? '分区 / 会议 / 自定义等级' : 'Journal / conference / custom ranks' },
  ];
  const keys = definitions.map(({ kind, label, width }) => Zotero.ItemTreeManager.registerColumn({
    dataKey: `paperlens-${kind}`, label, pluginID,
    ...(width ? { width, flex: 0 } : { flex: 1 }), minWidth: kind === 'year' ? 50 : 70,
    enabledTreeIDs: ['main'], defaultIn: ['default'],
    showInColumnPicker: true, columnPickerSubMenu: false,
    zoteroPersist: ['width', 'hidden', 'sortDirection'],
    dataProvider: (item: any) => {
      if (item?.isRegularItem?.() && kind === 'ranks') {
        for (const badge of publicationBadges(item)) badgeColors.set(badge.label, badge.color);
      }
      return publicationColumnData(item, kind);
    },
    renderCell: (index: number, data: string, column: any, _first: boolean, doc: Document) => {
      const cell = doc.createElementNS(HTML, 'span') as HTMLSpanElement;
      cell.className = `cell ${column.className}`;
      cell.title = data;
      cell.style.cssText = 'display:flex;align-items:center;gap:4px;min-width:0;overflow:hidden;';
      if (kind === 'publication' || kind === 'year') {
        const text = doc.createElementNS(HTML, 'span') as HTMLSpanElement;
        text.textContent = data;
        text.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        cell.append(text);
      } else {
        // renderCell does not receive the item; labels are separated by the same delimiter as the provider.
        for (const label of data.split(' · ').filter(Boolean)) {
          const badge = doc.createElementNS(HTML, 'span') as HTMLSpanElement;
          const color = badgeColors.get(label) || '#6B7280';
          badge.textContent = label;
          badge.style.cssText = `flex:none;padding:1px 6px;border-radius:4px;background:${color};color:#fff;font-size:11px;line-height:16px;`;
          cell.append(badge);
        }
      }
      return cell;
    },
  }));
  return () => { for (const key of keys) if (key) Zotero.ItemTreeManager.unregisterColumn(key); };
}
