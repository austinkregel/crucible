import * as vscode from 'vscode';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { Chunker, type CodeChunk } from './chunker';
import { Embedder } from './embedder';
import { VectorStore, type ChunkRecord } from './vectorStore';

export interface IndexStatus {
  state: 'idle' | 'scanning' | 'hashing' | 'indexing' | 'ready' | 'error';
  totalFiles: number;
  processedFiles: number;
  totalChunks: number;
  changedFiles?: number;
  lastIndexedAt?: number;
  error?: string;
}

type StatusListener = (status: IndexStatus) => void;

const EMBED_TIMEOUT_MS = 120_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Embedding timed out')), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * Orchestrates the full indexing pipeline: scan -> hash -> chunk -> embed -> store.
 * Manages file watchers for incremental updates.
 */
export class IndexManager implements vscode.Disposable {
  private chunker: Chunker;
  private embedder: Embedder;
  private vectorStore: VectorStore;
  private disposables: vscode.Disposable[] = [];
  private manifest: Map<string, string> = new Map();
  private manifestPath: string;
  private status: IndexStatus = {
    state: 'idle',
    totalFiles: 0,
    processedFiles: 0,
    totalChunks: 0,
  };
  private listeners: StatusListener[] = [];
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private indexing = false;

  constructor(workspacePath: string, ollamaBaseUrl: string) {
    const config = vscode.workspace.getConfiguration('crucible');
    const embeddingModel = config.get<string>('indexing.embeddingModel', 'nomic-embed-text');
    const maxFileSize = config.get<number>('indexing.maxFileSize', 102400);
    const excludePatterns = config.get<string[]>('indexing.excludePatterns', []);

    this.chunker = new Chunker({ maxFileSize, excludePatterns });
    this.embedder = new Embedder(ollamaBaseUrl, embeddingModel);
    this.vectorStore = new VectorStore(workspacePath);

    const crucibleDir = path.join(workspacePath, '.crucible');
    fs.mkdirSync(crucibleDir, { recursive: true });
    this.manifestPath = path.join(crucibleDir, 'manifest.json');

    this.loadManifest();
  }

  onStatusChange(listener: StatusListener): void {
    this.listeners.push(listener);
  }

  getStatus(): IndexStatus {
    return { ...this.status };
  }

  getEmbedder(): Embedder {
    return this.embedder;
  }

  getVectorStore(): VectorStore {
    return this.vectorStore;
  }

