import * as vscode from 'vscode';
import type { AgentTool, ToolResult } from './types';
import { getWorkspaceRoot, validatePath } from './pathUtils';

/**
 * Surfaces the type/lint errors the editor already sees, so an agent can
 * verify its own edits instead of guessing or shelling out to `tsc`. Reads
 * VSCode's live diagnostics (populated by the language servers) -- fully
 * in-process, no external tooling, no timeout risk.
 */
export class DiagnosticsTool implements AgentTool {
  name = 'get_diagnostics';
  description =
    'Get compiler/linter diagnostics (type errors, lint warnings) for a file or the whole workspace. ' +
    'Use after editing to verify a change. Note: diagnostics are produced by language servers and may lag a file write by a moment.';
  parameters = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to a file. Omit to report diagnostics across the whole workspace.',
      },
      severity: {
        type: 'string',
        enum: ['error', 'warning', 'all'],
        description: 'Minimum severity to include (default "error").',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of diagnostics to return (default 100).',
      },
    },
    required: [],
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const relPath = args.path as string | undefined;
    const severity = (args.severity as string) || 'error';
    const maxResults = (args.maxResults as number) || 100;

    try {
      const entries = relPath
        ? this.forFile(relPath)
        : vscode.languages.getDiagnostics();

      if (!entries) {
        return { success: false, output: '', error: `File not found: ${relPath}` };
      }

      const minSeverity = severityThreshold(severity);
      const lines: string[] = [];

      for (const [uri, diagnostics] of entries) {
        const rel = vscode.workspace.asRelativePath(uri);
        for (const d of diagnostics) {
          if (d.severity > minSeverity) continue; // lower enum value = more severe
          const pos = `${d.range.start.line + 1}:${d.range.start.character + 1}`;
          const src = d.source ? ` (${d.source})` : '';
          lines.push(`${rel}:${pos} [${severityLabel(d.severity)}] ${d.message}${src}`);
          if (lines.length >= maxResults) break;
        }
        if (lines.length >= maxResults) break;
      }

      if (lines.length === 0) {
        return { success: true, output: 'No diagnostics.' };
      }
      return { success: true, output: lines.join('\n') };
    } catch (err: any) {
      return { success: false, output: '', error: err.message };
    }
  }

  /** Resolve a single file to its [uri, diagnostics] pair, or null if absent. */
  private forFile(relPath: string): [vscode.Uri, readonly vscode.Diagnostic[]][] | null {
    const root = getWorkspaceRoot();
    if (!root) return null;
    const check = validatePath(relPath, root, false);
    if (!check.valid) return null;
    const uri = vscode.Uri.file(check.resolved);
    return [[uri, vscode.languages.getDiagnostics(uri)]];
  }
}

function severityThreshold(severity: string): vscode.DiagnosticSeverity {
  switch (severity) {
    case 'all':
      return vscode.DiagnosticSeverity.Hint;
    case 'warning':
      return vscode.DiagnosticSeverity.Warning;
    default:
      return vscode.DiagnosticSeverity.Error;
  }
}

function severityLabel(severity: vscode.DiagnosticSeverity): string {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return 'error';
    case vscode.DiagnosticSeverity.Warning:
      return 'warning';
    case vscode.DiagnosticSeverity.Information:
      return 'info';
    default:
      return 'hint';
  }
}
