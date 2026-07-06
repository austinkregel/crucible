import * as lancedb from '@lancedb/lancedb';
import * as path from 'path';
import * as fs from 'fs';

export interface ChunkRecord {
  vector: number[];
  filePath: string;
  relativePath: string;
  lineStart: number;
  lineEnd: number;
  contentHash: string;
  contextualizedText: string;
  entities: string;
  language: string;
}

export interface SearchResult extends ChunkRecord {
  _distance: number;
}

/**
 * LanceDB wrapper for storing and searching code chunk embeddings.
 * Data lives in {workspacePath}/.crucible/lancedb/
 */
export class VectorStore {
  private dbPath: string;
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private static readonly TABLE_NAME = 'code_chunks';

  constructor(workspacePath: string) {
    this.dbPath = path.join(workspacePath, '.crucible', 'lancedb');
    fs.mkdirSync(this.dbPath, { recursive: true });
  }

  async connect(): Promise<void> {
    if (this.db) return;
    this.db = await lancedb.connect(this.dbPath);

    const tableNames = await this.db.tableNames();
    if (tableNames.includes(VectorStore.TABLE_NAME)) {
      this.table = await this.db.openTable(VectorStore.TABLE_NAME);
    }
  }

  async upsert(records: ChunkRecord[]): Promise<void> {
    await this.connect();
    if (!this.db || records.length === 0) return;

    const data = records.map((r) => ({ ...r }) as Record<string, unknown>);

    if (!this.table) {
      this.table = await this.db.createTable(VectorStore.TABLE_NAME, data);
    } else {
      await this.table.add(data);
    }
  }

  async search(queryVector: number[], limit = 50): Promise<SearchResult[]> {
    await this.connect();
    if (!this.table) return [];

    try {
      const results = await this.table
        .vectorSearch(queryVector)
        .limit(limit)
        .toArray();

      return results.map((r: any) => ({
        vector: r.vector,
        filePath: r.filePath,
        relativePath: r.relativePath,
        lineStart: r.lineStart,
        lineEnd: r.lineEnd,
        contentHash: r.contentHash,
        contextualizedText: r.contextualizedText,
        entities: r.entities,
        language: r.language,
        _distance: r._distance ?? 0,
      }));
    } catch {
      return [];
    }
  }

  async deleteByFile(filePath: string): Promise<void> {
    await this.connect();
    if (!this.table) return;

    try {
      await this.table.delete(`filePath = '${filePath.replace(/'/g, "''")}'`);
    } catch {
      // Table might be empty or column doesn't exist yet
    }
  }

  async deleteStale(currentFilePaths: Set<string>): Promise<void> {
    await this.connect();
    if (!this.table) return;

    try {
      const all = await this.table.query().select(['filePath']).toArray();
      const indexedPaths = new Set(all.map((r: any) => r.filePath as string));

      for (const indexed of indexedPaths) {
        if (!currentFilePaths.has(indexed)) {
          await this.deleteByFile(indexed);
        }
      }
    } catch {
      // Silently handle -- table may be in an inconsistent state
    }
  }

  async getRecordCount(): Promise<number> {
    await this.connect();
    if (!this.table) return 0;

    try {
      const rows = await this.table.countRows();
      return rows;
    } catch {
      return 0;
    }
  }

  async dropAll(): Promise<void> {
    await this.connect();
    if (!this.db) return;

    try {
      await this.db.dropTable(VectorStore.TABLE_NAME);
      this.table = null;
    } catch {
      // Table may not exist
    }
  }
}
