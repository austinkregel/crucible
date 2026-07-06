import type { AgentTool, ToolResult } from './types';
import type { SubAgentRunner, SubAgentResult } from '../agent/runner';
import type { AgentRegistry } from '../agent/registry';
import type { LLMProvider } from '../providers/types';

export class TaskTool implements AgentTool {
  name = 'spawn_agent';
  description = `Launch a specialized sub-agent to handle a task autonomously.

When to use:
- Complex multi-step research or exploration tasks
- When you need to search the codebase thoroughly
- When you want to parallelize work

Parameters:
- agent_type: The type of sub-agent to use (see available types below)
- prompt: Detailed task description for the sub-agent
- description: A short (3-5 word) summary of the task

The sub-agent runs in isolation with its own conversation context and restricted tool access. You will receive only the final text result.`;

  parameters: Record<string, unknown> = {
    type: 'object',
    properties: {
      agent_type: {
        type: 'string',
        description: 'The sub-agent type to use',
      },
      prompt: {
        type: 'string',
        description: 'Detailed task for the sub-agent to perform',
      },
      description: {
        type: 'string',
        description: 'Short (3-5 word) summary of the task',
      },
    },
    required: ['agent_type', 'prompt', 'description'],
  };

  timeout = 300_000;

  private runner: SubAgentRunner;
  private agentRegistry: AgentRegistry;
  private getProvider: () => { provider: LLMProvider; model: string } | undefined;

  constructor(
    runner: SubAgentRunner,
    agentRegistry: AgentRegistry,
    getProvider: () => { provider: LLMProvider; model: string } | undefined,
  ) {
    this.runner = runner;
    this.agentRegistry = agentRegistry;
    this.getProvider = getProvider;

    const subagentDescs = agentRegistry.getSubagentDescriptions();
    if (subagentDescs) {
      this.description += `\n\nAvailable sub-agent types:\n${subagentDescs}`;
    }
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const agentType = args.agent_type as string;
    const prompt = args.prompt as string;
    const description = args.description as string;

    if (!agentType || !prompt) {
      return {
        success: false,
        output: '',
        error: 'Missing required parameters: agent_type and prompt',
      };
    }

    const profile = this.agentRegistry.get(agentType);
    if (!profile) {
      const available = this.agentRegistry.listSubagents().map((p) => p.name).join(', ');
      return {
        success: false,
        output: '',
        error: `Unknown agent type: "${agentType}". Available: ${available}`,
      };
    }

    if (profile.mode !== 'subagent') {
      return {
        success: false,
        output: '',
        error: `Agent "${agentType}" is not a sub-agent type and cannot be spawned.`,
      };
    }

    const config = this.getProvider();
    if (!config) {
      return {
        success: false,
        output: '',
        error: 'No LLM provider available for sub-agent execution.',
      };
    }

    let result: SubAgentResult;
    try {
      result = await this.runner.run(agentType, prompt, config.provider, config.model);
    } catch (err: any) {
      return {
        success: false,
        output: '',
        error: `Sub-agent execution failed: ${err.message}`,
      };
    }

    if (!result.success) {
      return {
        success: false,
        output: result.output || '',
        error: result.error || 'Sub-agent failed without error message',
      };
    }

    const output = [
      `task_id: ${result.sessionId}`,
      `agent: ${result.agentName}`,
      `description: ${description}`,
      '',
      '<task_result>',
      result.output,
      '</task_result>',
    ].join('\n');

    return { success: true, output };
  }
}
