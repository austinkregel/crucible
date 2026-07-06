import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

import * as cp from 'child_process';
import * as vscode from 'vscode';
import { CodeSearchTool } from '../codeSearch';

describe('CodeSearchTool', () => {
  let tool: CodeSearchTool;

  beforeEach(() => {
    vi.clearAllMocks();
    tool = new CodeSearchTool();
  });

  it('returns search results on success', async () => {
    (cp.exec as any).mockImplementation((_cmd: string, _opts: any, cb: Function) =>
      cb(null, 'src/main.ts:1:hello world', ''),
    );

    const result = await tool.execute({ pattern: 'hello' });

    expect(result.success).toBe(true);
    expect(result.output).toBe('src/main.ts:1:hello world');
  });

  it('returns "No matches found." when rg exits with code 1', async () => {
    const err: any = new Error('exit code 1');
    err.code = 1;
    (cp.exec as any).mockImplementation((_cmd: string, _opts: any, cb: Function) =>
      cb(err, '', ''),
    );

    const result = await tool.execute({ pattern: 'nonexistent' });

    expect(result.success).toBe(true);
    expect(result.output).toBe('No matches found.');
  });

  it('returns error on rg failure', async () => {
    const err: any = new Error('rg not found');
    err.code = 127;
    (cp.exec as any).mockImplementation((_cmd: string, _opts: any, cb: Function) =>
      cb(err, '', 'rg not found'),
    );

    const result = await tool.execute({ pattern: 'test' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('rg not found');
  });

  it('includes glob in command when provided', async () => {
    (cp.exec as any).mockImplementation((cmd: string, _opts: any, cb: Function) => {
      expect(cmd).toContain('--glob "*.ts"');
      cb(null, 'match', '');
    });

    await tool.execute({ pattern: 'test', glob: '*.ts' });

    expect(cp.exec).toHaveBeenCalled();
  });

  it('no workspace folder returns error', async () => {
    const original = vscode.workspace.workspaceFolders;
    (vscode.workspace as any).workspaceFolders = undefined;

    const result = await tool.execute({ pattern: 'test' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('No workspace folder open');

    (vscode.workspace as any).workspaceFolders = original;
  });
});
