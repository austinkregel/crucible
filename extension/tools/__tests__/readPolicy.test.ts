import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { ListFilesTool } from '../listFiles';
import type { ToolAccessPolicy } from '../types';

describe('ListFilesTool read-path policy gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode.workspace as any).asRelativePath = vi.fn((uri: any) => {
      const p = typeof uri === 'string' ? uri : uri.fsPath || uri.path;
      return p.replace('/test-workspace/', '');
    });
  });

  it('drops results outside the policy read paths', async () => {
    (vscode.workspace.findFiles as any).mockResolvedValue([
      { fsPath: '/test-workspace/src/a.ts', path: '/test-workspace/src/a.ts' },
      { fsPath: '/test-workspace/secret/b.ts', path: '/test-workspace/secret/b.ts' },
    ]);

    const policy: ToolAccessPolicy = {
      allowedTools: ['list_files'],
      terminalAllowed: false,
      fileReadPaths: ['/test-workspace/src/**'],
    };
    const tool = new ListFilesTool(() => policy);

    const result = await tool.execute({});
    expect(result.output).toBe('src/a.ts');
  });

  it('returns everything when no read policy is set', async () => {
    (vscode.workspace.findFiles as any).mockResolvedValue([
      { fsPath: '/test-workspace/src/a.ts', path: '/test-workspace/src/a.ts' },
      { fsPath: '/test-workspace/secret/b.ts', path: '/test-workspace/secret/b.ts' },
    ]);

    const tool = new ListFilesTool();
    const result = await tool.execute({});
    expect(result.output.split('\n')).toHaveLength(2);
  });
});
