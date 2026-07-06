import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { ListFilesTool } from '../listFiles';

describe('ListFilesTool', () => {
  let tool: ListFilesTool;

  beforeEach(() => {
    vi.clearAllMocks();
    (vscode.workspace as any).asRelativePath = vi.fn((uri: any) =>
      typeof uri === 'string' ? uri : uri.fsPath?.replace('/test-workspace/', '') || uri.path,
    );
    tool = new ListFilesTool();
  });

  it('returns file paths from findFiles', async () => {
    (vscode.workspace.findFiles as any).mockResolvedValue([
      { fsPath: '/test-workspace/a.ts' },
      { fsPath: '/test-workspace/b.ts' },
    ]);

    const result = await tool.execute({});

    expect(result.success).toBe(true);
    expect(result.output).toContain('a.ts');
    expect(result.output).toContain('b.ts');
  });

  it('uses default pattern **/* when no pattern provided', async () => {
    (vscode.workspace.findFiles as any).mockResolvedValue([]);

    await tool.execute({});

    expect(vscode.workspace.findFiles).toHaveBeenCalledWith(
      '**/*',
      '**/node_modules/**',
      100,
    );
  });

  it('uses custom pattern and maxResults', async () => {
    (vscode.workspace.findFiles as any).mockResolvedValue([]);

    await tool.execute({ pattern: '**/*.vue', maxResults: 10 });

    expect(vscode.workspace.findFiles).toHaveBeenCalledWith(
      '**/*.vue',
      '**/node_modules/**',
      10,
    );
  });

  it('returns error when findFiles throws', async () => {
    (vscode.workspace.findFiles as any).mockRejectedValue(new Error('search failed'));

    const result = await tool.execute({});

    expect(result.success).toBe(false);
    expect(result.error).toBe('search failed');
  });
});
