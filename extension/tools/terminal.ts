import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import type { AgentTool, ToolResult } from './types';
import { PermissionsManager } from '../permissions';

/** Hard ceiling on any single command, regardless of config/param. */
const COMMAND_CEILING_MS = 600_000; // 10 minutes
const DEFAULT_COMMAND_MS = 120_000; // 2 minutes
/** Output ring buffer: keep the head and tail, drop the middle. */
const HEAD_LINES = 200;
const TAIL_LINES = 800;

export class TerminalTool implements AgentTool {
  name = 'run_command';
  description = 'Run a shell command in the workspace directory. Long-running builds/tests are supported up to the configured ceiling.';
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
      timeoutMs: {
        type: 'number',
        description: 'Optional per-command timeout in ms (clamped to the configured ceiling). Use for long builds/tests.',
      },
    },
    required: ['command'],
  };

  // Runner's outer race uses tool.timeout; keep it above the command ceiling so
  // the command's own timeout always fires first.
  timeout = COMMAND_CEILING_MS + 5_000;

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

    const timeout = resolveTimeout(args.timeoutMs);

    return new Promise((resolve) => {
      cp.exec(command, { cwd, timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          const timedOut = (err as any).killed && (err as any).signal === 'SIGTERM';
          resolve({
            success: false,
            output: capOutput(stdout || ''),
            error: timedOut
              ? `Command timed out after ${timeout}ms`
              : stderr || err.message,
          });
        } else {
          resolve({
            success: true,
            output: capOutput((stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).trim()),
          });
        }
      });
    });
  }
}

/** Clamp the requested/config timeout into (0, ceiling]. */
function resolveTimeout(requested: unknown): number {
  const configured = vscode.workspace
    .getConfiguration('crucible')
    .get<number>('terminal.maxCommandDurationMs', DEFAULT_COMMAND_MS);
  const value = typeof requested === 'number' && requested > 0 ? requested : configured;
  return Math.min(Math.max(1_000, value), COMMAND_CEILING_MS);
}

/** Keep the head and tail of long output; collapse the middle with a marker. */
function capOutput(output: string): string {
  const lines = output.split('\n');
  if (lines.length <= HEAD_LINES + TAIL_LINES) return output;
  const head = lines.slice(0, HEAD_LINES);
  const tail = lines.slice(-TAIL_LINES);
  const dropped = lines.length - HEAD_LINES - TAIL_LINES;
  return [...head, `… (${dropped} lines omitted) …`, ...tail].join('\n');
}
