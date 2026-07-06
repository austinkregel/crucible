import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as vscode from 'vscode';

const CRUCIBLE_DIR = path.join(os.homedir(), '.crucible');

export class CacheStore {
  private basePath: string;

  constructor(workspacePath?: string) {
    const hash = workspacePath ? hashString(workspacePath) : 'no-workspace';
    this.basePath = path.join(CRUCIBLE_DIR, hash);
    fs.mkdirSync(this.basePath, { recursive: true });
  }

  static fromWorkspace(): CacheStore {
    const folders = vscode.workspace.workspaceFolders;
    return new CacheStore(folders?.[0]?.uri.fsPath);
  }

  private filePath(namespace: string, key: string): string {
    const dir = path.join(this.basePath, namespace);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${key}.json`);
  }

  get<T>(namespace: string, key: string): T | undefined {
    const fp = this.filePath(namespace, key);
    if (!fs.existsSync(fp)) return undefined;
    try {
      const raw = fs.readFileSync(fp, 'utf-8');
      const entry = JSON.parse(raw) as CacheEntry<T>;
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        fs.unlinkSync(fp);
        return undefined;
      }
      return entry.value;
    } catch {
      return undefined;
    }
  }

  set<T>(namespace: string, key: string, value: T, ttlMs?: number): void {
    const fp = this.filePath(namespace, key);
    const entry: CacheEntry<T> = {
      value,
      createdAt: Date.now(),
      expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
    };
    fs.writeFileSync(fp, JSON.stringify(entry, null, 2));
  }

  invalidate(namespace: string, key: string): boolean {
    const fp = this.filePath(namespace, key);
    if (fs.existsSync(fp)) {
      fs.unlinkSync(fp);
      return true;
    }
    return false;
  }

  invalidateNamespace(namespace: string): void {
    const dir = path.join(this.basePath, namespace);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  clearAll(): void {
    if (fs.existsSync(this.basePath)) {
      fs.rmSync(this.basePath, { recursive: true, force: true });
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  listKeys(namespace: string): string[] {
    const dir = path.join(this.basePath, namespace);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace('.json', ''));
  }
}

interface CacheEntry<T> {
  value: T;
  createdAt: number;
  expiresAt?: number;
}

export function hashString(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').substring(0, 16);
}

export function hashFile(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}
