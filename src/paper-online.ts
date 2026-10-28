import {
  lookupConferenceRank, publicationField, resolvePaperItem, saveConferenceRanks, saveJournal, saveQuartile,
  saveJournalRanks,
} from './paper-metadata';

export type LookupType = 'conference' | 'journal' | 'preprint' | 'other';

export interface PublicationLookup {
  title: string;
  type: LookupType;
  venue: string;
  year: string;
  doi: string;
  source: string;
  ccf: string;
  core: string;
  jcr?: string;
  cas?: string;
  ranks?: Record<string, string>;
  rankSource?: string;
  rankError?: string;
}

type Fetcher = typeof fetch;

function titleKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function field(item: any, name: string): string {
  try { return String(item.getField(name) || ''); } catch { return ''; }
}

function arxivID(value: string): string {
  return value.match(/arxiv(?:\.org\/(?:abs|pdf)\/|[:./])(\d{4}\.\d{4,5}|[a-z-]+\/\d{7})(?:v\d+)?/i)?.[1] || '';
}

function xmlText(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match?.[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim() || '';
}

async function json(fetcher: Fetcher, url: string): Promise<any> {
  if ((globalThis as any).Zotero?.HTTP?.request) {
    const response = await Zotero.HTTP.request('GET', url, { responseType: 'json', timeout: 15000 });
    return response.response;
  }
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

async function text(fetcher: Fetcher, url: string): Promise<string> {
  if ((globalThis as any).Zotero?.HTTP?.request) {
    const response = await Zotero.HTTP.request('GET', url, { responseType: 'text', timeout: 15000 });
    return response.response;
  }
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function crossrefByDOI(fetcher: Fetcher, doi: string): Promise<PublicationLookup | null> {
  try {
    const data = await json(fetcher, `https://api.crossref.org/works/${encodeURIComponent(doi)}`);
    const work = data?.message;
    if (!work) return null;
    const title = String(work.title?.[0] || '');
    if (!title) return null;
    const typeMap: Record<string, LookupType> = {
      'journal-article': 'journal', 'proceedings-article': 'conference',
      'book-chapter': 'other', posted: 'preprint',
    };
    return {
      title,
      type: typeMap[work.type] || 'other',
      venue: String(work['container-title']?.[0] || work.event?.name || ''),
      year: String(work.published?.['date-parts']?.[0]?.[0] || work.issued?.['date-parts']?.[0]?.[0] || ''),
      doi: String(work.DOI || doi),
      source: 'Crossref',
      ccf: '', core: '',
    };
  } catch { return null; }
}

async function crossrefByTitle(fetcher: Fetcher, title: string): Promise<PublicationLookup | null> {
  try {
    const url = `https://api.crossref.org/works?query.title=${encodeURIComponent(title)}&rows=8&select=DOI,title,type,container-title,event,published,issued`;
    const data = await json(fetcher, url);
    const matches = (data?.message?.items || []).filter((work: any) =>
      titleKey(String(work.title?.[0] || '')) === titleKey(title));
    const work = matches[0];
    if (!work) return null;
    const typeMap: Record<string, LookupType> = {
      'journal-article': 'journal', 'proceedings-article': 'conference',
      'book-chapter': 'other', posted: 'preprint',
    };
    return {
      title: String(work.title?.[0] || title),
      type: typeMap[work.type] || 'other',
      venue: String(work['container-title']?.[0] || work.event?.name || ''),
      year: String(work.published?.['date-parts']?.[0]?.[0] || work.issued?.['date-parts']?.[0]?.[0] || ''),
      doi: String(work.DOI || ''),
      source: 'Crossref',
      ccf: '', core: '',
    };
  } catch { return null; }
}

async function openAlexByTitle(fetcher: Fetcher, title: string): Promise<{ lookup: PublicationLookup; arxiv: string } | null> {
  try {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(title)}&per-page=8&select=doi,title,publication_year,type,primary_location`;
    const data = await json(fetcher, url);
    const work = (data?.results || []).find((item: any) => titleKey(String(item.title || '')) === titleKey(title));
    if (!work) return null;
    const source = work.primary_location?.source;
    const doi = String(work.doi || '').replace(/^https?:\/\/doi\.org\//, '');
    const arxiv = arxivID(doi);
    const type: LookupType = work.type === 'conference-paper' ? 'conference'
      : work.type === 'article' && source?.type === 'journal' ? 'journal'
        : work.type === 'preprint' ? 'preprint' : 'other';
    return {
      arxiv,
      lookup: {
        title: String(work.title || title), type,
        venue: String(source?.display_name || ''),
        year: String(work.publication_year || ''), doi,
        source: 'OpenAlex', ccf: '', core: '',
      },
    };
  } catch { return null; }
}

async function arxivLookup(fetcher: Fetcher, id: string, fallback: PublicationLookup): Promise<PublicationLookup | null> {
  try {
    const xml = await text(fetcher, `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`);
    const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/i)?.[1] || '';
    const journalRef = xmlText(entry, 'arxiv:journal_ref');
    const comment = xmlText(entry, 'arxiv:comment');
    const published = xmlText(entry, 'published');
    const conference = /conference|proceedings|workshop|symposium|congress|ICML|NeurIPS|CVPR|ACL/i.test(`${journalRef} ${comment}`);
    const venue = journalRef || comment;
    return {
      ...fallback, type: conference ? 'conference' : fallback.type,
      venue: conference ? venue : fallback.venue,
      year: String(published.slice(0, 4) || fallback.year),
      doi: fallback.doi, source: fallback.source ? `arXiv / ${fallback.source}` : 'arXiv',
    };
  } catch { return null; }
}

function rankValue(ranks: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    const value = String(ranks[key] || '').trim();
    if (value) return value;
  }
  return '';
}

async function easyScholarLookup(fetcher: Fetcher, apiKey: string, publicationName: string) {
  const url = `https://easyscholar.cc/open/getPublicationRank?secretKey=${encodeURIComponent(apiKey)}` +
    `&publicationName=${encodeURIComponent(publicationName)}`;
  const data = await json(fetcher, url);
  if (data.code !== undefined && data.code !== 200) throw new Error(data.msg || `EasyScholar HTTP ${data.code}`);
  if (!data?.data) return { ranks: {} as Record<string, string>, jcr: '', cas: '', ccf: '' };
  const ranks: Record<string, string> = { ...(data.data.officialRank?.all || {}) };
  const custom = data.data.customRank;
  if (Array.isArray(custom?.rank) && Array.isArray(custom?.rankInfo)) {
    for (const entry of custom.rank) {
      const [uuid, rankNumber] = String(entry).split('&&&');
      const info = custom.rankInfo.find((item: any) => item.uuid === uuid);
      const property = ({ 1: 'oneRankText', 2: 'twoRankText', 3: 'threeRankText', 4: 'fourRankText', 5: 'fiveRankText' } as Record<string, string>)[rankNumber];
      if (info?.abbName && property && info[property]) ranks[info.abbName] = String(info[property]);
    }
  }
  const sci = rankValue(ranks, 'sci', 'SSCI');
  const cas = rankValue(ranks, 'sciUp', 'sciBase');
  const ccfRaw = rankValue(ranks, 'ccf');
  const ccfAlias = ({ T1: 'A', T2: 'B', T3: 'C' } as Record<string, string>)[ccfRaw.toUpperCase()] || ccfRaw.toUpperCase();
  return {
    ranks,
    jcr: /^Q[1-4]$/i.test(sci) ? `JCR-Q${sci.slice(1)}` : '',
    cas: /^[1-4]区$/.test(cas) ? `CAS-${cas[0]}` : '',
    ccf: ['A', 'B', 'C'].includes(ccfAlias) ? ccfAlias : '',
  };
}

function score(candidate: PublicationLookup, requestedTitle: string): number {
  const exact = titleKey(candidate.title) === titleKey(requestedTitle);
  const rank = lookupConferenceRank(candidate.venue) || lookupConferenceRank(candidate.title);
  if (rank) { candidate.ccf = rank.ccf; candidate.core = rank.core; }
  return (exact ? 100 : 0) + (candidate.type === 'conference' ? 30 : candidate.type === 'journal' ? 20 : 5)
    + (candidate.venue ? 10 : 0) + (rank ? 20 : 0);
}

export async function lookupPublication(item: any, fetcher: Fetcher = fetch,
  easyScholarApiKey = ''): Promise<PublicationLookup> {
  const paper = resolvePaperItem(item);
  if (!paper) throw new Error('请选择论文条目或论文附件。');
  const title = field(paper, 'title');
  if (!title) throw new Error('条目缺少论文标题，无法在线查询。');
  const doi = field(paper, 'DOI').replace(/^https?:\/\/doi\.org\//, '');
  const candidates: PublicationLookup[] = [];

  if (doi && !arxivID(doi)) {
    const result = await crossrefByDOI(fetcher, doi);
    if (result) candidates.push(result);
  }

  const openAlex = await openAlexByTitle(fetcher, title);
  let base = openAlex?.lookup;
  if (base) candidates.push(base);
  if (openAlex?.arxiv) {
    const arxiv = await arxivLookup(fetcher, openAlex.arxiv, base!);
    if (arxiv) {
      candidates.push(arxiv);
      base = arxiv;
    }
  } else if (arxivID(doi)) {
    const fallback: PublicationLookup = {
      title, type: 'preprint', venue: 'arXiv', year: '', doi, source: 'arXiv', ccf: '', core: '',
    };
    const arxiv = await arxivLookup(fetcher, arxivID(doi), fallback);
    if (arxiv) { candidates.push(arxiv); base = arxiv; }
  }

  if (!candidates.some(candidate => candidate.type === 'journal') || !base?.venue) {
    const crossref = await crossrefByTitle(fetcher, title);
    if (crossref) candidates.push(crossref);
  }
  if (!candidates.length) throw new Error('在线数据库未找到可信匹配。');
  candidates.sort((a, b) => score(b, title) - score(a, title));
  const best = candidates[0];
  if (score(best, title) < 100) throw new Error('在线结果与论文标题不完全匹配，请先检查元数据或手动填写。');
  if (easyScholarApiKey && best.venue) {
    try {
      let easy = await easyScholarLookup(fetcher, easyScholarApiKey.trim(), best.venue);
      if (!Object.keys(easy.ranks).length) {
        const conference = lookupConferenceRank(best.venue);
        const fallbackName = conference?.acronym ||
          best.venue.replace(/\b(?:19|20)\d{2}\b/g, '').replace(/[,;]\s*$/, '').trim();
        if (fallbackName && fallbackName !== best.venue) {
          easy = await easyScholarLookup(fetcher, easyScholarApiKey.trim(), fallbackName);
        }
      }
      best.ranks = easy.ranks;
      best.jcr = easy.jcr;
      best.cas = easy.cas;
      best.ccf = easy.ccf || best.ccf;
      best.rankSource = 'EasyScholar';
    } catch (error) {
      best.rankError = error instanceof Error ? error.message : String(error);
    }
  }
  return best;
}

export async function applyPublicationLookup(item: any, result: PublicationLookup): Promise<void> {
  const paper = resolvePaperItem(item);
  if (!paper) throw new Error('请选择论文条目或论文附件。');
  const typeName = result.type === 'conference' ? 'conferencePaper'
    : result.type === 'journal' ? 'journalArticle'
      : result.type === 'preprint' ? 'preprint' : '';
  const typeID = typeName ? Zotero.ItemTypes.getID(typeName) : false;
  if (typeID && paper.itemTypeID !== typeID) paper.setType(typeID);
  if (result.venue) await saveJournal(paper, result.venue);
  if (result.doi) {
    try { paper.setField('DOI', result.doi); } catch { /* Unsupported optional field. */ }
  }
  if (result.year && !field(paper, 'date')) {
    try { paper.setField('date', result.year); } catch { /* Unsupported optional field. */ }
  }
  if (result.type === 'conference') {
    await saveQuartile(paper, '');
    await saveConferenceRanks(paper, { ccf: result.ccf, core: result.core, conference: result.venue });
  } else {
    if (result.jcr || result.cas) await saveJournalRanks(paper, { jcr: result.jcr || '', cas: result.cas || '' });
    await saveConferenceRanks(paper, { ccf: '', core: '', conference: '' });
  }
  await paper.saveTx();
}
