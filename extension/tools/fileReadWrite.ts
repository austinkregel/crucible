import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import picomatch from 'picomatch';
import type { AgentTool, ToolResult, ToolAccessPolicy } from './types';

/**
 * Resolve and validate that a file path is within the workspace root.
 * Resolves symlinks and normalizes path traversal before checking.
 */
function validatePath(filePath: string, workspaceRoot: string, requireWrite = false): { valid: boolean; resolved: string; error?: string } {
  const absolute = path.isAbsolute(filePath)
    ? path.normalize(filePath)
    : path.normalize(path.join(workspaceRoot, filePath));

  // Resolve symlinks to prevent escape via symlinked dirs
  let resolved: string;
  try {
    const dir = path.dirname(absolute);
    if (fs.existsSync(dir)) {
      resolved = path.join(fs.realpathSync(dir), path.basename(absolute));
    } else {
      resolved = absolute;
    }
  } catch {
    resolved = absolute;
  }

  const normalizedRoot = path.normalize(workspaceRoot);

  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    const action = requireWrite ? 'write' : 'read';
    return {
      valid: false,
      resolved,
      error: `Cannot ${action} "${filePath}": path resolves outside workspace (${resolved})`,
    };
  }

  return { valid: true, resolved };
}

function getWorkspaceRoot(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  return folders?.[0]?.uri.fsPath ?? null;
}

export type PolicyProvider = () => ToolAccessPolicy | null;

function checkPathAgainstPolicy(
  resolvedPath: string,
  globs: string[] | undefined,
  action: 'read' | 'write',
): { allowed: boolean; error?: string } {
  if (!globs || globs.length === 0) return { allowed: true };

  const isMatch = picomatch(globs, { dot: true });
  if (!isMatch(resolvedPath)) {
    return {
      allowed: false,
      error: `Cannot ${action} "${resolvedPath}": path not allowed by policy (permitted: ${globs.join(', ')})`,
    };
  }
  return { allowed: true };
}

export class FileReadTool implements AgentTool {
  name = 'read_file';
  description = 'Read the contents of a file in the workspace';
  parameters = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the file in the workspace',
      },
      startLine: {
        type: 'number',
        description: 'Optional start line (1-indexed)',
      },
      endLine: {
        type: 'number',
        description: 'Optional end line (1-indexed)',
      },
    },
    required: ['path'],
  };

  private getPolicy: PolicyProvider;

  constructor(policyProvider?: PolicyProvider) {
    this.getPolicy = policyProvider ?? (() => null);
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = args.path as string;
    const startLine = args.startLine as number | undefined;
    const endLine = args.endLine as number | undefined;

    const root = getWorkspaceRoot();
    if (root) {
      const check = validatePath(filePath, root);
      if (!check.valid) {
        return { success: false, output: '', error: check.error };
      }

      const policy = this.getPolicy();
      if (policy?.fileReadPaths) {
        const globCheck = checkPathAgainstPolicy(check.resolved, policy.fileReadPaths, 'read');
        if (!globCheck.allowed) {
          return { success: false, output: '', error: globCheck.error };
        }
      }
    }

    try {
      const uris = await vscode.workspace.findFiles(filePath, '**/node_modules/**', 1);
      if (uris.length === 0) {
        return { success: false, output: '', error: `File not found: ${filePath}` };
      }

      const doc = await vscode.workspace.openTextDocument(uris[0]);
      let content = doc.getText();

      if (startLine !== undefined || endLine !== undefined) {
        const lines = content.split('\n');
        const start = (startLine || 1) - 1;
        const end = endLine || lines.length;
        content = lines.slice(start, end).join('\n');
      }

      return { success: true, output: content };
    } catch (err: any) {
      return { success: false, output: '', error: err.message };
    }
  }
}

export class FileWriteTool implements AgentTool {
  name = 'write_file';
  description = 'Create or overwrite a file in the workspace';
  parameters = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path for the file',
      },
      content: {
        type: 'string',
        description: 'Full content to write',
      },
    },
    required: ['path', 'content'],
  };

  private getPolicy: PolicyProvider;

  constructor(policyProvider?: PolicyProvider) {
    this.getPolicy = policyProvider ?? (() => null);
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = args.path as string;
    const content = args.content as string;

    try {
      const root = getWorkspaceRoot();
      if (!root) {
        return { success: false, output: '', error: 'No workspace folder open' };
      }

      const check = validatePath(filePath, root, true);
      if (!check.valid) {
        return { success: false, output: '', error: check.error };
      }

      const policy = this.getPolicy();
      if (policy?.fileWritePaths) {
        const globCheck = checkPathAgainstPolicy(check.resolved, policy.fileWritePaths, 'write');
        if (!globCheck.allowed) {
          return { success: false, output: '', error: globCheck.error };
        }
      }

      const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, filePath);
      const encoder = new TextEncoder();
      await vscode.workspace.fs.writeFile(uri, encoder.encode(content));

      return { success: true, output: `Written ${content.length} bytes to ${filePath}` };
    } catch (err: any) {
      return { success: false, output: '', error: err.message };
    }
  }
}

export class FileEditTool implements AgentTool {
  name = 'edit_file';
  description = 'Replace specific text in a file';
  parameters = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the file',
      },
      oldText: {
        type: 'string',
        description: 'Text to find and replace',
      },
      newText: {
        type: 'string',
        description: 'Replacement text',
      },
    },
    required: ['path', 'oldText', 'newText'],
  };

  private getPolicy: PolicyProvider;

  constructor(policyProvider?: PolicyProvider) {
    this.getPolicy = policyProvider ?? (() => null);
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = args.path as string;
    const oldText = args.oldText as string;
    const newText = args.newText as string;

    try {
      const root = getWorkspaceRoot();
      if (root) {
        const check = validatePath(filePath, root, true);
        if (!check.valid) {
          return { success: false, output: '', error: check.error };
        }

        const policy = this.getPolicy();
        if (policy?.fileWritePaths) {
          const globCheck = checkPathAgainstPolicy(check.resolved, policy.fileWritePaths, 'write');
          if (!globCheck.allowed) {
            return { success: false, output: '', error: globCheck.error };
          }
        }
      }

      const uris = await vscode.workspace.findFiles(filePath, '**/node_modules/**', 1);
      if (uris.length === 0) {
        return { success: false, output: '', error: `File not found: ${filePath}` };
      }

      const doc = await vscode.workspace.openTextDocument(uris[0]);
      const content = doc.getText();

      if (!content.includes(oldText)) {
        return { success: false, output: '', error: 'Old text not found in file' };
      }

      const newContent = content.replace(oldText, newText);
      const encoder = new TextEncoder();
      await vscode.workspace.fs.writeFile(uris[0], encoder.encode(newContent));

      return { success: true, output: `Replaced text in ${filePath}` };
    } catch (err: any) {
      return { success: false, output: '', error: err.message };
    }
  }
}
