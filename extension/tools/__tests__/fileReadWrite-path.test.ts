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

  it('fails loud when oldText is ambiguous (multiple matches)', async () => {
    (vscode.workspace.findFiles as any).mockResolvedValue([
      { fsPath: '/test-workspace/src/file.ts' },
    ]);
    (vscode.workspace.openTextDocument as any).mockResolvedValue({
      getText: () => 'x = 1;\ny = 1;\nz = 1;',
    });

    const result = await tool.execute({ path: 'src/file.ts', oldText: '1', newText: '2' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('matches 3 locations');
    expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
  });

  it('replaceAll replaces every occurrence', async () => {
    (vscode.workspace.findFiles as any).mockResolvedValue([
      { fsPath: '/test-workspace/src/file.ts' },
    ]);
    (vscode.workspace.openTextDocument as any).mockResolvedValue({
      getText: () => 'a a a',
    });

    const result = await tool.execute({
      path: 'src/file.ts',
      oldText: 'a',
      newText: 'b',
      replaceAll: true,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Replaced 3 occurrence');
    const written = (vscode.workspace.fs.writeFile as any).mock.calls[0][1];
    expect(new TextDecoder().decode(written)).toBe('b b b');
  });

  it('occurrence targets only the Nth match', async () => {
    (vscode.workspace.findFiles as any).mockResolvedValue([
      { fsPath: '/test-workspace/src/file.ts' },
    ]);
    (vscode.workspace.openTextDocument as any).mockResolvedValue({
      getText: () => 'a a a',
    });

    const result = await tool.execute({
      path: 'src/file.ts',
      oldText: 'a',
      newText: 'b',
      occurrence: 2,
    });

    expect(result.success).toBe(true);
    const written = (vscode.workspace.fs.writeFile as any).mock.calls[0][1];
    expect(new TextDecoder().decode(written)).toBe('a b a');
  });

  it('rejects out-of-range occurrence', async () => {
    (vscode.workspace.findFiles as any).mockResolvedValue([
      { fsPath: '/test-workspace/src/file.ts' },
    ]);
    (vscode.workspace.openTextDocument as any).mockResolvedValue({
      getText: () => 'a a',
    });

    const result = await tool.execute({
      path: 'src/file.ts',
      oldText: 'a',
      newText: 'b',
      occurrence: 5,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('out of range');
    expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
  });

  it('treats newText literally (no $-pattern substitution)', async () => {
    (vscode.workspace.findFiles as any).mockResolvedValue([
      { fsPath: '/test-workspace/src/file.ts' },
    ]);
    (vscode.workspace.openTextDocument as any).mockResolvedValue({
      getText: () => 'const label = PLACEHOLDER;',
    });

    // $&, $1, $` all have special meaning to String.prototype.replace's
    // replacement string; a literal replacement must preserve them verbatim.
    const result = await tool.execute({
      path: 'src/file.ts',
      oldText: 'PLACEHOLDER',
      newText: "cost + '$&' + '$1' + '$`'",
    });

    expect(result.success).toBe(true);
    const written = (vscode.workspace.fs.writeFile as any).mock.calls[0][1];
    expect(new TextDecoder().decode(written)).toBe("const label = cost + '$&' + '$1' + '$`';");
  });

  it('replaceAll treats newText literally too', async () => {
    (vscode.workspace.findFiles as any).mockResolvedValue([
      { fsPath: '/test-workspace/src/file.ts' },
    ]);
    (vscode.workspace.openTextDocument as any).mockResolvedValue({
      getText: () => 'X X',
    });

    const result = await tool.execute({
      path: 'src/file.ts',
      oldText: 'X',
      newText: '$&',
      replaceAll: true,
    });

    expect(result.success).toBe(true);
    const written = (vscode.workspace.fs.writeFile as any).mock.calls[0][1];
    expect(new TextDecoder().decode(written)).toBe('$& $&');
  });
});
