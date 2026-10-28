import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPublicationLookup, lookupPublication } from '../src/paper-online';

(globalThis as any).Zotero = {
  Items: { get: () => undefined },
  ItemFields: {
    getID: (name: string) => ({ publicationTitle: 10, proceedingsTitle: 11 })[name] || false,
    isValidForType: (id: number, typeID: number) => typeID === 1 ? id === 10 : typeID === 2 && id === 11,
  },
  ItemTypes: {
    getID: (name: string) => ({ journalArticle: 1, conferencePaper: 2, preprint: 3 })[name] || false,
  },
};

function item(title: string, doi = '') {
  return {
    itemTypeID: 1,
    isRegularItem: () => true,
    isAttachment: () => false,
    getField: (name: string) => name === 'title' ? title : name === 'DOI' ? doi : '',
  };
}

const articleTitle = 'EfficientNet: Rethinking Model Scaling for Convolutional Neural Networks';

test('arXiv comments upgrade an OpenAlex preprint to ICML conference metadata', async () => {
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('api.openalex.org')) {
      return Response.json({ results: [{
        doi: 'https://doi.org/10.48550/arxiv.1905.11946',
        title: articleTitle, publication_year: 2019, type: 'preprint',
        primary_location: { source: { display_name: 'arXiv (Cornell University)', type: 'repository' } },
      }] });
    }
    if (url.includes('export.arxiv.org')) {
      return new Response(`<feed><entry><title>${articleTitle}</title><published>2019-05-28T00:00:00Z</published><arxiv:comment>ICML 2019</arxiv:comment><arxiv:journal_ref>International Conference on Machine Learning, 2019</arxiv:journal_ref></entry></feed>`,
        { headers: { 'Content-Type': 'application/atom+xml' } });
    }
    return Response.json({ message: { items: [] } });
  }) as typeof fetch;
  const result = await lookupPublication(item(articleTitle), fetcher);
  assert.equal(result.type, 'conference');
  assert.match(result.venue, /International Conference on Machine Learning/);
  assert.equal(result.ccf, 'A');
  assert.equal(result.core, 'A*');
});

test('Crossref DOI metadata fills a journal venue', async () => {
  const title = 'A Journal Article About Retrieval';
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('api.crossref.org/works/')) {
      return Response.json({ message: {
        DOI: '10.1000/example', title: [title], type: 'journal-article',
        'container-title': ['Journal of Testing'], published: { 'date-parts': [[2024]] },
      } });
    }
    if (url.includes('api.openalex.org')) return Response.json({ results: [] });
    return Response.json({ message: { items: [] } });
  }) as typeof fetch;
  const result = await lookupPublication(item(title, '10.1000/example'), fetcher);
  assert.equal(result.type, 'journal');
  assert.equal(result.venue, 'Journal of Testing');
  assert.equal(result.year, '2024');
  assert.equal(result.source, 'Crossref');
});

test('confirmed online metadata updates item type, venue and colored rank tags', async () => {
  const values: Record<string, string> = {};
  let tags: Array<{ tag: string; type?: number }> = [];
  let typeID = 1;
  let saves = 0;
  const target = {
    itemTypeID: typeID,
    isRegularItem: () => true,
    isAttachment: () => false,
    getField: (name: string) => values[name] || '',
    setField: (name: string, value: string) => { values[name] = value; },
    setType: (id: number) => { typeID = id; target.itemTypeID = id; },
    getTags: () => tags,
    setTags: (next: Array<{ tag: string; type?: number }>) => { tags = next; },
    saveTx: async () => { saves++; },
  };
  await applyPublicationLookup(target, {
    title: articleTitle, type: 'conference',
    venue: 'International Conference on Machine Learning, 2019', year: '2019',
    doi: '10.48550/arxiv.1905.11946', source: 'arXiv / OpenAlex', ccf: 'A', core: 'A*',
  });
  assert.equal(typeID, 2);
  assert.equal(values.proceedingsTitle, 'International Conference on Machine Learning, 2019');
  assert.equal(values.DOI, '10.48550/arxiv.1905.11946');
  assert.equal(values.date, '2019');
  assert.ok(tags.some(entry => entry.tag === 'PaperLens/CCF-A'));
  assert.ok(tags.some(entry => entry.tag === 'PaperLens/CORE-A*'));
  assert.ok(saves >= 1);
});

test('EasyScholar adds JCR and CAS ranks after metadata lookup', async () => {
  const title = 'A Journal Article With EasyScholar';
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('api.crossref.org/works/')) {
      return Response.json({ message: {
        DOI: '10.1000/easy', title: [title], type: 'journal-article',
        'container-title': ['Journal of Easy Testing'], published: { 'date-parts': [[2025]] },
      } });
    }
    if (url.includes('api.openalex.org')) return Response.json({ results: [] });
    if (url.includes('easyscholar.cc/open/getPublicationRank')) {
      return Response.json({ code: 200, data: {
        officialRank: { all: { sci: 'Q1', sciUp: '2区', ccf: 'A' } },
        customRank: { rank: [], rankInfo: [] },
      } });
    }
    return Response.json({ message: { items: [] } });
  }) as typeof fetch;
  const result = await lookupPublication(item(title, '10.1000/easy'), fetcher, 'easy-secret');
  assert.equal(result.jcr, 'JCR-Q1');
  assert.equal(result.cas, 'CAS-2');
  assert.equal(result.ccf, 'A');
  assert.equal(result.rankSource, 'EasyScholar');
});
