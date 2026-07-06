import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { FileReadTool, FileWriteTool, FileEditTool } from '../fileReadWrite';

describe('FileReadTool', () => {
  let tool: FileReadTool;

  beforeEach(() => {
    vi.clearAllMocks();
    tool = new FileReadTool();
  });

  it('reads a file successfully', async () => {
    (vscode.workspace.findFiles as any).mockResolvedValue([
      { fsPath: '/test-workspace/src/file.ts' },
    ]);
    (vscode.workspace.openTextDocument as any).mockResolvedValue({
      getText: () => 'file content here',
    });

    const result = await tool.execute({ path: 'src/file.ts' });

    expect(result.success).toBe(true);
    expect(result.output).toBe('file content here');
  });

  it('returns error for file not found', async () => {
    (vscode.workspace.findFiles as any).mockResolvedValue([]);

    const result = await tool.execute({ path: 'missing.ts' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('File not found');
  });

  it('supports line range (startLine/endLine)', async () => {
    (vscode.workspace.findFiles as any).mockResolvedValue([
      { fsPath: '/test-workspace/src/file.ts' },
    ]);
    (vscode.workspace.openTextDocument as any).mockResolvedValue({
      getText: () => 'line1\nline2\nline3\nline4\nline5',
    });

    const result = await tool.execute({ path: 'src/file.ts', startLine: 2, endLine: 4 });

    expect(result.success).toBe(true);
    expect(result.output).toBe('line2\nline3\nline4');
  });
});

describe('FileWriteTool', () => {
  let tool: FileWriteTool;

  beforeEach(() => {
    vi.clearAllMocks();
    tool = new FileWriteTool();
  });

  it('writes file successfully', async () => {
    const result = await tool.execute({ path: 'src/new.ts', content: 'hello' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Written');
    expect(vscode.workspace.fs.writeFile).toHaveBeenCalled();
  });

  it('returns error when no workspace folder', async () => {
    const original = vscode.workspace.workspaceFolders;
    (vscode.workspace as any).workspaceFolders = undefined;

    const result = await tool.execute({ path: 'file.ts', content: 'data' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('No workspace folder open');

    (vscode.workspace as any).workspaceFolders = original;
  });
});

describe('FileEditTool', () => {
  let tool: FileEditTool;

  beforeEach(() => {
    vi.clearAllMocks();
    tool = new FileEditTool();
  });

  it('replaces text in file', async () => {
    (vscode.workspace.findFiles as any).mockResolvedValue([
      { fsPath: '/test-workspace/src/file.ts' },
    ]);
    (vscode.workspace.openTextDocument as any).mockResolvedValue({
      getText: () => 'const old = true;',
    });

    const result = await tool.execute({
      path: 'src/file.ts',
      oldText: 'old',
      newText: 'updated',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Replaced');
    expect(vscode.workspace.fs.writeFile).toHaveBeenCalled();
  });

  it('returns error when old text not found', async () => {
    (vscode.workspace.findFiles as any).mockResolvedValue([
      { fsPath: '/test-workspace/src/file.ts' },
    ]);
    (vscode.workspace.openTextDocument as any).mockResolvedValue({
      getText: () => 'const value = 1;',
    });

    const result = await tool.execute({
      path: 'src/file.ts',
      oldText: 'nonexistent',
      newText: 'replacement',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Old text not found in file');
  });
});
