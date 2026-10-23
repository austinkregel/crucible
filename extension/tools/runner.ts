import type { AgentTool, ToolResult, ToolAccessPolicy, ToolContext } from './types';
import type { AuditLogger } from '../audit/logger';
import { FileReadTool, FileWriteTool, FileEditTool } from './fileReadWrite';
import { CodeSearchTool } from './codeSearch';
import { TerminalTool } from './terminal';
import { ListFilesTool } from './listFiles';
import { DiagnosticsTool } from './diagnostics';
import { PermissionsManager } from '../permissions';
import { createToolContext } from './context';
import { nativeHumanChannel } from './nativeHuman';
import { asRunId, asAgentId, type AgentRef } from '../contracts/ids';

export class ToolRunner {
  private tools = new Map<string, AgentTool>();
  /**
   * The single top-level agent's policy. Concurrent sub-agents do NOT use this — they pass an
   * explicit ToolContext to executeTool, so their policy never touches shared state and cannot
   * race another agent's. This field exists only to build the default context for the one
   * top-level agent (see defaultContext()).
   */
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
   * Returns tool definitions filtered by a policy. Pass the agent's own policy (sub-agents)
   * or omit to fall back to the top-level agent's policy. Only tools in the policy's
   * allowedTools list are included.
   */
  getToolDefinitions(policy: ToolAccessPolicy | null = this.policy): Array<{
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }> {
    return Array.from(this.tools.values())
      .filter((tool) => !policy || policy.allowedTools.includes(tool.name))
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
    this.permissions = permissions ?? new PermissionsManager();
    this.register(new FileReadTool());
    this.register(new FileWriteTool());
    this.register(new FileEditTool());
    this.register(new CodeSearchTool());
    this.register(new TerminalTool(this.permissions));
    this.register(new ListFilesTool());
    this.register(new DiagnosticsTool());
  }

  /**
   * Context for the single top-level agent when no explicit one is supplied. A null policy
   * means "allow everything" (unchanged legacy behavior), synthesized as a permissive policy.
   * Human prompts fall back to native VSCode modals until the broker is wired in.
   */
  private defaultContext(): ToolContext {
    const policy: ToolAccessPolicy = this.policy ?? {
      allowedTools: this.getToolNames(),
      terminalAllowed: true,
    };
    const ref: AgentRef = {
      runId: asRunId('root'),
      agentId: asAgentId('root'),
      agentType: 'root',
    };
    return createToolContext({
      ref,
      policy,
      signal: new AbortController().signal,
      human: nativeHumanChannel(),
      sink: () => {},
    });
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
    ctx?: ToolContext,
  ): Promise<ToolResult> {
    const context = ctx ?? this.defaultContext();
    const policy = context.policy;

    // Policy enforcement: check if the tool is allowed
    if (policy && !policy.allowedTools.includes(name)) {
      const result: ToolResult = {
        success: false,
        output: '',
        error: `Tool "${name}" is not allowed in the current mode. Allowed: ${policy.allowedTools.join(', ')}`,
      };
      context.emit({ type: 'toolCallFailed', data: { tool: name, args, error: result.error } });
      return result;
    }

    // Policy enforcement: block terminal if not allowed
    if (policy && name === 'run_command' && !policy.terminalAllowed) {
      const result: ToolResult = {
        success: false,
        output: '',
        error: 'Terminal access is not allowed in the current mode.',
      };
      context.emit({ type: 'toolCallFailed', data: { tool: name, args, error: result.error } });
      return result;
    }

    const tool = this.tools.get(name);
    if (!tool) {
      const result: ToolResult = {
        success: false,
        output: '',
        error: `Tool "${name}" not found. Available: ${this.getToolNames().join(', ')}`,
      };
      context.emit({ type: 'toolCallFailed', data: { tool: name, args, error: result.error } });
      return result;
    }

    // Approval enforcement: require user confirmation unless explicitly opted out. Routed
    // through the context's HumanChannel so the request is attributed to this agent and (for
    // sub-agents) queued rather than firing an anonymous modal.
    const needsApproval = policy?.requireApproval?.[name] !== false
      && (name === 'write_file' || name === 'edit_file' || name === 'run_command');

    if (needsApproval && !this.sessionApprovedTools.has(`${name}:${JSON.stringify(args)}`)) {
      this.auditLogger?.log('approval_prompt', { tool: name, args });

      const summary = summarizeToolArgs(name, args);
      const decision = await context.human.approve({
        ref: context.ref,
        prompt: `Crucible wants to ${name}: ${summary}`,
      });

      this.auditLogger?.log('approval_result', { tool: name, args, allowed: decision.allowed });

      if (!decision.allowed) {
        const result: ToolResult = {
          success: false,
          output: '',
          error: 'User denied tool execution',
        };
        context.emit({ type: 'toolCallFailed', data: { tool: name, args, error: result.error } });
        return result;
      }

      if (decision.remember) {
        this.sessionApprovedTools.add(`${name}:${JSON.stringify(args)}`);
      }

      // TerminalTool re-checks permissions downstream. Record the approval we just obtained so
      // the user isn't prompted twice for the same command.
      if (name === 'run_command' && typeof args.command === 'string') {
        this.permissions?.approveForSession(args.command);
      }
    }

    context.emit({ type: 'toolCallStarted', data: { tool: name, args } });
    this.auditLogger?.log('tool_call_start', { tool: name, args });
    const startTime = Date.now();

    try {
      const timeout = tool.timeout ?? 60_000;
      const result = await Promise.race([
        tool.execute(args, context),
        new Promise<ToolResult>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool "${name}" timed out after ${timeout}ms`)), timeout),
        ),
      ]);
      const duration_ms = Date.now() - startTime;

      if (result.success) {
        context.emit({ type: 'toolCallCompleted', data: { tool: name, args, result, duration_ms } });
        this.auditLogger?.log('tool_call_end', { tool: name, args, success: true, output: result.output, duration_ms });
      } else {
        context.emit({ type: 'toolCallFailed', data: { tool: name, args, error: result.error, duration_ms } });
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
      context.emit({ type: 'toolCallFailed', data: { tool: name, args, error: err.message, duration_ms } });
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
