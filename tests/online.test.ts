import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPublicationLookup, easyScholarLookup, lookupPublication } from '../src/paper-online';
import { getEasyScholarRanks, saveEasyScholarRanks } from '../src/paper-metadata';

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
        customRank: {
          rank: ['hzau-uuid&&&2'],
          rankInfo: [{ uuid: 'hzau-uuid', abbName: 'hzau', twoRankText: 'A' }],
        },
      } });
    }
    return Response.json({ message: { items: [] } });
  }) as typeof fetch;
  const result = await lookupPublication(item(title, '10.1000/easy'), fetcher, 'easy-secret');
  assert.equal(result.jcr, 'JCR-Q1');
  assert.equal(result.cas, 'CAS-2');
  assert.equal(result.ccf, 'A');
  assert.equal(result.ranks?.hzau, 'A');
  assert.equal(result.rankSource, 'EasyScholar');
});

test('custom EasyScholar datasets are saved without duplicating standard rank tags', async () => {
  let tags: Array<{ tag: string; type?: number }> = [
    { tag: 'PaperLens/JCR-Q1', type: 1 },
    { tag: 'PaperLens/EasyScholar:old=G' },
  ];
  const target = {
    itemTypeID: 1,
    isRegularItem: () => true,
    isAttachment: () => false,
    getTags: () => tags,
    setTags: (next: Array<{ tag: string; type?: number }>) => { tags = next; },
    saveTx: async () => {},
  };

  await saveEasyScholarRanks(target, { hzau: 'A', sci: 'Q1', sciUp: '2区', ccf: 'A' });

  assert.ok(tags.some(entry => entry.tag === 'PaperLens/JCR-Q1'));
  assert.ok(tags.some(entry => entry.tag === 'PaperLens/EasyScholar:hzau=A'));
  assert.ok(!tags.some(entry => entry.tag === 'PaperLens/EasyScholar:old=G'));
  assert.ok(!tags.some(entry => entry.tag.startsWith('PaperLens/EasyScholar:sci')));
  assert.ok(!tags.some(entry => entry.tag.startsWith('PaperLens/EasyScholar:ccf')));
  assert.deepEqual(getEasyScholarRanks(target), [{ key: 'hzau', name: '华中农业大学', value: 'A' }]);
});

test('EasyScholar reports dataset levels without inventing a rank when rank is empty', async () => {
  const fetcher = (async () => Response.json({
    code: 200,
    msg: 'SUCCESS',
    data: {
      customRank: {
        rankInfo: [{
          uuid: '1659175510363230208',
          abbName: 'HZAU',
          oneRankText: 'A+',
          twoRankText: 'A',
          threeRankText: 'B',
          fourRankText: 'C',
        }],
        rank: [],
      },
      officialRank: {
        all: { uibe: 'A', swjtu: 'A++', hhu: 'A类', ccf: 'A', cpu: '理学学科顶尖' },
      },
    },
  })) as typeof fetch;

  const result = await easyScholarLookup(fetcher, 'secret', 'International Conference on Machine Learning');

  assert.equal(result.ranks.HZAU, undefined);
  assert.deepEqual(result.customDatasets.find(dataset => dataset.key === 'HZAU'), {
    key: 'HZAU',
    name: '华中农业大学',
    levels: ['A+', 'A', 'B', 'C'],
    matched: '',
  });
  assert.equal(result.customDatasets.find(dataset => dataset.key === 'uibe')?.matched, 'A');
});

test('EasyScholar retries a normalized venue when only dataset definitions were returned', async () => {
  const title = 'A Journal With A Year In Its Venue';
  const easyScholarRequests: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('api.openalex.org')) return Response.json({ results: [] });
    if (url.includes('api.crossref.org/works?')) {
      return Response.json({ message: { items: [{
        DOI: '10.1000/fallback', title: [title], type: 'journal-article',
        'container-title': ['Journal of Easy Testing 2025'], published: { 'date-parts': [[2025]] },
      }] } });
    }
    if (url.includes('easyscholar.cc/open/getPublicationRank')) {
      const publicationName = new URL(url).searchParams.get('publicationName') || '';
      easyScholarRequests.push(publicationName);
      const matched = publicationName === 'Journal of Easy Testing';
      return Response.json({
        code: 200,
        data: {
          officialRank: { all: { sci: 'Q1' } },
          customRank: {
            rankInfo: [{
              uuid: 'hzau', abbName: 'HZAU',
              oneRankText: 'A+', twoRankText: 'A', threeRankText: 'B', fourRankText: 'C',
            }],
            rank: matched ? ['hzau&&&2'] : [],
          },
        },
      });
    }
    return Response.json({ message: { items: [] } });
  }) as typeof fetch;

  const result = await lookupPublication(item(title), fetcher, 'secret');

  assert.deepEqual(easyScholarRequests, ['Journal of Easy Testing 2025', 'Journal of Easy Testing']);
  assert.equal(result.ranks?.HZAU, 'A');
  assert.equal(result.customDatasets?.[0]?.matched, 'A');
});

test('EasyScholar keeps only selected custom datasets while preserving standard ranks', async () => {
  const title = 'A Journal With Selected Dataset Ranks';
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('api.crossref.org/works/')) {
      return Response.json({ message: {
        DOI: '10.1000/selected', title: [title], type: 'journal-article',
        'container-title': ['Journal of Selected Testing'], published: { 'date-parts': [[2025]] },
      } });
    }
    if (url.includes('api.openalex.org')) return Response.json({ results: [] });
    if (url.includes('easyscholar.cc/open/getPublicationRank')) {
      return Response.json({ code: 200, data: {
        officialRank: { all: { sci: 'Q1', ccf: 'A', uibe: 'A', swjtu: 'A++' } },
        customRank: {
          rankInfo: [{
            uuid: 'hzau', abbName: 'HZAU',
            oneRankText: 'A+', twoRankText: 'A', threeRankText: 'B', fourRankText: 'C',
          }],
          rank: ['hzau&&&1'],
        },
      } });
    }
    return Response.json({ message: { items: [] } });
  }) as typeof fetch;

  const result = await lookupPublication(
    item(title, '10.1000/selected'), fetcher, 'secret', ['HZAU'], false);

  assert.equal(result.jcr, 'JCR-Q1');
  assert.equal(result.ccf, 'A');
  assert.equal(result.ranks?.HZAU, 'A+');
  assert.equal(result.ranks?.uibe, undefined);
  assert.equal(result.ranks?.swjtu, undefined);
  assert.deepEqual(result.customDatasets?.map(dataset => dataset.key), ['HZAU']);
  assert.ok(result.datasetCatalog?.some(dataset => dataset.key === 'uibe'));

  const standardOnly = await lookupPublication(
    item(title, '10.1000/selected'), fetcher, 'secret', [], false);
  assert.equal(standardOnly.jcr, 'JCR-Q1');
  assert.equal(standardOnly.ccf, 'A');
  assert.equal(standardOnly.ranks?.HZAU, undefined);
  assert.equal(standardOnly.ranks?.uibe, undefined);
  assert.deepEqual(standardOnly.customDatasets, []);
});
