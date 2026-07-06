import * as vscode from 'vscode';
import { FileSummaryCache } from './fileSummary';
import { FunctionCache } from './functionCache';
import { CacheStore } from './store';

/**
 * Watches for file changes in the workspace and invalidates
 * relevant cache entries so summaries stay fresh.
 */
export class CacheWatcher implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private fileSummaryCache: FileSummaryCache;
  private functionCache: FunctionCache;

  constructor(store: CacheStore) {
    this.fileSummaryCache = new FileSummaryCache(store);
    this.functionCache = new FunctionCache(store);

    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        this.onDocumentChanged(e.document.uri.fsPath);
      }),
    );

    this.disposables.push(
      vscode.workspace.onDidDeleteFiles((e) => {
        for (const uri of e.files) {
          this.onDocumentChanged(uri.fsPath);
        }
      }),
    );
  }

  private onDocumentChanged(filePath: string) {
    this.fileSummaryCache.invalidate(filePath);
    this.functionCache.invalidateByFile(filePath);
  }

  dispose() {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
