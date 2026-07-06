import { CacheStore, hashString } from './store';

const RETRIEVAL_TTL = 5 * 60 * 1000; // 5 minutes

export class RetrievalCache {
  private store: CacheStore;

  constructor(store: CacheStore) {
    this.store = store;
  }

  get(query: string): string[] | undefined {
    return this.store.get<string[]>('retrieval', hashString(query));
  }

  set(query: string, results: string[]): void {
    this.store.set('retrieval', hashString(query), results, RETRIEVAL_TTL);
  }

  invalidateAll(): void {
    this.store.invalidateNamespace('retrieval');
  }
}
