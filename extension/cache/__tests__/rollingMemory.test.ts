import { vi, describe, it, expect, beforeEach } from 'vitest';
import { RollingMemory } from '../rollingMemory';
import { MockCacheStore } from '../../__mocks__/cacheStore';

describe('RollingMemory', () => {
  let store: MockCacheStore;
  let memory: RollingMemory;

  beforeEach(() => {
    store = new MockCacheStore();
    memory = new RollingMemory(store as any);
  });

  it('getAll() returns empty array initially', () => {
    expect(memory.getAll()).toEqual([]);
  });

  it('add() stores entries with timestamp', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    memory.add({ type: 'decision', content: 'Use REST over GraphQL' });

    const entries = memory.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      type: 'decision',
      content: 'Use REST over GraphQL',
      timestamp: now,
    });

    vi.restoreAllMocks();
  });

  it('add() trims to 50 entries', () => {
    for (let i = 0; i < 55; i++) {
      memory.add({ type: 'pattern', content: `Entry ${i}` });
    }

    const entries = memory.getAll();
    expect(entries).toHaveLength(50);
    expect(entries[0].content).toBe('Entry 5');
    expect(entries[49].content).toBe('Entry 54');
  });

  it('toPromptSection() returns empty string when no entries', () => {
    expect(memory.toPromptSection()).toBe('');
  });

  it('toPromptSection() formats entries as Project Knowledge with type labels', () => {
    memory.add({ type: 'decision', content: 'Use PostgreSQL' });
    memory.add({ type: 'constraint', content: 'Must support IE11' });
    memory.add({ type: 'intent', content: 'Build auth module' });
    memory.add({ type: 'pattern', content: 'Repository pattern for data access' });

    const section = memory.toPromptSection();
    expect(section).toContain('## Project Knowledge');
    expect(section).toContain('[Decision] Use PostgreSQL');
    expect(section).toContain('[Constraint] Must support IE11');
    expect(section).toContain('[Intent] Build auth module');
    expect(section).toContain('[Pattern] Repository pattern for data access');
  });

  it('clear() removes all entries', () => {
    memory.add({ type: 'decision', content: 'Something' });
    memory.add({ type: 'pattern', content: 'Something else' });
    expect(memory.getAll()).toHaveLength(2);

    memory.clear();
    expect(memory.getAll()).toEqual([]);
  });
});
