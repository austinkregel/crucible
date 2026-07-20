import * as fs from 'fs';
import * as path from 'path';
import type { CacheStore } from '../cache/store';
import { estimateTokens } from '../utils/tokens';

/**
 * Reads the project's own configuration and convention files and renders a
 * single bounded prompt block so every orchestrator role (and chat) is
 * grounded in the real project instead of guessing scripts, conventions, and
 * structure.
 *
 * Sources (whichever exist):
 *  - Agent-instruction files: CLAUDE.md, AGENTS.md, .cursorrules,
 *    .github/copilot-instructions.md (all -- they are complementary).
 *  - package.json  -> script names+commands, dependency names, name/description.
 *  - tsconfig.json -> a one-line summary of key compilerOptions.
 *  - README.md     -> the first heading block only.
 *  - A depth-2 directory tree (node_modules/.git/dist excluded).
 *
 * The rendered block is hard-capped in tokens (see TOTAL_TOKEN_CAP) because the
 * orchestrator prompt path has no budget enforcement -- this cap is the guard
 * against grounding overflowing the context window.
 */

const INSTRUCTION_FILES = [
  'CLAUDE.md',
  'AGENTS.md',
  '.cursorrules',
  '.github/copilot-instructions.md',
];

/** Directories never worth walking or listing. Mirrors codeSearch excludes. */
const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', 'out']);

const INSTRUCTIONS_TOKEN_CAP = 1200;
const OVERVIEW_TOKEN_CAP = 600;
const TOTAL_TOKEN_CAP = INSTRUCTIONS_TOKEN_CAP + OVERVIEW_TOKEN_CAP;

const CACHE_NAMESPACE = 'project-grounding';
const CACHE_KEY = 'summary';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day backstop

interface GroundingCache {
  fingerprint: string;
  section: string;
}

export class ProjectGrounding {
  private section = '';

  constructor(
    private store: CacheStore,
    private workspaceRoot: string,
  ) {}

  /** The rendered grounding block, or '' if load() has not run / found nothing. */
  toPromptSection(): string {
    return this.section;
  }

  /**
   * Build (or restore from cache) the grounding block. Cheap on a cache hit:
   * only stats the source files to compute a fingerprint, no content reads.
   */
  async load(): Promise<string> {
    const fingerprint = this.computeFingerprint();

    const cached = this.store.get<GroundingCache>(CACHE_NAMESPACE, CACHE_KEY);
    if (cached && cached.fingerprint === fingerprint) {
      this.section = cached.section;
      return this.section;
    }

    this.section = this.build();
    this.store.set<GroundingCache>(
      CACHE_NAMESPACE,
      CACHE_KEY,
      { fingerprint, section: this.section },
      CACHE_TTL_MS,
    );
    return this.section;
  }

  /** Force a rebuild ignoring the cache (e.g. on a known source change). */
  async refresh(): Promise<string> {
    this.store.invalidate(CACHE_NAMESPACE, CACHE_KEY);
    return this.load();
  }

  // --- internals ---

  /** {mtime,size} of every source, so a cache hit needs no content reads. */
  private computeFingerprint(): string {
    const stats: Record<string, string> = {};
    const sources = [
      ...INSTRUCTION_FILES,
      'package.json',
      'tsconfig.json',
      'README.md',
    ];
    for (const rel of sources) {
      const abs = path.join(this.workspaceRoot, rel);
      try {
        const st = fs.statSync(abs);
        stats[rel] = `${st.mtimeMs}:${st.size}`;
      } catch {
        // missing file contributes nothing
      }
    }
    // Top-level dir listing affects the tree section.
    try {
      stats['.tree'] = this.topLevelDirs().join(',');
    } catch {
      // ignore
    }
    return JSON.stringify(stats);
  }

  private build(): string {
    const instructions = this.renderInstructions();
    const overview = this.renderOverview();

    const blocks: string[] = [];
    if (instructions) {
      blocks.push(`## Project Instructions\n${instructions}`);
    }
    if (overview) {
      blocks.push(`## Project Overview\n${overview}`);
    }
    return blocks.join('\n\n');
  }

