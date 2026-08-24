import type { AgentTool, ToolResult, ToolContext } from './types';
import type { AgentRegistry } from '../agent/registry';
import type { SubAgentSupervisor, SubAgentSpec } from '../contracts/supervisor';
import type { SubAgentResult } from '../agent/runner';

interface TaskSpec {
  agent_type: string;
  prompt: string;
  description: string;
}

export class TaskTool implements AgentTool {
  name = 'spawn_agent';
  description = `Launch specialized sub-agent(s) to handle work autonomously, in parallel.

When to use:
- Complex multi-step research or exploration tasks
- When you need to search the codebase thoroughly
- When you want to parallelize independent units of work

Parameters (single agent):
- agent_type: The type of sub-agent to use (see available types below)
- prompt: Detailed task description for the sub-agent
- description: A short (3-5 word) summary of the task

Parameters (parallel batch): pass "tasks" as an array of { agent_type, prompt, description }
objects to launch several sub-agents at once; they run concurrently and you receive all
results together.

Each sub-agent runs in isolation with its own conversation context and restricted tool access.
You receive only the final text result(s).`;

  parameters: Record<string, unknown> = {
    type: 'object',
    properties: {
      agent_type: { type: 'string', description: 'The sub-agent type to use' },
      prompt: { type: 'string', description: 'Detailed task for the sub-agent to perform' },
      description: { type: 'string', description: 'Short (3-5 word) summary of the task' },
      tasks: {
        type: 'array',
        description: 'Optional batch of tasks to run in parallel; each { agent_type, prompt, description }',
        items: {
          type: 'object',
          properties: {
            agent_type: { type: 'string' },
            prompt: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['agent_type', 'prompt'],
        },
      },
    },
  };

  timeout = 600_000;

  constructor(
    private supervisor: SubAgentSupervisor,
    private agentRegistry: AgentRegistry,
  ) {}

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const tasks = this.parseTasks(args);
    if (tasks.length === 0) {
      return { success: false, output: '', error: 'Missing required parameters: agent_type and prompt (or a non-empty tasks array)' };
    }

    // Validate every task up front — one bad agent_type fails the whole call, so the model
    // gets a clear error instead of partial spawns.
    for (const t of tasks) {
      if (!t.agent_type || !t.prompt) {
        return { success: false, output: '', error: 'Each task requires agent_type and prompt' };
      }
      const profile = this.agentRegistry.get(t.agent_type);
      if (!profile) {
        const available = this.agentRegistry.listSubagents().map((p) => p.name).join(', ');
        return { success: false, output: '', error: `Unknown agent type: "${t.agent_type}". Available: ${available}` };
      }
      if (profile.mode !== 'subagent') {
        return { success: false, output: '', error: `Agent "${t.agent_type}" is not a sub-agent type and cannot be spawned.` };
      }
    }

    const specs: SubAgentSpec[] = tasks.map((t) => ({
      agentType: t.agent_type,
      prompt: t.prompt,
      description: t.description,
      parentAgentId: ctx.agentId,
    }));

    let results: SubAgentResult[];
    try {
      const handles = this.supervisor.spawnMany(ctx.runId, specs);
      results = await Promise.all(handles.map((h) => h.result));
    } catch (err: any) {
      return { success: false, output: '', error: `Sub-agent execution failed: ${err.message}` };
    }

    const blocks = results.map((r, i) => this.formatResult(r, tasks[i].description));

    // A batch succeeds if every agent succeeded; report failures inline either way.
    const allOk = results.every((r) => r.success);
    return {
      success: allOk,
      output: blocks.join('\n\n'),
      error: allOk ? undefined : 'One or more sub-agents failed; see results.',
    };
  }

  private parseTasks(args: Record<string, unknown>): TaskSpec[] {
    if (Array.isArray(args.tasks) && args.tasks.length > 0) {
      return (args.tasks as any[]).map((t) => ({
        agent_type: t?.agent_type,
        prompt: t?.prompt,
        description: t?.description ?? '',
      }));
    }
    if (args.agent_type || args.prompt) {
      return [{
        agent_type: args.agent_type as string,
        prompt: args.prompt as string,
        description: (args.description as string) ?? '',
      }];
    }
    return [];
  }

  private formatResult(result: SubAgentResult, description: string): string {
    if (!result.success) {
      return [
        `task_id: ${result.sessionId}`,
        `agent: ${result.agentName}`,
        `description: ${description}`,
        `status: failed`,
        `error: ${result.error ?? 'Sub-agent failed without error message'}`,
      ].join('\n');
    }
    return [
      `task_id: ${result.sessionId}`,
      `agent: ${result.agentName}`,
      `description: ${description}`,
      '',
      '<task_result>',
      result.output,
      '</task_result>',
    ].join('\n');
  }
}
