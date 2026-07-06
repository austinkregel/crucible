export class MockCacheStore {
  private data = new Map<string, any>();

  private key(ns: string, k: string) {
    return `${ns}:${k}`;
  }

  get<T>(ns: string, k: string): T | undefined {
    return this.data.get(this.key(ns, k));
  }

  set<T>(ns: string, k: string, value: T): void {
    this.data.set(this.key(ns, k), value);
  }

  invalidate(ns: string, k: string): boolean {
    return this.data.delete(this.key(ns, k));
  }

  invalidateNamespace(ns: string): void {
    for (const k of this.data.keys()) {
      if (k.startsWith(ns + ':')) {
        this.data.delete(k);
      }
    }
  }

  clearAll(): void {
    this.data.clear();
  }

  listKeys(ns: string): string[] {
    return [...this.data.keys()]
      .filter((k) => k.startsWith(ns + ':'))
      .map((k) => k.slice(ns.length + 1));
  }
}
