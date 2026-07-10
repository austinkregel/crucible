import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const { testTmpDir } = vi.hoisted(() => {
  const _fs = require('fs');
  const _path = require('path');
  const _os = require('os');
  return {
    testTmpDir: _fs.mkdtempSync(_path.join(_os.tmpdir(), 'crucible-cache-test-')),
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => testTmpDir,
  };
});

import { CacheStore, hashString, hashFile } from '../store';

afterEach(() => {
  const crucibleDir = path.join(testTmpDir, '.crucible');
  if (fs.existsSync(crucibleDir)) {
    fs.rmSync(crucibleDir, { recursive: true, force: true });
  }
});

describe('CacheStore', () => {
  let store: CacheStore;

  beforeEach(() => {
    store = new CacheStore('/test/workspace');
  });

  describe('get/set', () => {
    it('returns undefined for missing key', () => {
      expect(store.get('ns', 'missing')).toBeUndefined();
    });

    it('stores and retrieves a value', () => {
      store.set('ns', 'key1', { hello: 'world' });
      expect(store.get('ns', 'key1')).toEqual({ hello: 'world' });
    });

    it('stores string values', () => {
      store.set('ns', 'str', 'simple string');
      expect(store.get('ns', 'str')).toBe('simple string');
    });

    it('stores array values', () => {
      store.set('ns', 'arr', [1, 2, 3]);
      expect(store.get('ns', 'arr')).toEqual([1, 2, 3]);
    });

    it('overwrites existing value', () => {
      store.set('ns', 'k', 'v1');
      store.set('ns', 'k', 'v2');
      expect(store.get('ns', 'k')).toBe('v2');
    });
  });

  describe('TTL expiration', () => {
    it('returns value within TTL', () => {
      store.set('ns', 'fresh', 'data', 60_000);
      expect(store.get('ns', 'fresh')).toBe('data');
    });

    it('returns undefined after TTL expires', () => {
      const hash = hashString('/test/workspace');
      const nsDir = path.join(testTmpDir, '.crucible', hash, 'ns');
      fs.mkdirSync(nsDir, { recursive: true });
      const fp = path.join(nsDir, 'stale.json');
      const entry = { value: 'data', createdAt: 1000, expiresAt: 1001 };
      fs.writeFileSync(fp, JSON.stringify(entry));

      expect(store.get('ns', 'stale')).toBeUndefined();
    });
  });

  describe('invalidate', () => {
    it('removes a specific key and returns true', () => {
      store.set('ns', 'k', 'v');
      expect(store.invalidate('ns', 'k')).toBe(true);
      expect(store.get('ns', 'k')).toBeUndefined();
    });

    it('returns false when key does not exist', () => {
      expect(store.invalidate('ns', 'nope')).toBe(false);
    });
  });

  describe('invalidateNamespace', () => {
    it('removes all keys in a namespace', () => {
      store.set('ns1', 'a', 'va');
      store.set('ns1', 'b', 'vb');
      store.set('ns2', 'c', 'vc');

      store.invalidateNamespace('ns1');

      expect(store.get('ns1', 'a')).toBeUndefined();
      expect(store.get('ns1', 'b')).toBeUndefined();
      expect(store.get('ns2', 'c')).toBe('vc');
    });

    it('does nothing for non-existent namespace', () => {
      expect(() => store.invalidateNamespace('ghost')).not.toThrow();
    });
  });

  describe('clearAll', () => {
    it('removes everything and recreates base directory', () => {
      store.set('a', 'x', 1);
      store.set('b', 'y', 2);
      store.clearAll();
      expect(store.get('a', 'x')).toBeUndefined();
      expect(store.get('b', 'y')).toBeUndefined();
    });
  });

  describe('listKeys', () => {
    it('returns keys in a namespace', () => {
      store.set('ns', 'alpha', 1);
      store.set('ns', 'beta', 2);
      const keys = store.listKeys('ns').sort();
      expect(keys).toEqual(['alpha', 'beta']);
    });

    it('returns empty array for empty namespace', () => {
      expect(store.listKeys('empty')).toEqual([]);
    });
  });

  describe('constructor with no workspace', () => {
    it('creates store with no-workspace hash', () => {
      const s = new CacheStore();
      s.set('ns', 'k', 'v');
      expect(s.get('ns', 'k')).toBe('v');
    });
  });
});

describe('hashString', () => {
  it('returns a 16-char hex string', () => {
    const result = hashString('hello');
    expect(result).toHaveLength(16);
    expect(result).toMatch(/^[a-f0-9]+$/);
  });

  it('returns consistent results', () => {
    expect(hashString('test')).toBe(hashString('test'));
  });

  it('returns different hashes for different inputs', () => {
    expect(hashString('a')).not.toBe(hashString('b'));
  });
});

describe('hashFile', () => {
  it('returns a 16-char hex string', () => {
    const result = hashFile('file content');
    expect(result).toHaveLength(16);
    expect(result).toMatch(/^[a-f0-9]+$/);
  });
});
