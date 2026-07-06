import * as vscode from 'vscode';
import { parseMentions, type Mention } from './mentions';
import { CacheStore } from '../cache/store';
import { FileSummaryCache, type FileSummaryEntry } from '../cache/fileSummary';

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
