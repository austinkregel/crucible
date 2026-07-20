import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { DiagnosticsTool } from '../diagnostics';

function diag(line: number, message: string, severity: number, source?: string) {
  return {
    range: { start: { line, character: 2 }, end: { line, character: 5 } },
    message,
    severity,
    source,
  };
}

describe('DiagnosticsTool', () => {
  let tool: DiagnosticsTool;

  beforeEach(() => {
    vi.clearAllMocks();
    tool = new DiagnosticsTool();
    (vscode.workspace as any).asRelativePath = vi.fn((uri: any) => {
      const p = typeof uri === 'string' ? uri : uri.fsPath || uri.path;
      return p.replace('/test-workspace/', '');
    });
  });

  it('formats workspace diagnostics and filters to errors by default', async () => {
    (vscode.languages.getDiagnostics as any).mockReturnValue([
      [
        { fsPath: '/test-workspace/src/a.ts' },
        [
          diag(11, 'Type X not assignable to Y', vscode.DiagnosticSeverity.Error, 'ts'),
          diag(3, 'unused var', vscode.DiagnosticSeverity.Warning, 'eslint'),
        ],
      ],
    ]);

    const result = await tool.execute({});
    expect(result.success).toBe(true);
    expect(result.output).toBe('src/a.ts:12:3 [error] Type X not assignable to Y (ts)');
  });

  it('includes warnings when severity=all', async () => {
    (vscode.languages.getDiagnostics as any).mockReturnValue([
      [
        { fsPath: '/test-workspace/src/a.ts' },
        [diag(3, 'unused var', vscode.DiagnosticSeverity.Warning, 'eslint')],
      ],
    ]);

    const result = await tool.execute({ severity: 'all' });
    expect(result.output).toContain('[warning] unused var');
  });

  it('reports no diagnostics cleanly', async () => {
    (vscode.languages.getDiagnostics as any).mockReturnValue([]);
    const result = await tool.execute({});
    expect(result.success).toBe(true);
    expect(result.output).toBe('No diagnostics.');
  });
});
