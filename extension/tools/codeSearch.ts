import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import type { AgentTool, ToolResult } from './types';
import { checkPathAgainstPolicy, type PolicyProvider } from './pathUtils';

export class CodeSearchTool implements AgentTool {
  name = 'search_code';
  description = 'Search for text or regex patterns across the workspace using ripgrep';
  parameters = {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Search pattern (regex supported)',
      },
      glob: {
        type: 'string',
        description: 'File glob pattern to filter (e.g., "*.ts", "src/**/*.vue")',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results (default 20)',
      },
    },
    required: ['pattern'],
  };

  private getPolicy: PolicyProvider;

  constructor(policyProvider?: PolicyProvider) {
    this.getPolicy = policyProvider ?? (() => null);
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const pattern = args.pattern as string;
    const glob = args.glob as string | undefined;
    const maxResults = (args.maxResults as number) || 20;

    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
      return { success: false, output: '', error: 'No workspace folder open' };
    }

    const cwd = folders[0].uri.fsPath;

    let cmd = `rg --no-heading --line-number --max-count ${maxResults}`;
    if (glob) {
      cmd += ` --glob "${glob}"`;
    }
    cmd += ` --glob "!node_modules" --glob "!.git" --glob "!dist"`;
    cmd += ` "${pattern.replace(/"/g, '\\"')}"`;

    const readPaths = this.getPolicy()?.fileReadPaths;

    return new Promise((resolve) => {
      cp.exec(cmd, { cwd, timeout: 10_000, maxBuffer: 512 * 1024 }, (err, stdout, stderr) => {
        if (err && !stdout) {
          // rg returns exit code 1 when no matches found
          if (err.code === 1) {
            resolve({ success: true, output: 'No matches found.' });
          } else {
            resolve({ success: false, output: '', error: stderr || err.message });
          }
        } else {
          resolve({ success: true, output: filterByReadPolicy(stdout.trim(), cwd, readPaths) });
        }
      });
    });
  }
}

/** Drop ripgrep result lines whose file is outside the policy's read paths. */
function filterByReadPolicy(output: string, cwd: string, readPaths: string[] | undefined): string {
  if (!output || !readPaths || readPaths.length === 0) return output;
  const kept = output.split('\n').filter((line) => {
    const m = line.match(/^(.+?):\d+:/);
    if (!m) return true; // keep non-result lines (e.g. context separators)
    const abs = path.isAbsolute(m[1]) ? m[1] : path.join(cwd, m[1]);
    return checkPathAgainstPolicy(abs, readPaths, 'read').allowed;
  });
  return kept.join('\n');
}
