import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface CodeChunk {
  filePath: string;
  relativePath: string;
  lineStart: number;
  lineEnd: number;
  content: string;
  contextualizedText: string;
  contentHash: string;
  entities: string;
  language: string;
}

const PROBE_SIZE = 256;

/**
 * Read the first PROBE_SIZE bytes of a file as a raw buffer and return true
 * if the content looks like binary (contains null bytes or non-text control chars).
 */
function isBinaryFile(filePath: string): boolean {
  let fd: number;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch {
    return true;
  }

  try {
    const buf = Buffer.alloc(PROBE_SIZE);
    const bytesRead = fs.readSync(fd, buf, 0, PROBE_SIZE, 0);

    for (let i = 0; i < bytesRead; i++) {
      const byte = buf[i];
      if (byte === 0x00) return true;
      // Control chars outside tab (0x09), newline (0x0A), carriage return (0x0D)
      if (byte < 0x08) return true;
      if (byte === 0x0B || byte === 0x0C) return true;
      if (byte > 0x0D && byte < 0x20 && byte !== 0x1B) return true;
    }

    return false;
  } finally {
    fs.closeSync(fd);
  }
}

const SKIP_DIRS = new Set([
  '.git', '.crucible',
  'node_modules', 'vendor', '_build', 'deps', '.elixir_ls',
  '__pycache__', '.venv', 'venv', '.tox',
  '.next', '.nuxt', '.svelte-kit', '.output',
  'dist', 'build', 'out', 'target',
  '.cache', '.parcel-cache', '.turbo',
  'coverage', '.nyc_output',
  '.idea', '.vscode', '.fleet', '.nova',
]);

export class Chunker {
  private maxChunkSize: number;
  private maxFileSize: number;
  private excludePatterns: string[];

  constructor(opts?: { maxChunkSize?: number; maxFileSize?: number; excludePatterns?: string[] }) {
    this.maxChunkSize = opts?.maxChunkSize ?? 1500;
    this.maxFileSize = opts?.maxFileSize ?? 102400;
    this.excludePatterns = opts?.excludePatterns ?? [];
  }

  async chunkWorkspace(
    workspaceRoot: string,
    onProgress?: (processed: number, total: number) => void,
  ): Promise<CodeChunk[]> {
    const files = await this.scanFiles(workspaceRoot);
    const allChunks: CodeChunk[] = [];
    let processed = 0;

    for (const filePath of files) {
      try {
        const chunks = await this.chunkFile(filePath, workspaceRoot);
        allChunks.push(...chunks);
      } catch {
        // Skip files that fail to chunk
      }
      processed++;
      onProgress?.(processed, files.length);
    }

    return allChunks;
  }

  async chunkFile(filePath: string, workspaceRoot: string): Promise<CodeChunk[]> {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return [];
    }
    if (stat.size > this.maxFileSize || stat.size === 0) return [];
    if (isBinaryFile(filePath)) return [];

    const content = fs.readFileSync(filePath, 'utf-8');
    const relativePath = path.relative(workspaceRoot, filePath);
    const language = detectLanguage(filePath);

