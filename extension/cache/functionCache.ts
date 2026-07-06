import { CacheStore, hashString } from './store';

export interface FunctionCacheEntry {
  signature: string;
  summary: string;
  callers: string[];
  sideEffects: string[];
  filePath: string;
  lineStart: number;
  lineEnd: number;
}

export class FunctionCache {
  private store: CacheStore;

  constructor(store: CacheStore) {
    this.store = store;
  }

  get(signature: string): FunctionCacheEntry | undefined {
    return this.store.get<FunctionCacheEntry>('functions', hashString(signature));
  }

  set(signature: string, entry: FunctionCacheEntry): void {
    this.store.set('functions', hashString(signature), entry);
  }

  invalidate(signature: string): void {
    this.store.invalidate('functions', hashString(signature));
  }

  invalidateByFile(filePath: string): void {
    const keys = this.store.listKeys('functions');
    for (const key of keys) {
      const entry = this.store.get<FunctionCacheEntry>('functions', key);
      if (entry && entry.filePath === filePath) {
        this.store.invalidate('functions', key);
      }
    }
  }
}
