import * as vscode from 'vscode';
import type { AgentTool, ToolResult, ToolAccessPolicy } from './types';
import type { OrchestratorEventHandler } from '../orchestrator/types';
import type { AuditLogger } from '../audit/logger';
import { FileReadTool, FileWriteTool, FileEditTool } from './fileReadWrite';
import { CodeSearchTool } from './codeSearch';
import { TerminalTool } from './terminal';
import { ListFilesTool } from './listFiles';
import { DiagnosticsTool } from './diagnostics';
import { PermissionsManager } from '../permissions';

export class ToolRunner {
  private tools = new Map<string, AgentTool>();
  private policy: ToolAccessPolicy | null = null;
  private sessionApprovedTools = new Set<string>();
  private auditLogger?: AuditLogger;
  private permissions?: PermissionsManager;

  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  setPolicy(policy: ToolAccessPolicy): void {
    this.policy = policy;
  }

  getPolicy(): ToolAccessPolicy | null {
    return this.policy;
  }

  setAuditLogger(logger: AuditLogger): void {
    this.auditLogger = logger;
  }

  clearSessionApprovals(): void {
    this.sessionApprovedTools.clear();
  }

  getTool(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Returns tool definitions filtered by the current policy.
   * Only tools in the policy's allowedTools list are included.
   */
  getToolDefinitions(): Array<{
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }> {
    return Array.from(this.tools.values())
      .filter((tool) => !this.policy || this.policy.allowedTools.includes(tool.name))
      .map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
  }

  registerBuiltins(permissions?: PermissionsManager): void {
    const policyProvider = () => this.policy;
    this.permissions = permissions ?? new PermissionsManager();
    this.register(new FileReadTool(policyProvider));
    this.register(new FileWriteTool(policyProvider));
    this.register(new FileEditTool(policyProvider));
    this.register(new CodeSearchTool(policyProvider));
    this.register(new TerminalTool(this.permissions));
    this.register(new ListFilesTool(policyProvider));
    this.register(new DiagnosticsTool());
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
    onEvent?: OrchestratorEventHandler,
  ): Promise<ToolResult> {
    // Policy enforcement: check if the tool is allowed
    if (this.policy && !this.policy.allowedTools.includes(name)) {
      const result: ToolResult = {
        success: false,
        output: '',
        error: `Tool "${name}" is not allowed in the current mode. Allowed: ${this.policy.allowedTools.join(', ')}`,
      };
      onEvent?.({ type: 'toolCallFailed', data: { tool: name, args, error: result.error } });
      return result;
    }

    // Policy enforcement: block terminal if not allowed
    if (this.policy && name === 'run_command' && !this.policy.terminalAllowed) {
      const result: ToolResult = {
        success: false,
        output: '',
        error: 'Terminal access is not allowed in the current mode.',
      };
      onEvent?.({ type: 'toolCallFailed', data: { tool: name, args, error: result.error } });
      return result;
    }

    const tool = this.tools.get(name);
    if (!tool) {
      const result: ToolResult = {
        success: false,
        output: '',
        error: `Tool "${name}" not found. Available: ${this.getToolNames().join(', ')}`,
      };
      onEvent?.({ type: 'toolCallFailed', data: { tool: name, args, error: result.error } });
      return result;
    }

    // Approval enforcement: require user confirmation unless explicitly opted out
    const needsApproval = this.policy?.requireApproval?.[name] !== false
      && (name === 'write_file' || name === 'edit_file' || name === 'run_command');

    if (needsApproval && !this.sessionApprovedTools.has(`${name}:${JSON.stringify(args)}`)) {
      this.auditLogger?.log('approval_prompt', { tool: name, args });

      const summary = summarizeToolArgs(name, args);
      const choice = await vscode.window.showWarningMessage(
        `Crucible wants to ${name}: ${summary}`,
        { modal: true },
        'Allow',
        'Allow & Remember',
        'Deny',
      );

      this.auditLogger?.log('approval_result', { tool: name, args, choice: choice || 'dismissed' });

      if (choice === 'Deny' || !choice) {
        const result: ToolResult = {
          success: false,
          output: '',
          error: 'User denied tool execution',
        };
        onEvent?.({ type: 'toolCallFailed', data: { tool: name, args, error: result.error } });
        return result;
      }

      if (choice === 'Allow & Remember') {
        this.sessionApprovedTools.add(`${name}:${JSON.stringify(args)}`);
      }

      // TerminalTool re-checks permissions downstream. Record the approval we
      // just obtained so the user isn't prompted twice for the same command.
      if (name === 'run_command' && typeof args.command === 'string') {
        this.permissions?.approveForSession(args.command);
      }
    }

    onEvent?.({ type: 'toolCallStarted', data: { tool: name, args } });
    this.auditLogger?.log('tool_call_start', { tool: name, args });
    const startTime = Date.now();

    try {
      const timeout = tool.timeout ?? 60_000;
      const result = await Promise.race([
        tool.execute(args),
        new Promise<ToolResult>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool "${name}" timed out after ${timeout}ms`)), timeout),
        ),
      ]);
      const duration_ms = Date.now() - startTime;

      if (result.success) {
        onEvent?.({ type: 'toolCallCompleted', data: { tool: name, args, result, duration_ms } });
        this.auditLogger?.log('tool_call_end', { tool: name, args, success: true, output: result.output, duration_ms });
      } else {
        onEvent?.({ type: 'toolCallFailed', data: { tool: name, args, error: result.error, duration_ms } });
        this.auditLogger?.log('tool_call_end', { tool: name, args, success: false, error: result.error, duration_ms });
      }

      return result;
    } catch (err: any) {
      const duration_ms = Date.now() - startTime;
      const result: ToolResult = {
        success: false,
        output: '',
        error: err.message,
      };
      onEvent?.({ type: 'toolCallFailed', data: { tool: name, args, error: err.message, duration_ms } });
      this.auditLogger?.log('tool_call_error', { tool: name, args, error: err.message, duration_ms });
      return result;
    }
  }
}

function summarizeToolArgs(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'write_file':
    case 'edit_file':
    case 'read_file':
      return String(args.path || '');
    case 'run_command':
      return `$ ${args.command || ''}`;
    case 'search_code':
      return `"${args.pattern || args.query || ''}"`;
    default:
      return JSON.stringify(args).slice(0, 100);
  }
}
