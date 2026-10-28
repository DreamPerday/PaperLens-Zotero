import conferenceData from './paper-ranks/ccf.json';

const TAG_PREFIX = 'PaperLens/';
const EASYSCHOLAR_TAG_PREFIX = `${TAG_PREFIX}EasyScholar:`;
const CCF_VALUES = new Set(['A', 'B', 'C']);
const CORE_VALUES = new Set(['A*', 'A', 'B', 'C']);
const EASYSCHOLAR_STANDARD_KEYS = new Set(['sci', 'sciup', 'scibase', 'ccf', 'ssci']);
const EASYSCHOLAR_DATASET_NAMES: Record<string, string> = {
  hzau: '华中农业大学',
};

interface ConferenceRecord {
  acronym: string;
  name: string;
  ccf: string;
  core: string;
  key: string;
}

const CONFERENCES = conferenceData as ConferenceRecord[];

export const QUARTILES = [
  { value: 'JCR-Q1', label: 'JCR Q1' },
  { value: 'JCR-Q2', label: 'JCR Q2' },
  { value: 'JCR-Q3', label: 'JCR Q3' },
  { value: 'JCR-Q4', label: 'JCR Q4' },
  { value: 'CAS-1', label: '中科院 1区' },
  { value: 'CAS-2', label: '中科院 2区' },
  { value: 'CAS-3', label: '中科院 3区' },
  { value: 'CAS-4', label: '中科院 4区' },
] as const;

const QUARTILE_VALUES = new Set<string>(QUARTILES.map(item => item.value));
const PUBLICATION_FIELDS = ['publicationTitle', 'proceedingsTitle', 'bookTitle', 'repository', 'websiteTitle'];

export function resolvePaperItem(item: any): any | null {
  if (!item) return null;
  if (item.isRegularItem?.()) return item;
  if (item.isAttachment?.() && item.parentID) {
    const parent = Zotero.Items.get(item.parentID);
    return parent?.isRegularItem?.() ? parent : null;
  }
  return null;
}

export function publicationField(item: any): string | null {
  const fields = Zotero.ItemFields;
  for (const field of PUBLICATION_FIELDS) {
    const id = fields.getID(field);
    if (id && fields.isValidForType(id, item.itemTypeID)) return field;
  }
  return null;
}

export function getJournal(item: any): string {
  const paper = resolvePaperItem(item);
  if (!paper) return '';
  const field = publicationField(paper);
  return field ? String(paper.getField(field) || '') : '';
}

export function getQuartile(item: any): string {
  const paper = resolvePaperItem(item);
  if (!paper) return '';
  return paper.getTags()
    .map((entry: any) => String(entry.tag || ''))
    .find((tag: string) => tag.startsWith(TAG_PREFIX) && QUARTILE_VALUES.has(tag.slice(TAG_PREFIX.length)))
    ?.slice(TAG_PREFIX.length) || '';
}

export function quartileTag(value: string): string {
  return QUARTILE_VALUES.has(value) ? `${TAG_PREFIX}${value}` : '';
}

export function getJournalRanks(item: any): { jcr: string; cas: string } {
  const values = [getQuartile(item)];
  const paper = resolvePaperItem(item);
  if (!paper) return { jcr: '', cas: '' };
  for (const entry of paper.getTags()) {
    const tag = String(entry.tag || '');
    if (tag.startsWith(TAG_PREFIX) && QUARTILE_VALUES.has(tag.slice(TAG_PREFIX.length))) {
      values.push(tag.slice(TAG_PREFIX.length));
    }
  }
  return {
    jcr: values.find(value => value.startsWith('JCR-')) || '',
    cas: values.find(value => value.startsWith('CAS-')) || '',
  };
}

export function journalRanksLabel(ranks: { jcr: string; cas: string }): string {
  return [quartileLabel(ranks.jcr), quartileLabel(ranks.cas)].filter(Boolean).join(' · ');
}

export function parseJournalRanksInput(value: string): { jcr: string; cas: string } {
  const compact = value.trim().toLowerCase().replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '').replace(/\s+/g, '');
  if (!compact || compact === '未设置' || compact === 'notset') return { jcr: '', cas: '' };
  const jcrMatch = compact.match(/jcrq?([1-4])/) || compact.match(/q([1-4])/);
  const casMatch = compact.match(/cas([1-4])/) || compact.match(/中科院([1-4])区/) || compact.match(/([1-4])区/);
  if (!jcrMatch && !casMatch) throw new Error('请输入 JCR Q1–Q4 或中科院 1区–4区，留空可清除。');
  return {
    jcr: jcrMatch ? `JCR-Q${jcrMatch[1]}` : '',
    cas: casMatch ? `CAS-${casMatch[1]}` : '',
  };
}

