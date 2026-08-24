import type { AgentProfile } from './registry';
import type { AgentRegistry } from './registry';
import type { LLMProvider, ChatMessage } from '../providers/types';
import type { ToolRunner } from '../tools/runner';
import type { OrchestratorEventHandler } from '../orchestrator/types';
import type { AuditLogger } from '../audit/logger';
import { pruneToolOutputs } from '../session/compaction';
import { parseToolCalls } from '../tools/toolCallParser';
import { createToolContext } from '../tools/context';
import { nativeHumanChannel } from '../tools/nativeHuman';
import { asRunId, asAgentId, type AgentRef } from '../contracts/ids';
import type { HumanChannel } from '../contracts/broker';
import type { BudgetTracker } from '../contracts/budget';
import type { AgentEvent } from '../contracts/toolContext';

/** Fallback iteration cap when no budget is supplied (preserves the old ceiling). */
const MAX_SUBAGENT_ITERATIONS = 20;
/** Absolute backstop so an unbounded/misconfigured budget can never loop forever. */
const HARD_ITERATION_CEILING = 1000;

export interface SubAgentResult {
  sessionId: string;
  agentName: string;
  output: string;
  messages: ChatMessage[];
  success: boolean;
  error?: string;
}

/**
 * Injected by the supervisor to give a sub-agent its real identity, a broker-backed human
 * channel (so its questions queue and stay attributed), a per-agent budget, and a full
 * AgentEvent stream. All optional — bare run() falls back to a native-modal, unbudgeted,
 * self-identified agent (the path spawn_agent used before the supervisor existed).
 */
export interface RunAgentOptions {
  ref?: AgentRef;
  human?: HumanChannel;
  budget?: BudgetTracker;
  onAgentEvent?: (event: AgentEvent) => void;
}

export class SubAgentRunner {
  private auditLogger?: AuditLogger;

  constructor(
    private agentRegistry: AgentRegistry,
    private toolRunner: ToolRunner,
  ) {}

  setAuditLogger(logger: AuditLogger): void {
    this.auditLogger = logger;
  }

  async run(
    agentName: string,
    prompt: string,
    provider: LLMProvider,
    model: string,
    onEvent?: OrchestratorEventHandler,
    signal?: AbortSignal,
    options?: RunAgentOptions,
  ): Promise<SubAgentResult> {
    const profile = this.agentRegistry.get(agentName);
    if (!profile) {
      return {
        sessionId: options?.ref?.agentId ?? generateId(),
        agentName,
        output: '',
        messages: [],
        success: false,
        error: `Unknown agent type: "${agentName}". Available: ${this.agentRegistry.listSubagents().map((p) => p.name).join(', ')}`,
      };
    }

    const sessionId = options?.ref?.agentId ?? generateId();
    this.auditLogger?.log('subagent_start', { sessionId, agentName, prompt: prompt.slice(0, 200) });

    // No shared-policy swap. The sub-agent's policy travels in its own ToolContext (built in
    // executeLoop), so concurrent sub-agents can never clobber each other's policy or the
    // top-level agent's — the containment guarantee behind running sub-agents in parallel.
    const result = await this.executeLoop(profile, prompt, provider, model, sessionId, onEvent, signal, options);
    this.auditLogger?.log('subagent_end', {
      sessionId,
      agentName,
      success: result.success,
      outputLength: result.output.length,
    });
    return result;
  }

  private async executeLoop(
    profile: AgentProfile,
    prompt: string,
    provider: LLMProvider,
    model: string,
    sessionId: string,
    onEvent?: OrchestratorEventHandler,
    signal?: AbortSignal,
    options?: RunAgentOptions,
  ): Promise<SubAgentResult> {
    const validToolNames = new Set(profile.allowedTools);
    const toolDefs = this.toolRunner.getToolDefinitions(profile.policy)
      .filter((t) => validToolNames.has(t.function.name));

    const ref: AgentRef = options?.ref ?? {
      runId: asRunId(sessionId),
      agentId: asAgentId(sessionId),
      agentType: profile.name,
    };
    const budget = options?.budget;

    // This sub-agent's own tool context: its policy, its cancellation signal, its identity.
    // Never shared with other agents. Events fan out to both the full AgentEvent stream (for
    // the supervisor/UI, attributed via ref) and the legacy orchestrator bridge.
    const toolContext = createToolContext({
      ref,
      policy: profile.policy,
      signal: signal ?? new AbortController().signal,
      human: options?.human ?? nativeHumanChannel(),
      sink: (e) => {
        options?.onAgentEvent?.(e);
        onEvent?.({ type: e.type as any, data: e.data });
      },
    });

    const toolInstructions = toolDefs.length > 0
      ? `\n\nYou have tools available. To call a tool, wrap the call in XML tags:\n<tool_call>\n{"name": "tool_name", "arguments": {"arg": "value"}}\n</tool_call>\n\nAvailable tools: ${toolDefs.map((t) => t.function.name).join(', ')}`
      : '';

    const messages: ChatMessage[] = [
      { role: 'system', content: profile.systemPrompt + toolInstructions },
      { role: 'user', content: prompt },
    ];

    let iteration = 0;
    let lastResponse = '';

    while (iteration < HARD_ITERATION_CEILING) {
      if (signal?.aborted) break;
      // Budget governs termination when supplied; otherwise fall back to the fixed cap.
      // Check BEFORE charging so maxIterations:N permits exactly N iterations of work.
      if (budget) {
        if (budget.check().exhausted) break;
        budget.chargeIteration();
      } else if (iteration >= MAX_SUBAGENT_ITERATIONS) {
        break;
      }
      iteration++;

      const prunedMessages = pruneToolOutputs(messages);

      let fullResponse = '';
      try {
        for await (const token of provider.streamChat(prunedMessages, {
          model,
          temperature: profile.temperature ?? 0.1,
        })) {
          if (signal?.aborted) break;
          fullResponse += token;
          onEvent?.({
            type: 'streamToken',
            data: { role: 'subagent', token, agent: profile.name, sessionId },
          });
        }
      } catch (err: any) {
        return {
          sessionId,
          agentName: profile.name,
          output: lastResponse || `Error: ${err.message}`,
          messages,
          success: false,
          error: err.message,
        };
      }

      lastResponse = fullResponse;

      const toolCalls = parseToolCalls(fullResponse, validToolNames, this.auditLogger);
      if (toolCalls.length === 0 || toolDefs.length === 0) break;

      messages.push({ role: 'assistant', content: fullResponse });

      for (const call of toolCalls) {
        if (signal?.aborted) break;
        budget?.chargeToolCall();
        onEvent?.({ type: 'toolCallStarted', data: { tool: call.name, args: call.arguments, agent: profile.name } });
        const result = await this.toolRunner.executeTool(call.name, call.arguments, toolContext);
        messages.push({
          role: 'tool',
          content: result.success ? result.output : `Error: ${result.error}`,
          name: call.name,
        });
      }
    }

    return {
      sessionId,
      agentName: profile.name,
      output: lastResponse,
      messages,
      success: true,
    };
  }
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}
