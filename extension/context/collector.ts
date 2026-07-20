import * as vscode from 'vscode';
import * as cp from 'child_process';
import { parseMentions, type Mention } from './mentions';
import { CacheStore } from '../cache/store';
import { FileSummaryCache } from '../cache/fileSummary';

/** How many lines of context to pull around a resolved symbol definition. */
const SYMBOL_SNIPPET_LINES = 40;
/** Cap on distinct definitions surfaced per @symbol mention. */
const MAX_SYMBOL_DEFINITIONS = 2;

export interface ContextFile {
  path: string;
  content?: string;
  summary?: string;
  language?: string;
}

export interface CollectedContext {
  files: ContextFile[];
  mentions: Mention[];
  activeEditor?: ContextFile;
}

/**
 * Resolves @-mentions and drag-drop file URIs into actual file content
 * or cached summaries, ready for the context compiler.
 */
export class ContextCollector {
  private fileSummaryCache: FileSummaryCache;

  constructor(store: CacheStore) {
    this.fileSummaryCache = new FileSummaryCache(store);
  }

  async collect(
    input: string,
    additionalPaths: string[] = [],
  ): Promise<CollectedContext> {
    const mentions = parseMentions(input);
    const files: ContextFile[] = [];

    // Resolve @-mentions
    for (const mention of mentions) {
      if (mention.type === 'file') {
        const resolved = await this.resolveFile(mention.value);
        if (resolved) files.push(resolved);
      } else if (mention.type === 'folder') {
        const folderFiles = await this.resolveFolder(mention.value);
        files.push(...folderFiles);
      } else if (mention.type === 'symbol') {
        const symbolFiles = await this.resolveSymbol(mention.value);
        files.push(...symbolFiles);
      }
    }

    // Add drag-dropped files
    for (const p of additionalPaths) {
      const resolved = await this.resolveFile(p);
      if (resolved) files.push(resolved);
    }

    // Add active editor context
    let activeEditor: ContextFile | undefined;
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const doc = editor.document;
      const content = doc.getText();
      activeEditor = {
        path: vscode.workspace.asRelativePath(doc.uri),
        content: content.length <= 5000 ? content : undefined,
        summary: content.length > 5000
          ? this.getOrCreateSummary(doc.uri.fsPath, content)
          : undefined,
        language: doc.languageId,
      };
    }

    return { files, mentions, activeEditor };
  }

  private async resolveFile(relativePath: string): Promise<ContextFile | undefined> {
    const uris = await vscode.workspace.findFiles(
      `**/${relativePath}`,
      '**/node_modules/**',
      1,
    );
    if (uris.length === 0) return undefined;

    const uri = uris[0];
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const content = doc.getText();
      const MAX_INLINE = 3000;

      return {
        path: vscode.workspace.asRelativePath(uri),
        content: content.length <= MAX_INLINE ? content : undefined,
        summary: content.length > MAX_INLINE
          ? this.getOrCreateSummary(uri.fsPath, content)
          : undefined,
        language: doc.languageId,
      };
    } catch {
      return undefined;
    }
  }

  private async resolveFolder(relativePath: string): Promise<ContextFile[]> {
    const uris = await vscode.workspace.findFiles(
      `**/${relativePath}*`,
      '**/node_modules/**',
      10,
    );
    const files: ContextFile[] = [];
    for (const uri of uris) {
      const resolved = await this.resolveFile(vscode.workspace.asRelativePath(uri));
      if (resolved) files.push(resolved);
    }
    return files;
  }

  /**
   * Resolve an @SymbolName mention to the code around its definition(s).
   * Previously these mentions were parsed then silently dropped.
   *
   * Primary: the workspace symbol provider (the running language server --
   * accurate, no dependency on the embedding index). Fallback: ripgrep for
   * definition-like lines, so a fresh workspace whose LSP hasn't warmed up
   * still gets grounding. Both are best-effort and never throw.
   */
  private async resolveSymbol(name: string): Promise<ContextFile[]> {
    let symbols: vscode.SymbolInformation[] | undefined;
    try {
      symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        'vscode.executeWorkspaceSymbolProvider',
        name,
      );
    } catch {
      symbols = undefined;
    }

    const located = (symbols ?? []).filter((s) => s?.location?.uri);
    if (located.length === 0) {
      return this.ripgrepDefinition(name);
    }

    // Exact-name matches first, then cap the number of distinct files.
    located.sort((a, b) => Number(b.name === name) - Number(a.name === name));

    const files: ContextFile[] = [];
    const seen = new Set<string>();
    for (const sym of located) {
      const fsPath = sym.location.uri.fsPath;
      if (seen.has(fsPath)) continue;
      seen.add(fsPath);
      const resolved = await this.resolveSymbolLocation(sym.location.uri, sym.location.range);
      if (resolved) files.push(resolved);
      if (files.length >= MAX_SYMBOL_DEFINITIONS) break;
    }
    return files;
  }

  private async resolveSymbolLocation(
    uri: vscode.Uri,
    range: vscode.Range,
  ): Promise<ContextFile | undefined> {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const lines = doc.getText().split('\n');
      const start = Math.max(0, range.start.line);
      const end = Math.min(lines.length, start + SYMBOL_SNIPPET_LINES);
      const snippet = lines.slice(start, end).join('\n');
      return {
        path: `${vscode.workspace.asRelativePath(uri)}:${start + 1}`,
        content: snippet,
        language: doc.languageId,
      };
    } catch {
      return undefined;
    }
  }

  /** Ripgrep fallback: find definition-like lines for a bare identifier. */
  private async ripgrepDefinition(name: string): Promise<ContextFile[]> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root || !/^[\w$]+$/.test(name)) return [];

    // Match common definition sites: class/function/const/interface/type/enum X
    const pattern = `\\b(class|function|const|let|var|interface|type|enum)\\s+${name}\\b`;
    const cmd =
      `rg --no-heading --line-number --max-count 1 ` +
      `--glob "!node_modules" --glob "!.git" --glob "!dist" ` +
      `"${pattern}"`;

    const stdout = await new Promise<string>((resolve) => {
      cp.exec(cmd, { cwd: root, timeout: 8_000, maxBuffer: 256 * 1024 }, (err, out) => {
        resolve(err && !out ? '' : out);
      });
    });

    const files: ContextFile[] = [];
    const seen = new Set<string>();
    for (const line of stdout.trim().split('\n').filter(Boolean)) {
      // rg output: relativePath:lineNumber:matchText
      const m = line.match(/^(.+?):(\d+):/);
      if (!m) continue;
      const relPath = m[1];
      if (seen.has(relPath)) continue;
      seen.add(relPath);
      const resolved = await this.resolveFile(relPath);
      if (resolved) files.push({ ...resolved, path: `${relPath}:${m[2]}` });
      if (files.length >= MAX_SYMBOL_DEFINITIONS) break;
    }
    return files;
  }

  private getOrCreateSummary(filePath: string, content: string): string | undefined {
    const cached = this.fileSummaryCache.get(filePath, content);
    if (cached) return cached.summary;
    // If no cached summary exists, we'll return a truncated preview.
    // The full summary generation happens asynchronously via the cheap model.
    return truncateToSnippet(content);
  }
}

function truncateToSnippet(content: string, maxLines = 50): string {
  const lines = content.split('\n');
  if (lines.length <= maxLines) return content;
  return lines.slice(0, maxLines).join('\n') + `\n... (${lines.length - maxLines} more lines)`;
}