export function quartileLabel(value: string): string {
  return QUARTILES.find(item => item.value === value)?.label || '';
}

export function parseQuartileInput(value: string): string {
  const compact = value.trim().toLowerCase().replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '').replace(/\s+/g, '');
  if (!compact || compact === '未设置' || compact === 'notset') return '';
  const aliases: Record<string, string> = {
    q1: 'JCR-Q1', q2: 'JCR-Q2', q3: 'JCR-Q3', q4: 'JCR-Q4',
    jcrq1: 'JCR-Q1', jcrq2: 'JCR-Q2', jcrq3: 'JCR-Q3', jcrq4: 'JCR-Q4',
    jcr1: 'JCR-Q1', jcr2: 'JCR-Q2', jcr3: 'JCR-Q3', jcr4: 'JCR-Q4',
    '1区': 'CAS-1', '2区': 'CAS-2', '3区': 'CAS-3', '4区': 'CAS-4',
    cas1: 'CAS-1', cas2: 'CAS-2', cas3: 'CAS-3', cas4: 'CAS-4',
    中科院1区: 'CAS-1', 中科院2区: 'CAS-2', 中科院3区: 'CAS-3', 中科院4区: 'CAS-4',
  };
  const parsed = aliases[compact];
  if (!parsed) throw new Error('请输入 Q1–Q4 或中科院 1区–4区，留空可清除。');
  return parsed;
}

export function lookupConferenceRank(venue: string): ConferenceRecord | null {
  const normalized = venue.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!normalized) return null;
  let best: ConferenceRecord | null = null;
  let bestScore = 0;
  for (const record of CONFERENCES) {
    const acronym = record.acronym.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const name = record.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    let score = 0;
    if (acronym.length >= 2 && (` ${normalized} `).includes(` ${acronym} `)) score = 100 + acronym.length;
    if (name && (normalized.includes(name) || name.includes(normalized))) score = Math.max(score, 200 + name.length);
    if (score > bestScore) { best = record; bestScore = score; }
  }
  return best;
}

export function getConferenceRanks(item: any): { ccf: string; core: string; conference: string } {
  const paper = resolvePaperItem(item);
  if (!paper) return { ccf: '', core: '', conference: '' };
  let ccf = '', core = '', conference = '';
  for (const entry of paper.getTags()) {
    const tag = String(entry.tag || '');
    if (tag.startsWith(`${TAG_PREFIX}CCF-`)) ccf = tag.slice(TAG_PREFIX.length + 4);
    else if (tag.startsWith(`${TAG_PREFIX}CORE-`)) core = tag.slice(TAG_PREFIX.length + 5);
    else if (tag.startsWith(`${TAG_PREFIX}Conference-`)) conference = tag.slice(TAG_PREFIX.length + 11);
  }
  return { ccf: CCF_VALUES.has(ccf) ? ccf : '', core: CORE_VALUES.has(core) ? core : '', conference };
}

export function conferenceRankLabel(ranks: { ccf: string; core: string }): string {
  const parts = [];
  if (ranks.ccf) parts.push(`CCF-${ranks.ccf}`);
  if (ranks.core) parts.push(`CORE-${ranks.core}`);
  return parts.join(' · ');
}

const TAG_COLORS: Record<string, string> = {
  'JCR-Q1': '#B8860B', 'JCR-Q2': '#2E7D5B', 'JCR-Q3': '#2F6FA3', 'JCR-Q4': '#6B7280',
  'CAS-1': '#B33A3A', 'CAS-2': '#C46A1B', 'CAS-3': '#9A7B16', 'CAS-4': '#6B7280',
  'CCF-A': '#7A3E9D', 'CCF-B': '#2F6FA3', 'CCF-C': '#3A8055',
  'CORE-A*': '#B03366', 'CORE-A': '#7A3E9D', 'CORE-B': '#2F6FA3', 'CORE-C': '#3A8055',
};

const CUSTOM_TAG_COLORS = ['#3E6FA8', '#2E7D5B', '#8A5A9C', '#B15D2A', '#A03F5B', '#8A751D'];

