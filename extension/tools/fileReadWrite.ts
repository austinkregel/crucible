import * as vscode from 'vscode';
import type { AgentTool, ToolResult } from './types';
import {
  validatePath,
  getWorkspaceRoot,
  checkPathAgainstPolicy,
  type PolicyProvider,
} from './pathUtils';

export type { PolicyProvider };

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
  description = 'Replace specific text in a file. oldText must uniquely identify one location unless replaceAll is set; if it matches multiple places the edit fails with the match count so you can add surrounding context.';
  parameters = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the file',
      },
      oldText: {
        type: 'string',
        description: 'Exact literal text to find. Must be unique in the file unless replaceAll or occurrence is set.',
      },
      newText: {
        type: 'string',
        description: 'Replacement text',
      },
      replaceAll: {
        type: 'boolean',
        description: 'Replace every occurrence of oldText instead of requiring a unique match. Default false.',
      },
      occurrence: {
        type: 'number',
        description: 'Replace only the Nth occurrence (1-based) when oldText is intentionally ambiguous.',
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
    const replaceAll = args.replaceAll === true;
    const occurrence = typeof args.occurrence === 'number' ? args.occurrence : undefined;

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

      const count = countOccurrences(content, oldText);
      if (count === 0) {
        return { success: false, output: '', error: 'Old text not found in file' };
      }

      let newContent: string;
      let replaced: number;

      if (occurrence !== undefined) {
        if (occurrence < 1 || occurrence > count) {
          return {
            success: false,
            output: '',
            error: `occurrence ${occurrence} is out of range: oldText matches ${count} time(s) in ${filePath}.`,
          };
        }
        newContent = replaceNthOccurrence(content, oldText, newText, occurrence);
        replaced = 1;
      } else if (count > 1 && !replaceAll) {
        // Fail loud rather than silently editing the wrong (first) site.
        const lines = occurrenceLines(content, oldText).slice(0, 3).join(', ');
        return {
          success: false,
          output: '',
          error: `oldText matches ${count} locations in ${filePath} (lines ${lines}...). Add surrounding context to make it unique, set replaceAll:true, or target one with occurrence:N.`,
        };
      } else {
        newContent = replaceAll
          ? content.split(oldText).join(newText)
          : content.replace(oldText, newText);
        replaced = replaceAll ? count : 1;
      }

      const encoder = new TextEncoder();
      await vscode.workspace.fs.writeFile(uris[0], encoder.encode(newContent));

      return { success: true, output: `Replaced ${replaced} occurrence(s) in ${filePath}` };
    } catch (err: any) {
      return { success: false, output: '', error: err.message };
    }
  }
}

/** Count non-overlapping literal occurrences of needle in haystack. */
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

/** 1-based line numbers where needle occurs (for disambiguation messages). */
function occurrenceLines(haystack: string, needle: string): number[] {
  const lines: number[] = [];
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    lines.push(haystack.slice(0, idx).split('\n').length);
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return lines;
}

/** Replace only the Nth (1-based) non-overlapping occurrence of needle. */
function replaceNthOccurrence(haystack: string, needle: string, replacement: string, n: number): string {
  let idx = haystack.indexOf(needle);
  let seen = 0;
  while (idx !== -1) {
    seen++;
    if (seen === n) {
      return haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length);
    }
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return haystack;
}
