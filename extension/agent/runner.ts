import type { AgentProfile } from './registry';
import type { AgentRegistry } from './registry';
import type { LLMProvider, ChatMessage } from '../providers/types';
import type { ToolRunner } from '../tools/runner';
import type { OrchestratorEventHandler } from '../orchestrator/types';
import type { AuditLogger } from '../audit/logger';
import { pruneToolOutputs } from '../session/compaction';

const MAX_SUBAGENT_ITERATIONS = 20;

export interface SubAgentResult {
  sessionId: string;
  agentName: string;
  output: string;
  messages: ChatMessage[];
  success: boolean;
  error?: string;
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
  ): Promise<SubAgentResult> {
    const profile = this.agentRegistry.get(agentName);
    if (!profile) {
      return {
        sessionId: generateId(),
        agentName,
        output: '',
        messages: [],
        success: false,
        error: `Unknown agent type: "${agentName}". Available: ${this.agentRegistry.listSubagents().map((p) => p.name).join(', ')}`,
      };
    }

    const sessionId = generateId();
    this.auditLogger?.log('subagent_start', { sessionId, agentName, prompt: prompt.slice(0, 200) });

    const originalPolicy = this.toolRunner.getPolicy();
    this.toolRunner.setPolicy(profile.policy);

    try {
      const result = await this.executeLoop(profile, prompt, provider, model, sessionId, onEvent, signal);
      this.auditLogger?.log('subagent_end', {
        sessionId,
        agentName,
        success: result.success,
        outputLength: result.output.length,
      });
      return result;
    } finally {
      if (originalPolicy) {
        this.toolRunner.setPolicy(originalPolicy);
      }
    }
  }

  async runConcurrent(
    tasks: Array<{ agentName: string; prompt: string; description: string }>,
    provider: LLMProvider,
    model: string,
    onEvent?: OrchestratorEventHandler,
    signal?: AbortSignal,
  ): Promise<SubAgentResult[]> {
    return Promise.all(
      tasks.map((task) =>
        this.run(task.agentName, task.prompt, provider, model, onEvent, signal),
      ),
    );
  }

  private async executeLoop(
    profile: AgentProfile,
    prompt: string,
    provider: LLMProvider,
    model: string,
    sessionId: string,
    onEvent?: OrchestratorEventHandler,
    signal?: AbortSignal,
  ): Promise<SubAgentResult> {
    const validToolNames = new Set(profile.allowedTools);
    const toolDefs = this.toolRunner.getToolDefinitions()
      .filter((t) => validToolNames.has(t.function.name));

    const toolInstructions = toolDefs.length > 0
      ? `\n\nYou have tools available. To call a tool, wrap the call in XML tags:\n<tool_call>\n{"name": "tool_name", "arguments": {"arg": "value"}}\n</tool_call>\n\nAvailable tools: ${toolDefs.map((t) => t.function.name).join(', ')}`
      : '';

    const messages: ChatMessage[] = [
      { role: 'system', content: profile.systemPrompt + toolInstructions },
      { role: 'user', content: prompt },
    ];

    let iteration = 0;
    let lastResponse = '';

    while (iteration < MAX_SUBAGENT_ITERATIONS) {
      if (signal?.aborted) break;
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

      const toolCalls = parseToolCalls(fullResponse, validToolNames);
      if (toolCalls.length === 0 || toolDefs.length === 0) break;

      messages.push({ role: 'assistant', content: fullResponse });

      for (const call of toolCalls) {
        if (signal?.aborted) break;
        onEvent?.({ type: 'toolCallStarted', data: { tool: call.name, args: call.arguments, agent: profile.name } });
        const result = await this.toolRunner.executeTool(call.name, call.arguments, onEvent);
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

interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

function parseToolCalls(response: string, validToolNames: Set<string>): ParsedToolCall[] {
  const calls: ParsedToolCall[] = [];
  const pattern = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let match;

  while ((match = pattern.exec(response)) !== null) {
    const raw = match[1].trim();
    if (raw.length > 512_000) continue;

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    if (!parsed.name || typeof parsed.name !== 'string') continue;
    if (!validToolNames.has(parsed.name)) continue;

    calls.push({ name: parsed.name, arguments: parsed.arguments || {} });
  }

  return calls;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}
