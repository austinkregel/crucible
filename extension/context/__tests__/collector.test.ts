import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { ContextCollector } from '../collector';
import { MockCacheStore } from '../../__mocks__/cacheStore';

describe('ContextCollector', () => {
  let store: MockCacheStore;
  let collector: ContextCollector;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new MockCacheStore();
    collector = new ContextCollector(store as any);
    (vscode.window as any).activeTextEditor = undefined;
    (vscode.workspace as any).asRelativePath = vi.fn((uri: any) => {
      const p = typeof uri === 'string' ? uri : uri.fsPath || uri.path;
      return p.replace('/test-workspace/', '');
    });
  });

  it('returns empty files with no mentions and no additionalPaths', async () => {
    const result = await collector.collect('Hello with no mentions');
    expect(result.files).toEqual([]);
    expect(result.mentions).toEqual([]);
  });

  it('resolves @file mentions', async () => {
    (vscode.workspace.findFiles as any).mockResolvedValue([
      { fsPath: '/test-workspace/src/utils.ts', scheme: 'file', path: '/test-workspace/src/utils.ts' },
    ]);
    (vscode.workspace.openTextDocument as any).mockResolvedValue({
      getText: () => 'export const x = 1;',
      uri: { fsPath: '/test-workspace/src/utils.ts' },
      languageId: 'typescript',
    });

    const result = await collector.collect('Check @src/utils.ts');
    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0].type).toBe('file');
    expect(result.files).toHaveLength(1);
    expect(result.files[0].content).toBe('export const x = 1;');
    expect(result.files[0].language).toBe('typescript');
  });

  it('resolves additionalPaths', async () => {
    (vscode.workspace.findFiles as any).mockResolvedValue([
      { fsPath: '/test-workspace/dropped.ts', scheme: 'file', path: '/test-workspace/dropped.ts' },
    ]);
    (vscode.workspace.openTextDocument as any).mockResolvedValue({
      getText: () => 'dropped content',
      uri: { fsPath: '/test-workspace/dropped.ts' },
      languageId: 'typescript',
    });

    const result = await collector.collect('msg', ['dropped.ts']);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].content).toBe('dropped content');
  });

  it('includes active editor when present', async () => {
    (vscode.window as any).activeTextEditor = {
      document: {
        getText: () => 'editor content',
        uri: { fsPath: '/test-workspace/active.ts' },
        languageId: 'typescript',
      },
    };

    const result = await collector.collect('hello');
    expect(result.activeEditor).toBeDefined();
    expect(result.activeEditor!.content).toBe('editor content');
    expect(result.activeEditor!.language).toBe('typescript');
  });

  it('uses summary for large active editor content (>5000 chars)', async () => {
    const largeContent = 'x\n'.repeat(5001);
    (vscode.window as any).activeTextEditor = {
      document: {
        getText: () => largeContent,
        uri: { fsPath: '/test-workspace/big.ts' },
        languageId: 'typescript',
      },
    };

    const result = await collector.collect('hello');
    expect(result.activeEditor).toBeDefined();
    expect(result.activeEditor!.content).toBeUndefined();
    expect(result.activeEditor!.summary).toBeDefined();
  });

  it('resolves @folder mentions', async () => {
    (vscode.workspace.findFiles as any).mockResolvedValue([
      { fsPath: '/test-workspace/src/a.ts', scheme: 'file', path: '/test-workspace/src/a.ts' },
    ]);
    (vscode.workspace.openTextDocument as any).mockResolvedValue({
      getText: () => 'code',
      uri: { fsPath: '/test-workspace/src/a.ts' },
      languageId: 'typescript',
    });

    const result = await collector.collect('Check @src/');
    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0].type).toBe('folder');
    expect(result.files.length).toBeGreaterThanOrEqual(1);
  });

  it('handles file not found gracefully', async () => {
    (vscode.workspace.findFiles as any).mockResolvedValue([]);

    const result = await collector.collect('Check @nonexistent.ts');
    expect(result.mentions).toHaveLength(1);
    expect(result.files).toHaveLength(0);
  });

  it('uses summary for large file content (>3000 chars) from resolved files', async () => {
    const largeContent = 'a'.repeat(4000);
    (vscode.workspace.findFiles as any).mockResolvedValue([
      { fsPath: '/test-workspace/big.ts', scheme: 'file', path: '/test-workspace/big.ts' },
    ]);
    (vscode.workspace.openTextDocument as any).mockResolvedValue({
      getText: () => largeContent,
      uri: { fsPath: '/test-workspace/big.ts' },
      languageId: 'typescript',
    });

    const result = await collector.collect('Check @big.ts');
    expect(result.files).toHaveLength(1);
    expect(result.files[0].content).toBeUndefined();
    expect(result.files[0].summary).toBeDefined();
  });
});
