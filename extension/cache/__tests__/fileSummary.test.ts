import { vi, describe, it, expect, beforeEach } from 'vitest';
import { FileSummaryCache, type FileSummaryEntry } from '../fileSummary';
import { hashFile } from '../store';
import { MockCacheStore } from '../../__mocks__/cacheStore';

describe('FileSummaryCache', () => {
  let store: MockCacheStore;
  let cache: FileSummaryCache;

  beforeEach(() => {
    store = new MockCacheStore();
    cache = new FileSummaryCache(store as any);
  });

  it('get() returns undefined when no cache exists', () => {
    expect(cache.get('src/index.ts', 'const x = 1;')).toBeUndefined();
  });

  it('get() returns cached entry when hash matches', () => {
    const content = 'export function hello() {}';
    const entry: FileSummaryEntry = {
      fileHash: hashFile(content),
      filePath: 'src/hello.ts',
      summary: 'A greeting function',
      keyFunctions: ['hello'],
      dependencies: [],
      lastUpdated: Date.now(),
    };

    cache.set('src/hello.ts', content, entry);
    const result = cache.get('src/hello.ts', content);

    expect(result).toBeDefined();
    expect(result!.summary).toBe('A greeting function');
    expect(result!.filePath).toBe('src/hello.ts');
  });

  it('get() returns undefined when content changed (hash mismatch)', () => {
    const originalContent = 'export function hello() {}';
    const entry: FileSummaryEntry = {
      fileHash: hashFile(originalContent),
      filePath: 'src/hello.ts',
      summary: 'A greeting function',
      keyFunctions: ['hello'],
      dependencies: [],
      lastUpdated: Date.now(),
    };

    cache.set('src/hello.ts', originalContent, entry);
    const result = cache.get('src/hello.ts', 'export function hello() { return "world"; }');

    expect(result).toBeUndefined();
  });

  it('set() stores entry', () => {
    const content = 'const a = 1;';
    const entry: FileSummaryEntry = {
      fileHash: hashFile(content),
      filePath: 'src/a.ts',
      summary: 'Constant definition',
      keyFunctions: [],
      dependencies: [],
      lastUpdated: Date.now(),
    };

    cache.set('src/a.ts', content, entry);
    expect(cache.get('src/a.ts', content)).toBeDefined();
  });

  it('invalidate() removes entry', () => {
    const content = 'const b = 2;';
    const entry: FileSummaryEntry = {
      fileHash: hashFile(content),
      filePath: 'src/b.ts',
      summary: 'Another constant',
      keyFunctions: [],
      dependencies: [],
      lastUpdated: Date.now(),
    };

    cache.set('src/b.ts', content, entry);
    cache.invalidate('src/b.ts');
    expect(cache.get('src/b.ts', content)).toBeUndefined();
  });

  it('listCachedFiles() returns cached keys', () => {
    const content1 = 'const a = 1;';
    const content2 = 'const b = 2;';

    cache.set('src/a.ts', content1, {
      fileHash: hashFile(content1),
      filePath: 'src/a.ts',
      summary: 'A',
      keyFunctions: [],
      dependencies: [],
      lastUpdated: Date.now(),
    } as FileSummaryEntry);

    cache.set('src/b.ts', content2, {
      fileHash: hashFile(content2),
      filePath: 'src/b.ts',
      summary: 'B',
      keyFunctions: [],
      dependencies: [],
      lastUpdated: Date.now(),
    } as FileSummaryEntry);

    const keys = cache.listCachedFiles();
    expect(keys).toHaveLength(2);
  });
});
