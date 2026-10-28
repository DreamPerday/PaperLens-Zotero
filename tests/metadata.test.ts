import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  conferenceRankLabel, getConferenceRanks, getJournal, getJournalRanks, getQuartile, journalRanksLabel, lookupConferenceRank,
  parseConferenceRank, parseQuartileInput, publicationField, quartileLabel, quartileTag,
  saveConferenceRanks, saveJournal, saveJournalRanks, saveQuartile, tagsWithQuartile,
} from '../src/paper-metadata';

const fields: Record<string, number> = { publicationTitle: 10, proceedingsTitle: 11, bookTitle: 12, repository: 13 };
const coloredTags = new Map<string, { color: string; position: number }>();
(globalThis as any).Zotero = {
  Items: { get: (_id: number) => undefined },
  ItemFields: {
    getID: (name: string) => fields[name] || false,
    isValidForType: (id: number, typeID: number) => typeID === 1 ? id === 10 : typeID === 2 && id === 11,
  },
  Tags: {
    MAX_COLORED_TAGS: 9,
    getColor: (_libraryID: number, name: string) => coloredTags.get(name) || false,
    getColors: () => coloredTags,
    getColorByPosition: (_libraryID: number, position: number) =>
      [...coloredTags.values()].find(entry => entry.position === position) || false,
    setColor: async (_libraryID: number, name: string, color: string, position: number) => {
      coloredTags.set(name, { color, position });
    },
  },
  logError: () => {},
};

function paper(typeID = 1) {
  let journal = 'Nature';
  let tags: Array<{ tag: string; type?: number }> = [
    { tag: 'machine-learning', type: 1 },
    { tag: 'PaperLens/JCR-Q2', type: 1 },
  ];
  let saves = 0;
  return {
    itemTypeID: typeID,
    libraryID: 1,
    isRegularItem: () => true,
    isAttachment: () => false,
    getField: (_field: string) => journal,
    setField: (_field: string, value: string) => { journal = value; },
    getTags: () => tags,
    setTags: (next: Array<{ tag: string; type?: number }>) => { tags = next; },
    saveTx: async () => { saves++; },
    values: () => ({ journal, tags, saves }),
  };
}

test('quarterile helpers create namespaced tags and preserve unrelated tags', () => {
  assert.equal(quartileTag('JCR-Q1'), 'PaperLens/JCR-Q1');
  assert.equal(quartileTag('CAS-2'), 'PaperLens/CAS-2');
  assert.equal(quartileTag('invalid'), '');
  assert.deepEqual(tagsWithQuartile([
    { tag: 'keep', type: 1 },
    { tag: 'PaperLens/JCR-Q4', type: 1 },
    { tag: 'PaperLens/other', type: 1 },
  ], 'CAS-1'), [
    { tag: 'keep', type: 1 },
    { tag: 'PaperLens/other', type: 1 },
    { tag: 'PaperLens/CAS-1', type: 1 },
  ]);
  assert.equal(parseQuartileInput('Q1'), 'JCR-Q1');
  assert.equal(parseQuartileInput('中科院 2区'), 'CAS-2');
  assert.equal(parseQuartileInput(''), '');
  assert.equal(quartileLabel('CAS-3'), '中科院 3区');
  assert.throws(() => parseQuartileInput('unknown'), /Q1–Q4/);
  assert.equal(lookupConferenceRank('ICML 2019')?.ccf, 'A');
  assert.equal(lookupConferenceRank('International Conference on Machine Learning, 2019')?.core, 'A*');
  assert.deepEqual(parseConferenceRank('CCF-A'), { ccf: 'A' });
  assert.deepEqual(parseConferenceRank('CORE-A*'), { core: 'A*' });
  assert.equal(conferenceRankLabel({ ccf: 'A', core: 'A*' }), 'CCF-A · CORE-A*');
});

test('journal and quartile are read and saved through Zotero item fields and tags', async () => {
  const item = paper();
  assert.equal(publicationField(item), 'publicationTitle');
  assert.equal(getJournal(item), 'Nature');
  assert.equal(getQuartile(item), 'JCR-Q2');
  await saveJournal(item, ' Science ');
  await saveQuartile(item, 'CAS-1');
  assert.equal(getJournal(item), 'Science');
  assert.equal(getQuartile(item), 'CAS-1');
  assert.ok(item.values().tags.some(entry => entry.tag === 'machine-learning'));
  assert.ok(item.values().tags.some(entry => entry.tag === 'PaperLens/CAS-1'));
  assert.ok(!item.values().tags.some(entry => entry.tag === 'PaperLens/JCR-Q2'));
  assert.equal(item.values().saves, 2);
  assert.equal(coloredTags.get('PaperLens/CAS-1')?.color, '#B33A3A');
  await saveConferenceRanks(item, { ccf: 'A', core: 'A*', conference: 'International Conference on Machine Learning' });
  assert.deepEqual(getConferenceRanks(item), { ccf: 'A', core: 'A*', conference: 'International Conference on Machine Learning' });
  assert.equal(coloredTags.get('PaperLens/CCF-A')?.color, '#7A3E9D');
  assert.equal(coloredTags.get('PaperLens/CORE-A*')?.color, '#B03366');
  await saveJournalRanks(item, { jcr: 'JCR-Q1', cas: 'CAS-2' });
  assert.deepEqual(getJournalRanks(item), { jcr: 'JCR-Q1', cas: 'CAS-2' });
  assert.equal(journalRanksLabel(getJournalRanks(item)), 'JCR Q1 · 中科院 2区');
});

test('conference papers use proceedingsTitle instead of publicationTitle', () => {
  const item = paper(2);
  assert.equal(publicationField(item), 'proceedingsTitle');
});
