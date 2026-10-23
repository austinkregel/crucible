import { describe, it, expect, vi } from 'vitest';
import { SubAgentRunner } from '../runner';
import { DefaultBudgetTracker } from '../budgetTracker';
import { asAgentId, asRunId, type AgentRef } from '../../contracts/ids';

/**
 * A profile whose only tool is read_file, matching the mock ToolRunner below. The runner's
 * executeLoop filters tool defs by `allowedTools` and parses tool calls against the same set.
 */
function makeRegistry() {
  return {
    get: vi.fn(() => ({
      name: 'general',
      description: 'general purpose',
      mode: 'subagent',
      systemPrompt: 'x',
      allowedTools: ['read_file'],
      policy: { allowedTools: ['read_file'], terminalAllowed: false },
    })),
    listSubagents: () => [{ name: 'general' }],
  };
}

/** A ToolRunner that always exposes read_file and always succeeds. */
function makeToolRunner() {
  return {
    getToolDefinitions: () => [
      { type: 'function', function: { name: 'read_file', description: '', parameters: {} } },
    ],
    executeTool: vi.fn(async () => ({ success: true, output: 'ok' })),
  };
}

/**
 * A provider that NEVER stops on its own: every turn yields a well-formed tool call, so the
 * only thing that can end the loop is the budget (test 1) or the fixed fallback cap (test 2).
 */
function makeProvider() {
  const streamChat = vi.fn(async function* () {
    yield '<tool_call>\n{"name":"read_file","arguments":{}}\n</tool_call>';
  });
  return { streamChat } as any;
}

function makeRef(): AgentRef {
  return { runId: asRunId('r'), agentId: asAgentId('a'), agentType: 'general' };
}

describe('SubAgentRunner budget enforcement', () => {
  it('stops the loop once the injected budget is exhausted', async () => {
    const registry = makeRegistry();
    const toolRunner = makeToolRunner();
    const provider = makeProvider();
    const runner = new SubAgentRunner(registry as any, toolRunner as any);

    const budget = new DefaultBudgetTracker(makeRef(), { maxIterations: 2 });

    const result = await runner.run('general', 'go', provider, 'm', undefined, undefined, { budget });

    // Without the budget this provider would loop forever; a small call count proves the
    // budget — not the provider — terminated it.
    expect(provider.streamChat.mock.calls.length).toBeLessThanOrEqual(3);
    expect(provider.streamChat.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(result).toBeDefined();
  });

  it('still terminates without a budget by falling back to the fixed cap', async () => {
    const registry = makeRegistry();
    const toolRunner = makeToolRunner();
    const provider = makeProvider();
    const runner = new SubAgentRunner(registry as any, toolRunner as any);

    const result = await runner.run('general', 'go', provider, 'm');

    // MAX_SUBAGENT_ITERATIONS = 20: an always-tool-calling provider stops at the cap, not hangs.
    expect(provider.streamChat.mock.calls.length).toBe(20);
    expect(result.success).toBe(true);
  });
});
