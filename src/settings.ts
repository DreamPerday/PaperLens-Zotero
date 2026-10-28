import type { AIProvider, Depth, EasyScholarDatasetOption, Settings } from './types';

export const DEFAULT_PROVIDER: AIProvider = {
  id: 'default',
  name: 'OpenAI',
  baseURL: 'https://api.openai.com/v1',
  apiKey: '',
  model: '',
};

export const DEFAULT_SETTINGS: Settings = {
  providers: [{ ...DEFAULT_PROVIDER }],
  activeProviderId: DEFAULT_PROVIDER.id,
  depth: 'standard',
  hints: true,
  contextChars: 32000,
  autoTranslate: true,
  wordTranslationProviderId: '',
  offlineDictionary: true,
  translationKeepOpen: true,
  easyScholarApiKey: '',
  easyScholarShowAllDatasets: true,
  easyScholarDatasetKeys: [],
  easyScholarDatasetCatalog: [],
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function datasetKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const key = text(item).replace(/[=\u0000-\u001f]/g, '').slice(0, 80);
    const normalized = key.toLowerCase();
    if (!key || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(key);
  }
  return result;
}

function datasetCatalog(value: unknown): EasyScholarDatasetOption[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: EasyScholarDatasetOption[] = [];
  for (const item of value) {
    const candidate = record(item);
    const key = text(candidate.key).replace(/[=\u0000-\u001f]/g, '').slice(0, 80);
    const normalized = key.toLowerCase();
    if (!key || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push({ key, name: text(candidate.name).slice(0, 120) || key });
  }
  return result;
}

export function mergeEasyScholarDatasetCatalog(
  current: EasyScholarDatasetOption[],
  incoming: Array<{ key: string; name?: string }>,
): EasyScholarDatasetOption[] {
  const merged = new Map<string, EasyScholarDatasetOption>();
  for (const option of datasetCatalog(current)) merged.set(option.key.toLowerCase(), option);
  for (const option of datasetCatalog(incoming)) merged.set(option.key.toLowerCase(), option);
  return [...merged.values()].slice(0, 200);
}

function providerName(baseURL: string, fallback: string): string {
  try {
    const host = new URL(baseURL).hostname.toLowerCase();
    if (host === 'api.openai.com' || host.endsWith('.openai.com')) return 'OpenAI';
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return '本地模型';
  } catch { /* An incomplete URL remains editable in the settings form. */ }
  return fallback;
}

export function normalizeSettings(value: unknown): Settings {
  const raw = record(value);
  const rawProviders = Array.isArray(raw.providers) ? raw.providers.map(record) : [];
  const legacyBaseURL = text(raw.baseURL);
  const legacyModel = text(raw.model);
  const legacyApiKey = text(raw.apiKey);
  const hasLegacyConnection = Boolean(legacyBaseURL || legacyModel || legacyApiKey);
  const candidates = rawProviders.length ? rawProviders : hasLegacyConnection ? [{
    id: DEFAULT_PROVIDER.id,
    name: providerName(legacyBaseURL, 'AI 服务'),
    baseURL: legacyBaseURL,
    apiKey: legacyApiKey,
    model: legacyModel,
  }] : [{ ...DEFAULT_PROVIDER }];

  const usedIDs = new Set<string>();
  const providers = candidates.map((candidate, index): AIProvider => {
    const requestedID = text(candidate.id).replace(/[^a-zA-Z0-9_-]/g, '');
    let id = requestedID.slice(0, 80) || `provider-${index + 1}`;
    while (usedIDs.has(id)) id = `${id}-${index + 1}`;
    usedIDs.add(id);
    const baseURL = text(candidate.baseURL);
    return {
      id,
      name: text(candidate.name).slice(0, 80) || providerName(baseURL, `服务商 ${index + 1}`),
      baseURL,
      apiKey: text(candidate.apiKey),
      model: text(candidate.model),
    };
  });

  const requestedActiveID = text(raw.activeProviderId);
  const activeProviderId = providers.some(provider => provider.id === requestedActiveID)
    ? requestedActiveID
    : providers[0].id;
  const requestedWordProviderID = text(raw.wordTranslationProviderId);
  const wordTranslationProviderId = providers.some(provider => provider.id === requestedWordProviderID)
    ? requestedWordProviderID
    : '';
  const depth: Depth = raw.depth === 'simple' || raw.depth === 'deep' ? raw.depth : 'standard';
  const contextChars = typeof raw.contextChars === 'number' && Number.isFinite(raw.contextChars)
    ? raw.contextChars
    : DEFAULT_SETTINGS.contextChars;

  return {
    providers,
    activeProviderId,
    depth,
    hints: typeof raw.hints === 'boolean' ? raw.hints : DEFAULT_SETTINGS.hints,
    contextChars,
    autoTranslate: typeof raw.autoTranslate === 'boolean' ? raw.autoTranslate : DEFAULT_SETTINGS.autoTranslate,
    wordTranslationProviderId,
    offlineDictionary: typeof raw.offlineDictionary === 'boolean' ? raw.offlineDictionary : DEFAULT_SETTINGS.offlineDictionary,
    translationKeepOpen: typeof raw.translationKeepOpen === 'boolean'
      ? raw.translationKeepOpen
      : DEFAULT_SETTINGS.translationKeepOpen,
    easyScholarApiKey: text(raw.easyScholarApiKey),
    easyScholarShowAllDatasets: typeof raw.easyScholarShowAllDatasets === 'boolean'
      ? raw.easyScholarShowAllDatasets
      : DEFAULT_SETTINGS.easyScholarShowAllDatasets,
    easyScholarDatasetKeys: datasetKeys(raw.easyScholarDatasetKeys),
    easyScholarDatasetCatalog: datasetCatalog(raw.easyScholarDatasetCatalog),
  };
}

export function activeProvider(settings: Settings): AIProvider {
  return settings.providers.find(provider => provider.id === settings.activeProviderId) || settings.providers[0];
}
