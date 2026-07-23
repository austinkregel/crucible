import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProjectGrounding } from '../projectGrounding';
import type { CacheStore } from '../../cache/store';

/** In-memory stand-in for CacheStore (only get/set/invalidate are used). */
function fakeStore(): CacheStore & { _data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  const k = (ns: string, key: string) => `${ns}:${key}`;
  return {
    _data: data,
    get: (ns: string, key: string) => data.get(k(ns, key)),
    set: (ns: string, key: string, value: unknown) => void data.set(k(ns, key), value),
    invalidate: (ns: string, key: string) => data.delete(k(ns, key)),
  } as any;
}

describe('ProjectGrounding', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-grounding-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('renders instruction files and package scripts/deps', async () => {
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# Rules\nUse tabs, not spaces.');
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'demo', description: 'a demo', scripts: { build: 'vite build' }, dependencies: { vue: '^3' } }),
    );

    const g = new ProjectGrounding(fakeStore(), root);
    const section = await g.load();

    expect(section).toContain('## Project Instructions');
    expect(section).toContain('Use tabs, not spaces.');
    expect(section).toContain('## Project Overview');
    expect(section).toContain('build: vite build');
    expect(section).toContain('vue');
    expect(g.toPromptSection()).toBe(section);
  });

  it('returns empty string when no source files exist', async () => {
    const g = new ProjectGrounding(fakeStore(), root);
    // readdir on an empty temp dir yields no dirs -> no overview, no instructions
    expect(await g.load()).toBe('');
  });

  it('caps instruction tokens and marks truncation', async () => {
    // ~8000 chars ≈ 2000 tokens, well above the 1200-token instruction cap.
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'word '.repeat(1600));
    const g = new ProjectGrounding(fakeStore(), root);
    const section = await g.load();
    expect(section).toContain('…(truncated)');
  });

  it('serves from cache on a matching fingerprint (no rebuild)', async () => {
    fs.writeFileSync(path.join(root, 'AGENTS.md'), 'be careful');
    const store = fakeStore();

    const first = await new ProjectGrounding(store, root).load();
    // Mutate the cached section directly; a cache hit must return the stored value.
    const cached = store._data.get('project-grounding:summary') as { fingerprint: string; section: string };
    cached.section = 'SENTINEL';

    const second = await new ProjectGrounding(store, root).load();
    expect(second).toBe('SENTINEL');
    expect(first).toContain('be careful');
  });

  it('refresh() rebuilds ignoring the cache', async () => {
    fs.writeFileSync(path.join(root, 'AGENTS.md'), 'v1');
    const store = fakeStore();
    const g = new ProjectGrounding(store, root);
    await g.load();

    fs.writeFileSync(path.join(root, 'AGENTS.md'), 'v2 content');
    const refreshed = await g.refresh();
    expect(refreshed).toContain('v2 content');
  });
});
