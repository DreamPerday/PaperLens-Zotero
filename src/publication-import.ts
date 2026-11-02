import { lookupPublication } from './paper-online';
import type { PublicationLookup } from './paper-online';
import type { Settings } from './types';

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
type Lookup = (item: any, settings: Settings) => Promise<PublicationLookup>;
const onlineLookup: Lookup = (item, settings) => lookupPublication(item, fetch,
  settings.easyScholarApiKey, settings.easyScholarDatasetKeys, settings.easyScholarShowAllDatasets);

function needsRetry(result: PublicationLookup, settings: Settings): boolean {
  return !result.venue || !result.year || Boolean(settings.easyScholarApiKey &&
    (result.rankError || !Object.values(result.ranks || {}).some(value => value.trim())
      || result.customDatasets?.some(dataset => !dataset.matched)));
}

export async function lookupImportedPublication(item: any, settings: Settings,
  lookup: Lookup = onlineLookup, wait: () => Promise<void> = () => pause(2000),
  active: () => boolean = () => true): Promise<PublicationLookup | undefined> {
  let first: PublicationLookup | undefined;
  let lastError: unknown;
  try { first = await lookup(item, settings); } catch (error) { lastError = error; }
  if (!active()) return;
  if (first && !needsRetry(first, settings)) return first;
  await wait();
  if (!active()) return;
  try {
    const second = await lookup(item, settings);
    if (!first) return second;
    // Keep useful fields if the retry returns a partial/empty response for the same venue.
    if (first.venue && second.venue && first.venue !== second.venue) return second;
    const merged = { ...first, ...second };
    for (const key of ['venue', 'year', 'doi', 'jcr', 'cas', 'ccf', 'core'] as const) {
      if (!second[key] && first[key]) merged[key] = first[key];
    }
    merged.ranks = { ...first.ranks, ...Object.fromEntries(
      Object.entries(second.ranks || {}).filter(([, value]) => value.trim())) };
    return merged;
  } catch (error) { lastError = error; }
  if (first) return first;
  throw lastError;
}

interface ImportDependencies {
  getItem(id: number): any;
  eligible(item: any): boolean;
  getSettings(): Promise<Settings>;
  lookup?: Lookup;
  apply(item: any, result: PublicationLookup): Promise<void>;
  onError(error: unknown): void;
}

export class PublicationImportQueue {
  private pending = new Map<number, number>();
  private seen = new Set<number>();
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private active = true;

  constructor(private deps: ImportDependencies, private settleMs = 2000, private retryMs = 2000) {}

  notify(event: string, type: string, ids: number[]) {
    if (!this.active || type !== 'item') return;
    for (const id of ids) {
      if (event === 'delete' || event === 'trash') { this.pending.delete(id); continue; }
      if (event === 'add' && !this.seen.has(id)) {
        const item = this.deps.getItem(id);
        if (!this.deps.eligible(item)) continue;
        this.seen.add(id);
        this.pending.set(id, Date.now() + this.settleMs);
      } else if (event === 'modify' && this.pending.has(id)) {
        this.pending.set(id, Date.now() + this.settleMs);
      }
    }
    this.schedule();
  }

  stop() {
    this.active = false;
    clearTimeout(this.timer);
    this.pending.clear();
    this.seen.clear();
  }

  private schedule() {
    clearTimeout(this.timer);
    if (!this.active || this.running || !this.pending.size) return;
    const due = Math.min(...this.pending.values());
    this.timer = setTimeout(() => void this.drain(), Math.max(0, due - Date.now()));
  }

  private async drain() {
    this.running = true;
    try {
      while (this.active) {
        const next = [...this.pending].find(([, due]) => due <= Date.now());
        if (!next) break;
        const [id] = next;
        this.pending.delete(id);
        try {
          let settings = await this.deps.getSettings();
          let item = this.deps.getItem(id);
          if (!this.active || !settings.autoPublicationLookup || !this.deps.eligible(item)) continue;
          const result = await lookupImportedPublication(item, settings, this.deps.lookup,
            () => pause(this.retryMs), () => this.active);
          if (!this.active || !result) continue;
          settings = await this.deps.getSettings();
          item = this.deps.getItem(id);
          if (!this.active || !settings.autoPublicationLookup || !this.deps.eligible(item)) continue;
          await this.deps.apply(item, result);
        } catch (error) { this.deps.onError(error); }
      }
    } finally { this.running = false; this.schedule(); }
  }
}
