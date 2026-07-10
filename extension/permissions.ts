import * as vscode from 'vscode';

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
}

export class PermissionsManager {
  private sessionApproved = new Set<string>();

  async checkCommand(command: string): Promise<PermissionCheckResult> {
    const config = vscode.workspace.getConfiguration('crucible');

    // Check blocked commands first
    const blocked = config.get<string[]>('terminal.blockedCommands', []);
    for (const pattern of blocked) {
      if (command.includes(pattern)) {
        return {
          allowed: false,
          reason: `Command matches blocked pattern: "${pattern}"`,
        };
      }
    }

    // Check if command starts with an allowed binary
    const allowed = config.get<string[]>('terminal.allowedCommands', []);
    const binary = command.trim().split(/\s+/)[0];

    if (allowed.length > 0 && !allowed.includes(binary)) {
      return {
        allowed: false,
        reason: `"${binary}" is not in the allowed commands list. Add it to crucible.terminal.allowedCommands.`,
      };
    }

    // Check if approval is required
    const requireApproval = config.get<boolean>('terminal.requireApproval', true);

    if (requireApproval && !this.sessionApproved.has(command)) {
      const choice = await vscode.window.showWarningMessage(
        `Crucible wants to run:\n\n${command}`,
        { modal: true },
        'Allow',
        'Allow & Remember',
        'Deny',
      );

      if (choice === 'Deny' || !choice) {
        return { allowed: false, reason: 'User denied command execution' };
      }

      if (choice === 'Allow & Remember') {
        this.sessionApproved.add(command);
      }
    }

    return { allowed: true };
  }

  /**
   * Record a command the user already approved upstream (the ToolRunner prompts
   * before dispatching), so checkCommand does not prompt a second time for it.
   * Allow/block list enforcement still applies.
   */
  approveForSession(command: string): void {
    this.sessionApproved.add(command);
  }

  clearSessionApprovals(): void {
    this.sessionApproved.clear();
  }
}