export function tagColor(value: string): string {
  return TAG_COLORS[value] || '#6B7280';
}

export function customTagColor(key: string): string {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return CUSTOM_TAG_COLORS[hash % CUSTOM_TAG_COLORS.length];
}

async function colorTag(paper: any, name: string, value: string): Promise<void> {
  const color = value.startsWith('CUSTOM:') ? customTagColor(value.slice(7)) : TAG_COLORS[value];
  if (!color || !Zotero.Tags?.setColor) return;
  try {
    const libraryID = paper.libraryID;
    if (Zotero.Tags.getColor(libraryID, name)) return;
    if (Zotero.Tags.getColors(libraryID).size >= Zotero.Tags.MAX_COLORED_TAGS) return;
    let position = 0;
    while (Zotero.Tags.getColorByPosition(libraryID, position)) position++;
    await Zotero.Tags.setColor(libraryID, name, color, position);
  } catch (error) { Zotero.logError?.(error); }
}

export function parseConferenceRank(value: string): { ccf?: string; core?: string } {
  const compact = value.toUpperCase().replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '').replace(/\s+/g, '');
  if (!compact || compact === '未设置') return { ccf: '', core: '' };
  const core = compact.match(/CORE-?(A\*|A|B|C)/)?.[1];
  if (core && CORE_VALUES.has(core)) return { core };
  const ccf = compact.match(/CCF-?([ABC])/)?.[1] || compact.match(/^([ABC])$/)?.[1];
  if (ccf && CCF_VALUES.has(ccf)) return { ccf };
  throw new Error('请输入 CCF-A/B/C 或 CORE-A*/A/B/C，留空可清除。');
}

export async function saveConferenceRanks(item: any,
  value: { ccf?: string; core?: string; conference?: string }): Promise<void> {
  const paper = resolvePaperItem(item);
  if (!paper) throw new Error('请选择论文条目或论文附件。');
  const current = getConferenceRanks(paper);
  const ccf = value.ccf === undefined ? current.ccf : value.ccf;
  const core = value.core === undefined ? current.core : value.core;
  const conference = value.conference === undefined ? current.conference : value.conference;
  const tags = paper.getTags().filter((entry: any) => {
    const tag = String(entry.tag || '');
    return !/^PaperLens\/(CCF-[ABC]|CORE-(A\*|A|B|C)|Conference-.+)$/.test(tag);
  });
  if (CCF_VALUES.has(ccf)) tags.push({ tag: `${TAG_PREFIX}CCF-${ccf}`, type: 1 });
  if (CORE_VALUES.has(core)) tags.push({ tag: `${TAG_PREFIX}CORE-${core}`, type: 1 });
  if (conference) tags.push({ tag: `${TAG_PREFIX}Conference-${conference.replaceAll('/', '-')}`, type: 1 });
  paper.setTags(tags);
  await paper.saveTx();
  if (CCF_VALUES.has(ccf)) await colorTag(paper, `${TAG_PREFIX}CCF-${ccf}`, `CCF-${ccf}`);
  if (CORE_VALUES.has(core)) await colorTag(paper, `${TAG_PREFIX}CORE-${core}`, `CORE-${core}`);
}

export interface EasyScholarRank {
  key: string;
  name: string;
  value: string;
}

export interface EasyScholarDataset {
  key: string;
  name: string;
  levels: string[];
  matched: string;
}

export function easyScholarRankName(key: string): string {
  return EASYSCHOLAR_DATASET_NAMES[key.toLowerCase()] || key;
}

export function isEasyScholarStandardKey(key: string): boolean {
  return EASYSCHOLAR_STANDARD_KEYS.has(key.toLowerCase());
}

export function getEasyScholarRanks(item: any): EasyScholarRank[] {
  const paper = resolvePaperItem(item);
  if (!paper) return [];
  return paper.getTags()
    .map((entry: any) => String(entry.tag || ''))
    .filter((tag: string) => tag.startsWith(EASYSCHOLAR_TAG_PREFIX))
    .map((tag: string) => {
      const value = tag.slice(EASYSCHOLAR_TAG_PREFIX.length);
      const index = value.indexOf('=');
      const key = index > 0 ? value.slice(0, index) : '';
      return key ? { key, name: easyScholarRankName(key), value: value.slice(index + 1) } : null;
    })
    .filter((value: EasyScholarRank | null): value is EasyScholarRank => Boolean(value));
}

