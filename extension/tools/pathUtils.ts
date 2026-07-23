import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import picomatch from 'picomatch';
import type { ToolAccessPolicy } from './types';

export type PolicyProvider = () => ToolAccessPolicy | null;

/**
 * Resolve and validate that a file path is within the workspace root.
 * Resolves symlinks and normalizes path traversal before checking.
 */
export function validatePath(
  filePath: string,
  workspaceRoot: string,
  requireWrite = false,
): { valid: boolean; resolved: string; error?: string } {
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

export function getWorkspaceRoot(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  return folders?.[0]?.uri.fsPath ?? null;
}

export function checkPathAgainstPolicy(
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
