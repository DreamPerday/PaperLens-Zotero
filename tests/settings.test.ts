import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeProvider, DEFAULT_SETTINGS, mergeEasyScholarDatasetCatalog, normalizeSettings,
} from '../src/settings';

test('legacy single-provider settings migrate without losing translation or reading preferences', () => {
  const settings = normalizeSettings({
    baseURL: 'https://api.openai.com/v1', model: 'gpt-test',
    depth: 'deep', hints: false, contextChars: 48000, autoTranslate: false,
  });
  assert.equal(settings.providers.length, 1);
  assert.equal(activeProvider(settings).name, 'OpenAI');
  assert.equal(activeProvider(settings).model, 'gpt-test');
  assert.equal(settings.depth, 'deep');
  assert.equal(settings.hints, false);
  assert.equal(settings.contextChars, 48000);
  assert.equal(settings.autoTranslate, false);
});

test('multiple providers retain independent endpoints, models and active selection', () => {
  const settings = normalizeSettings({
    providers: [
      { id: 'relay', name: '公司中转', baseURL: 'https://relay.example/v1', model: 'model-a', apiKey: 'key-a' },
      { id: 'local', name: '本地模型', baseURL: 'http://localhost:11434/v1', model: 'model-b', apiKey: '' },
    ],
    activeProviderId: 'local',
    wordTranslationProviderId: 'relay',
  });
  assert.equal(settings.providers.length, 2);
  assert.equal(settings.providers[0].baseURL, 'https://relay.example/v1');
  assert.equal(settings.providers[1].baseURL, 'http://localhost:11434/v1');
  assert.equal(activeProvider(settings).model, 'model-b');
  assert.equal(settings.wordTranslationProviderId, 'relay');
});

test('invalid and duplicate provider IDs are repaired while a missing active selection falls back', () => {
  const settings = normalizeSettings({
    providers: [
      { id: 'same', name: 'First', baseURL: 'https://one.example/v1', model: 'one', apiKey: '' },
      { id: 'same', name: 'Second', baseURL: 'https://two.example/v1', model: 'two', apiKey: '' },
    ],
    activeProviderId: 'missing',
  });
  assert.deepEqual(settings.providers.map(provider => provider.id), ['same', 'same-2']);
  assert.equal(settings.activeProviderId, 'same');
  assert.equal(activeProvider(settings).name, 'First');
  assert.equal(settings.wordTranslationProviderId, '');
});

test('empty settings use an editable default provider', () => {
  const settings = normalizeSettings(undefined);
  assert.equal(settings.providers.length, 1);
  assert.equal(settings.providers[0].id, DEFAULT_SETTINGS.providers[0].id);
  assert.equal(settings.providers[0].baseURL, 'https://api.openai.com/v1');
  assert.equal(settings.autoTranslate, true);
  assert.equal(settings.offlineDictionary, true);
  assert.equal(settings.translationKeepOpen, true);
  assert.equal(settings.easyScholarApiKey, '');
  assert.equal(settings.easyScholarShowAllDatasets, true);
  assert.deepEqual(settings.easyScholarDatasetKeys, []);
  assert.deepEqual(settings.easyScholarDatasetCatalog, []);
  assert.equal(settings.wordTranslationProviderId, '');
});

test('EasyScholar dataset selection is sanitized and the discovered catalog is merged', () => {
  const settings = normalizeSettings({
    easyScholarShowAllDatasets: false,
    easyScholarDatasetKeys: ['HZAU', ' hzau ', 'UIBE', '=bad'],
    easyScholarDatasetCatalog: [
      { key: 'HZAU', name: '华中农业大学' },
      { key: 'hzau', name: '重复项' },
    ],
  });

  assert.equal(settings.easyScholarShowAllDatasets, false);
  assert.deepEqual(settings.easyScholarDatasetKeys, ['HZAU', 'UIBE', 'bad']);
  assert.deepEqual(settings.easyScholarDatasetCatalog, [{ key: 'HZAU', name: '华中农业大学' }]);
  assert.deepEqual(mergeEasyScholarDatasetCatalog(settings.easyScholarDatasetCatalog, [
    { key: 'UIBE', name: '对外经济贸易大学' },
    { key: 'HZAU', name: '华中农业大学' },
  ]), [
    { key: 'HZAU', name: '华中农业大学' },
    { key: 'UIBE', name: '对外经济贸易大学' },
  ]);
});