    try {
      const { chunk } = await import('code-chunk');
      const chunks = await chunk(relativePath, content, {
        maxChunkSize: this.maxChunkSize,
        contextMode: 'full',
        siblingDetail: 'signatures',
      });

      return chunks.map((c: any, idx: number) => ({
        filePath,
        relativePath,
        lineStart: c.lineRange?.[0] ?? idx * 50,
        lineEnd: c.lineRange?.[1] ?? (idx + 1) * 50,
        content: c.text || c.code || '',
        contextualizedText: c.contextualizedText || c.text || c.code || '',
        contentHash: hashContent(c.text || c.code || ''),
        entities: (c.entities || []).map((e: any) => e.name || e).join(', '),
        language,
      }));
    } catch {
      return this.fallbackChunk(filePath, content, relativePath, language);
    }
  }

  private fallbackChunk(
    filePath: string,
    content: string,
    relativePath: string,
    language: string,
  ): CodeChunk[] {
    const lines = content.split('\n');
    const chunkSize = 60;
    const chunks: CodeChunk[] = [];

    for (let i = 0; i < lines.length; i += chunkSize) {
      const slice = lines.slice(i, i + chunkSize);
      const text = slice.join('\n');
      chunks.push({
        filePath,
        relativePath,
        lineStart: i + 1,
        lineEnd: Math.min(i + chunkSize, lines.length),
        content: text,
        contextualizedText: `File: ${relativePath} (lines ${i + 1}-${Math.min(i + chunkSize, lines.length)})\n\n${text}`,
        contentHash: hashContent(text),
        entities: '',
        language,
      });
    }

    return chunks;
  }

  async scanFiles(workspaceRoot: string): Promise<string[]> {
    const ignorePatterns = this.loadIgnorePatterns(workspaceRoot);
    const files: string[] = [];
    const config = vscode.workspace.getConfiguration('crucible');
    const maxFiles = config.get<number>('indexing.maxFiles', 100000);

    const walk = (dir: string) => {
      if (files.length >= maxFiles) return;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (files.length >= maxFiles) break;

        const fullPath = path.join(dir, entry.name);
        const relative = path.relative(workspaceRoot, fullPath);

        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue;
          if (this.matchesIgnore(relative, ignorePatterns)) continue;
          walk(fullPath);
        } else if (entry.isFile()) {
          if (this.matchesIgnore(relative, ignorePatterns)) continue;
          if (this.matchesExclude(relative)) continue;
          files.push(fullPath);
        }
      }
    };

    walk(workspaceRoot);
    return files;
  }

  private loadIgnorePatterns(workspaceRoot: string): string[] {
    const patterns: string[] = [];
    for (const ignoreFile of ['.gitignore', '.crucibleignore']) {
      const fp = path.join(workspaceRoot, ignoreFile);
      if (fs.existsSync(fp)) {
        const lines = fs.readFileSync(fp, 'utf-8').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            patterns.push(trimmed);
          }
        }
      }
    }
    return patterns;
  }

  private matchesIgnore(relativePath: string, patterns: string[]): boolean {
    const segments = relativePath.split(path.sep);
    const fileName = segments[segments.length - 1];

    for (const raw of patterns) {
      let pattern = raw.replace(/\/$/, '');
      const rooted = pattern.startsWith('/');
      if (rooted) pattern = pattern.substring(1);

      if (pattern.includes('*')) {
        const regex = this.globToRegex(pattern, rooted);
        if (regex.test(relativePath)) return true;
        continue;
      }

      if (rooted) {
        if (relativePath === pattern || relativePath.startsWith(pattern + '/')) return true;
      } else {
        if (relativePath === pattern || relativePath.startsWith(pattern + '/')) return true;
        if (relativePath.includes('/' + pattern + '/') || relativePath.includes('/' + pattern)) {
          const idx = relativePath.indexOf('/' + pattern);
          const after = idx + 1 + pattern.length;
          if (after === relativePath.length || relativePath[after] === '/') return true;
        }
        if (fileName === pattern) return true;
      }
    }
    return false;
  }

  private globToRegex(pattern: string, rooted: boolean): RegExp {
    let re = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000')
      .replace(/\*/g, '[^/]*')
      // NUL is a deliberate placeholder for `**`, substituted above so the
      // single-`*` rule cannot clobber it.
      // eslint-disable-next-line no-control-regex
      .replace(/\u0000/g, '.*')
      .replace(/\?/g, '[^/]');
    if (rooted) {
      re = '^' + re;
    } else {
      re = '(?:^|/)' + re;
    }
    return new RegExp(re);
  }

  private matchesExclude(relativePath: string): boolean {
    for (const pattern of this.excludePatterns) {
      if (relativePath.includes(pattern)) return true;
    }
    return false;
  }
}

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript',
    '.py': 'python', '.pyi': 'python',
    '.rs': 'rust',
    '.go': 'go',
    '.java': 'java',
    '.vue': 'vue', '.svelte': 'svelte',
    '.css': 'css', '.scss': 'scss', '.less': 'less',
    '.html': 'html', '.htm': 'html',
    '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
    '.md': 'markdown', '.mdx': 'markdown',
    '.sql': 'sql',
    '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
    '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.hpp': 'cpp',
    '.cs': 'csharp',
    '.rb': 'ruby',
    '.php': 'php',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.ex': 'elixir', '.exs': 'elixir', '.heex': 'elixir',
    '.erl': 'erlang', '.hrl': 'erlang',
    '.r': 'r', '.R': 'r',
    '.lua': 'lua',
    '.zig': 'zig',
    '.nim': 'nim',
    '.dart': 'dart',
    '.scala': 'scala',
    '.clj': 'clojure', '.cljs': 'clojure',
    '.tf': 'hcl', '.hcl': 'hcl',
    '.toml': 'toml',
    '.xml': 'xml',
  };
  return map[ext] || 'text';
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}
