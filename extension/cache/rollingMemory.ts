import { CacheStore } from './store';

export interface MemoryEntry {
  type: 'decision' | 'constraint' | 'intent' | 'pattern';
  content: string;
  timestamp: number;
}

/**
 * Rolling memory stores project knowledge across the session:
 * decisions made, constraints discovered, feature intents, and patterns.
 * Injected into prompts as "Project Knowledge" context.
 */
export class RollingMemory {
  private store: CacheStore;
  private static readonly NAMESPACE = 'rolling-memory';
  private static readonly KEY = 'entries';

  constructor(store: CacheStore) {
    this.store = store;
  }

  getAll(): MemoryEntry[] {
    return this.store.get<MemoryEntry[]>(RollingMemory.NAMESPACE, RollingMemory.KEY) || [];
  }

  add(entry: Omit<MemoryEntry, 'timestamp'>): void {
    const entries = this.getAll();
    entries.push({ ...entry, timestamp: Date.now() });
    // Keep last 50 entries
    const trimmed = entries.slice(-50);
    this.store.set(RollingMemory.NAMESPACE, RollingMemory.KEY, trimmed);
  }

  toPromptSection(): string {
    const entries = this.getAll();
    if (entries.length === 0) return '';

    const lines = entries.map((e) => {
      const label = e.type.charAt(0).toUpperCase() + e.type.slice(1);
      return `- [${label}] ${e.content}`;
    });

    return `## Project Knowledge\n${lines.join('\n')}`;
  }

  clear(): void {
    this.store.invalidateNamespace(RollingMemory.NAMESPACE);
  }
}
