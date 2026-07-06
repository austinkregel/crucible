import { CacheStore, hashFile } from './store';

export interface FileSummaryEntry {
  fileHash: string;
  filePath: string;
  summary: string;
  keyFunctions: string[];
  dependencies: string[];
  lastUpdated: number;
}

export class FileSummaryCache {
  private store: CacheStore;

  constructor(store: CacheStore) {
    this.store = store;
  }

  get(filePath: string, currentContent: string): FileSummaryEntry | undefined {
    const contentHash = hashFile(currentContent);
    const entry = this.store.get<FileSummaryEntry>('file-summaries', hashFile(filePath));
    if (entry && entry.fileHash === contentHash) {
      return entry;
    }
    return undefined;
  }

  set(filePath: string, content: string, summary: FileSummaryEntry): void {
    this.store.set('file-summaries', hashFile(filePath), {
      ...summary,
      fileHash: hashFile(content),
      filePath,
      lastUpdated: Date.now(),
    });
  }

  invalidate(filePath: string): void {
    this.store.invalidate('file-summaries', hashFile(filePath));
  }

  listCachedFiles(): string[] {
    return this.store.listKeys('file-summaries');
  }
}
