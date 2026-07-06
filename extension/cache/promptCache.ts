import { CacheStore, hashString } from './store';

export interface PromptCacheEntry {
  staticPrefix: string;
  hash: string;
  createdAt: number;
}

/**
 * Manages static prompt prefixes for Anthropic-style prompt caching.
 * The static prefix (system instructions, project rules, architecture patterns)
 * is reused across requests to reduce input tokens on expensive models.
 */
export class PromptCache {
  private store: CacheStore;

  constructor(store: CacheStore) {
    this.store = store;
  }

  getStaticPrefix(key: string): string | undefined {
    const entry = this.store.get<PromptCacheEntry>('prompt-prefixes', key);
    return entry?.staticPrefix;
  }

  setStaticPrefix(key: string, prefix: string): void {
    this.store.set<PromptCacheEntry>('prompt-prefixes', key, {
      staticPrefix: prefix,
      hash: hashString(prefix),
      createdAt: Date.now(),
    });
  }

  hasChanged(key: string, currentPrefix: string): boolean {
    const entry = this.store.get<PromptCacheEntry>('prompt-prefixes', key);
    if (!entry) return true;
    return entry.hash !== hashString(currentPrefix);
  }
}