export function easyScholarRanksLabel(item: any): string {
  return getEasyScholarRanks(item).map(rank => `${rank.name}: ${rank.value}`).join(' · ');
}

export function easyScholarRanksSummary(ranks: Record<string, string> | undefined): string {
  return Object.entries(ranks || {})
    .filter(([key, value]) => !isEasyScholarStandardKey(key) && String(value || '').trim())
    .map(([key, value]) => `${easyScholarRankName(key)}: ${String(value).trim()}`)
    .join(' · ');
}

export function unmatchedEasyScholarDatasetsSummary(datasets: EasyScholarDataset[] | undefined): string {
  return (datasets || [])
    .filter(dataset => !dataset.matched)
    .map(dataset => {
      const levels = dataset.levels.length ? `（可选 ${dataset.levels.join(' / ')}）` : '';
      return `${dataset.name}：未匹配${levels}`;
    })
    .join(' · ');
}

export async function saveEasyScholarRanks(item: any, ranks: Record<string, string>): Promise<void> {
  const paper = resolvePaperItem(item);
  if (!paper) return;
  const tags = paper.getTags().filter((entry: any) => !String(entry.tag || '').startsWith(EASYSCHOLAR_TAG_PREFIX));
  const added: Array<{ tag: string; value: string }> = [];
  for (const [key, raw] of Object.entries(ranks)) {
    const value = String(raw || '').trim();
    if (!value || isEasyScholarStandardKey(key)) continue;
    const tag = `${EASYSCHOLAR_TAG_PREFIX}${key}=${value}`;
    tags.push({ tag, type: 1 });
    added.push({ tag, value: key });
  }
  paper.setTags(tags);
  await paper.saveTx();
  for (const { tag, value } of added) await colorTag(paper, tag, `CUSTOM:${value}`);
}

export function tagsWithQuartile(tags: Array<{ tag: string; type?: number }>, value: string): Array<{ tag: string; type?: number }> {
  const remaining = tags.filter(entry => {
    const tag = String(entry.tag || '');
    return !tag.startsWith(TAG_PREFIX) || !QUARTILE_VALUES.has(tag.slice(TAG_PREFIX.length));
  });
  const tag = quartileTag(value);
  return tag ? [...remaining, { tag, type: 1 }] : remaining;
}

export async function saveJournalRanks(item: any,
  value: { jcr: string; cas: string }): Promise<void> {
  const paper = resolvePaperItem(item);
  if (!paper) throw new Error('请选择论文条目或论文附件。');
  const tags = paper.getTags().filter((entry: any) => {
    const tag = String(entry.tag || '');
    return !tag.startsWith(TAG_PREFIX) || !QUARTILE_VALUES.has(tag.slice(TAG_PREFIX.length));
  });
  const jcr = QUARTILE_VALUES.has(value.jcr) && value.jcr.startsWith('JCR-') ? value.jcr : '';
  const cas = QUARTILE_VALUES.has(value.cas) && value.cas.startsWith('CAS-') ? value.cas : '';
  if (jcr) tags.push({ tag: `${TAG_PREFIX}${jcr}`, type: 1 });
  if (cas) tags.push({ tag: `${TAG_PREFIX}${cas}`, type: 1 });
  paper.setTags(tags);
  await paper.saveTx();
  if (jcr) await colorTag(paper, `${TAG_PREFIX}${jcr}`, jcr);
  if (cas) await colorTag(paper, `${TAG_PREFIX}${cas}`, cas);
}

export async function saveJournal(item: any, value: string): Promise<string> {
  const paper = resolvePaperItem(item);
  const field = paper && publicationField(paper);
  if (!paper || !field) throw new Error('该条目类型没有可保存的期刊或出版物字段。');
  const next = value.trim();
  if (paper.getField(field) !== next) {
    paper.setField(field, next);
    await paper.saveTx();
  }
  return next;
}

export async function saveQuartile(item: any, value: string): Promise<string> {
  const paper = resolvePaperItem(item);
  if (!paper) throw new Error('请选择论文条目或论文附件。');
  const next = value === '' || QUARTILE_VALUES.has(value) ? value : parseQuartileInput(value);
  paper.setTags(tagsWithQuartile(paper.getTags(), next));
  await paper.saveTx();
  if (next) await colorTag(paper, `${TAG_PREFIX}${next}`, next);
  return next;
}
