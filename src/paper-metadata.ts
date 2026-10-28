const TAG_PREFIX = 'PaperLens/';

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

export function quartileLabel(value: string): string {
  return QUARTILES.find(item => item.value === value)?.label || '';
}

export function parseQuartileInput(value: string): string {
  const compact = value.trim().toLowerCase().replace(/\s+/g, '');
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

export function tagsWithQuartile(tags: Array<{ tag: string; type?: number }>, value: string): Array<{ tag: string; type?: number }> {
  const remaining = tags.filter(entry => {
    const tag = String(entry.tag || '');
    return !tag.startsWith(TAG_PREFIX) || !QUARTILE_VALUES.has(tag.slice(TAG_PREFIX.length));
  });
  const tag = quartileTag(value);
  return tag ? [...remaining, { tag, type: 1 }] : remaining;
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
  return next;
}