  private renderInstructions(): string {
    const parts: string[] = [];
    for (const rel of INSTRUCTION_FILES) {
      const content = this.readFile(rel);
      if (content && content.trim()) {
        parts.push(`### ${rel}\n${content.trim()}`);
      }
    }
    if (parts.length === 0) return '';
    return capTokens(parts.join('\n\n'), INSTRUCTIONS_TOKEN_CAP);
  }

  private renderOverview(): string {
    const lines: string[] = [];

    const pkg = this.readJson('package.json');
    if (pkg) {
      if (typeof pkg.name === 'string') {
        const desc = typeof pkg.description === 'string' ? ` — ${pkg.description}` : '';
        lines.push(`Package: ${pkg.name}${desc}`);
      }
      if (pkg.scripts && typeof pkg.scripts === 'object') {
        const scripts = Object.entries(pkg.scripts as Record<string, string>)
          .map(([k, v]) => `${k}: ${v}`)
          .join('; ');
        if (scripts) lines.push(`Scripts: ${scripts}`);
      }
      const deps = [
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
      ];
      if (deps.length) {
        lines.push(`Key deps: ${deps.slice(0, 40).join(', ')}`);
      }
    }

    const tsconfig = this.readJson('tsconfig.json');
    if (tsconfig) {
      const co = (tsconfig.compilerOptions ?? {}) as Record<string, unknown>;
      const bits: string[] = [];
      for (const key of ['module', 'target', 'moduleResolution', 'strict', 'jsx']) {
        if (co[key] !== undefined) bits.push(`${key}=${co[key]}`);
      }
      if (tsconfig.extends) bits.unshift(`extends ${tsconfig.extends}`);
      if (bits.length) lines.push(`tsconfig: ${bits.join(', ')}`);
    }

    const readme = this.readmeIntro();
    if (readme) lines.push(`README: ${readme}`);

    const tree = this.topLevelDirs();
    if (tree.length) lines.push(`Structure: ${tree.join(', ')}`);

    if (lines.length === 0) return '';
    return capTokens(lines.join('\n'), OVERVIEW_TOKEN_CAP);
  }

  /** First heading block of the README, collapsed to a short single line. */
  private readmeIntro(): string {
    const content = this.readFile('README.md');
    if (!content) return '';
    const lines = content.split('\n').slice(0, 40);
    // Take the first non-empty, non-heading paragraph after the title.
    const text: string[] = [];
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith('#') || t.startsWith('![') || t.startsWith('[!')) continue;
      text.push(t);
      if (text.join(' ').length > 240) break;
    }
    return text.join(' ').slice(0, 240);
  }

  /** Top-level source-ish directories, one level deep. */
  private topLevelDirs(): string[] {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.workspaceRoot, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((e) => e.isDirectory() && !EXCLUDED_DIRS.has(e.name) && !e.name.startsWith('.'))
      .map((e) => {
        const children = this.childDirs(path.join(this.workspaceRoot, e.name));
        return children.length ? `${e.name}/{${children.join(',')}}` : `${e.name}/`;
      });
  }

  private childDirs(dir: string): string[] {
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !EXCLUDED_DIRS.has(e.name) && !e.name.startsWith('.'))
        .map((e) => e.name)
        .slice(0, 8);
    } catch {
      return [];
    }
  }

  private readFile(rel: string): string | undefined {
    try {
      return fs.readFileSync(path.join(this.workspaceRoot, rel), 'utf-8');
    } catch {
      return undefined;
    }
  }

  private readJson(rel: string): Record<string, any> | undefined {
    const content = this.readFile(rel);
    if (!content) return undefined;
    try {
      return JSON.parse(content);
    } catch {
      return undefined;
    }
  }
}

/** Truncate text to a token budget, appending an explicit marker when cut. */
function capTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  const maxChars = maxTokens * 4;
  return `${text.slice(0, maxChars).trimEnd()}\n…(truncated)`;
}

export { TOTAL_TOKEN_CAP, INSTRUCTIONS_TOKEN_CAP, OVERVIEW_TOKEN_CAP };
