import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import type { AgentTool, ToolResult } from './types';
import { PermissionsManager } from '../permissions';

export class TerminalTool implements AgentTool {
  name = 'run_command';
  description = 'Run a shell command in the workspace directory';
  parameters = {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to run',
      },
      cwd: {
        type: 'string',
        description: 'Optional working directory (relative to workspace root)',
      },
    },
    required: ['command'],
  };

  private permissions: PermissionsManager;

  constructor(permissions: PermissionsManager) {
    this.permissions = permissions;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const command = args.command as string;
    const relativeCwd = args.cwd as string | undefined;

    // Check permissions
    const permCheck = await this.permissions.checkCommand(command);
    if (!permCheck.allowed) {
      return {
        success: false,
        output: '',
        error: `Command blocked: ${permCheck.reason}`,
      };
    }

    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
      return { success: false, output: '', error: 'No workspace folder open' };
    }

    const workspaceRoot = folders[0].uri.fsPath;
    let cwd: string;

    if (relativeCwd) {
      const normalized = path.normalize(path.join(workspaceRoot, relativeCwd));
      let resolved: string;
      try {
        resolved = fs.existsSync(normalized)
          ? fs.realpathSync(normalized)
          : normalized;
      } catch {
        resolved = normalized;
      }

      const normalizedRoot = path.normalize(workspaceRoot);
      if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
        return {
          success: false,
          output: '',
          error: `Working directory "${relativeCwd}" resolves outside workspace (${resolved})`,
        };
      }
      cwd = resolved;
    } else {
      cwd = workspaceRoot;
    }

    return new Promise((resolve) => {
      const timeout = 30_000;

      cp.exec(command, { cwd, timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          resolve({
            success: false,
            output: stdout || '',
            error: stderr || err.message,
          });
        } else {
          resolve({
            success: true,
            output: (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).trim(),
          });
        }
      });
    });
  }
}