  /**
   * Run the full indexing pipeline. Only re-indexes changed files.
   */
  async indexWorkspace(workspacePath: string): Promise<void> {
    if (this.indexing) return;
    this.indexing = true;

    this.updateStatus({ state: 'scanning', processedFiles: 0, totalFiles: 0, totalChunks: 0 });

    try {
      await this.vectorStore.connect();

      const files = await this.chunker.scanFiles(workspacePath);
      this.updateStatus({ state: 'hashing', totalFiles: files.length });

      const changedFiles: string[] = [];
      const currentPaths = new Set<string>();

      for (let i = 0; i < files.length; i++) {
        const filePath = files[i];
        currentPaths.add(filePath);
        const contentHash = await hashFileOnDiskAsync(filePath);
        if (!contentHash) continue;

        const cachedHash = this.manifest.get(filePath);
        if (cachedHash !== contentHash) {
          changedFiles.push(filePath);
          this.manifest.set(filePath, contentHash);
        }

        if (i % 50 === 0) {
          this.updateStatus({ processedFiles: i });
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      this.updateStatus({ processedFiles: files.length });

      // Remove files that no longer exist
      for (const [existingPath] of this.manifest) {
        if (!currentPaths.has(existingPath)) {
          this.manifest.delete(existingPath);
          await this.vectorStore.deleteByFile(existingPath);
        }
      }

      if (changedFiles.length === 0) {
        console.log('[Crucible] No changed files, marking ready');
        this.saveManifest();
        const recordCount = await this.vectorStore.getRecordCount();
        this.updateStatus({
          state: 'ready',
          processedFiles: files.length,
          totalChunks: recordCount,
          lastIndexedAt: Date.now(),
        });
        this.indexing = false;
        return;
      }

      console.log(`[Crucible] ${changedFiles.length} changed files, starting embedding`);

      const BATCH_SIZE = 50;
      let processed = files.length - changedFiles.length;
      let totalChunks = await this.vectorStore.getRecordCount();

      this.updateStatus({
        state: 'indexing',
        processedFiles: processed,
        changedFiles: changedFiles.length,
      });

      for (let i = 0; i < changedFiles.length; i += BATCH_SIZE) {
        const batch = changedFiles.slice(i, i + BATCH_SIZE);
        const batchChunks: CodeChunk[] = [];

        for (const filePath of batch) {
          await this.vectorStore.deleteByFile(filePath);

          const chunks = await this.chunker.chunkFile(filePath, workspacePath);
          batchChunks.push(...chunks);
        }

        if (batchChunks.length > 0) {
          const texts = batchChunks.map((c) => c.contextualizedText);

          let embeddings;
          try {
            embeddings = await withTimeout(
              this.embedder.embedBatch(texts),
              EMBED_TIMEOUT_MS,
            );
          } catch (err: any) {
            console.warn(`[Crucible] Embed batch failed: ${err?.message}`);
            processed += batch.length;
            this.updateStatus({ processedFiles: processed });
            continue;
          }

          const records: ChunkRecord[] = batchChunks.map((chunk, idx) => ({
            vector: embeddings[idx].vector,
            filePath: chunk.filePath,
            relativePath: chunk.relativePath,
            lineStart: chunk.lineStart,
            lineEnd: chunk.lineEnd,
            contentHash: chunk.contentHash,
            contextualizedText: chunk.contextualizedText,
            entities: chunk.entities,
            language: chunk.language,
          }));

          await this.vectorStore.upsert(records);
          totalChunks += records.length;
        }

        processed += batch.length;
        this.updateStatus({ processedFiles: processed, totalChunks });

        // Yield to the event loop so the webview can repaint
        await new Promise((r) => setTimeout(r, 0));
      }

      this.saveManifest();
      this.updateStatus({
        state: 'ready',
        processedFiles: files.length,
        totalChunks,
        lastIndexedAt: Date.now(),
      });
    } catch (err: any) {
      this.updateStatus({ state: 'error', error: err.message });
    } finally {
      this.indexing = false;
    }
  }

  /**
   * Re-index a single file (called by file watcher, debounced).
   */
  async reindexFile(filePath: string, workspacePath: string): Promise<void> {
    try {
      const contentHash = await hashFileOnDiskAsync(filePath);
      if (!contentHash) {
        // File deleted or unreadable
        this.manifest.delete(filePath);
        await this.vectorStore.deleteByFile(filePath);
        this.saveManifest();
        return;
      }

      if (this.manifest.get(filePath) === contentHash) return;

      await this.vectorStore.deleteByFile(filePath);

      const chunks = await this.chunker.chunkFile(filePath, workspacePath);
      if (chunks.length > 0) {
        const texts = chunks.map((c) => c.contextualizedText);
        const embeddings = await this.embedder.embedBatch(texts);

        const records: ChunkRecord[] = chunks.map((chunk, idx) => ({
          vector: embeddings[idx].vector,
          filePath: chunk.filePath,
          relativePath: chunk.relativePath,
          lineStart: chunk.lineStart,
          lineEnd: chunk.lineEnd,
          contentHash: chunk.contentHash,
          contextualizedText: chunk.contextualizedText,
          entities: chunk.entities,
          language: chunk.language,
        }));

        await this.vectorStore.upsert(records);
      }

      this.manifest.set(filePath, contentHash);
      this.saveManifest();
    } catch {
      // Silently handle individual file errors
    }
  }

  /**
   * Register file watchers for incremental updates.
   */
  registerWatchers(workspacePath: string): void {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspacePath, '**/*'),
    );

    const crucibleDir = path.join(workspacePath, '.crucible') + path.sep;
    const DEBOUNCE_MS = 2000;

    const debouncedReindex = (uri: vscode.Uri) => {
      const fp = uri.fsPath;
      if (fp.startsWith(crucibleDir)) return;

      const existing = this.debounceTimers.get(fp);
      if (existing) clearTimeout(existing);

      this.debounceTimers.set(
        fp,
        setTimeout(() => {
          this.debounceTimers.delete(fp);
          this.reindexFile(fp, workspacePath);
        }, DEBOUNCE_MS),
      );
    };

    this.disposables.push(
      watcher.onDidChange(debouncedReindex),
      watcher.onDidCreate(debouncedReindex),
      watcher.onDidDelete((uri) => {
        if (uri.fsPath.startsWith(crucibleDir)) return;
        this.manifest.delete(uri.fsPath);
        this.vectorStore.deleteByFile(uri.fsPath);
        this.saveManifest();
      }),
      watcher,
    );
  }

  async reindexAll(workspacePath: string): Promise<void> {
    await this.vectorStore.dropAll();
    this.manifest.clear();
    this.saveManifest();
    await this.indexWorkspace(workspacePath);
  }

  private updateStatus(partial: Partial<IndexStatus>): void {
    Object.assign(this.status, partial);
    for (const listener of this.listeners) {
      listener(this.status);
    }
  }

  private loadManifest(): void {
    try {
      if (fs.existsSync(this.manifestPath)) {
        const data = JSON.parse(fs.readFileSync(this.manifestPath, 'utf-8'));
        this.manifest = new Map(Object.entries(data));
      }
    } catch {
      this.manifest = new Map();
    }
  }

  private async saveManifestAsync(): Promise<void> {
    try {
      const dir = path.dirname(this.manifestPath);
      await fsp.mkdir(dir, { recursive: true });
      const obj = Object.fromEntries(this.manifest);
      await fsp.writeFile(this.manifestPath, JSON.stringify(obj));
    } catch {
      // Non-critical
    }
  }

  private saveManifest(): void {
    this.saveManifestAsync();
  }

  dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

async function hashFileOnDiskAsync(filePath: string): Promise<string | null> {
  try {
    const handle = await fsp.open(filePath, 'r');
    try {
      const hash = crypto.createHash('sha256');
      const buf = Buffer.alloc(8192);
      let result: { bytesRead: number };
      while ((result = await handle.read(buf, 0, 8192, null)).bytesRead > 0) {
        hash.update(buf.subarray(0, result.bytesRead));
      }
      return hash.digest('hex').substring(0, 16);
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}
