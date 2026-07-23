import * as vscode from 'vscode';
import type { AgentTool, ToolResult } from './types';
import { checkPathAgainstPolicy, type PolicyProvider } from './pathUtils';

export class ListFilesTool implements AgentTool {
  name = 'list_files';
  description = 'List files in the workspace, optionally filtered by a directory or glob pattern';
  parameters = {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern to filter files (default: **/*)',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results (default 100)',
      },
    },
    required: [],
  };

  private getPolicy: PolicyProvider;

  constructor(policyProvider?: PolicyProvider) {
    this.getPolicy = policyProvider ?? (() => null);
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const pattern = (args.pattern as string) || '**/*';
    const maxResults = (args.maxResults as number) || 100;

    try {
      const uris = await vscode.workspace.findFiles(pattern, '**/node_modules/**', maxResults);
      const readPaths = this.getPolicy()?.fileReadPaths;
      const allowed = readPaths?.length
        ? uris.filter((u) => checkPathAgainstPolicy(u.fsPath, readPaths, 'read').allowed)
        : uris;
      const paths = allowed.map((u) => vscode.workspace.asRelativePath(u));
      return { success: true, output: paths.join('\n') };
    } catch (err: any) {
      return { success: false, output: '', error: err.message };
    }
  }
}
