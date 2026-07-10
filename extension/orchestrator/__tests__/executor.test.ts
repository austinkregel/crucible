import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Executor } from '../executor';
import type { ToolRunner } from '../../tools/runner';
import type { OrchestratorEventHandler, PlanStep, OrchestratorEvent } from '../types';

function makeStep(overrides?: Partial<PlanStep>): PlanStep {
  return {
    id: 'step_1',
    goal: 'Read the auth module',
    files: ['src/auth.ts'],
    risks: [],
    constraints: [],
    status: 'pending',
    ...overrides,
  };
}

function makeMockProvider(responses: string[]) {
  let callIndex = 0;
  return {
    streamChat: vi.fn(async function* () {
      const response = responses[callIndex++] || '';
      yield response;
    }),
    supportsTools: vi.fn(() => true),
  };
}

function makeMockRegistry(provider: any) {
  return {
    getByRole: vi.fn(() => ({
      provider,
      model: 'test-model',
    })),
  } as any;
}

function makeMockToolRunner() {
  return {
    getToolDefinitions: vi.fn(() => [
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
      },
    ]),
    executeTool: vi.fn(async (_name: string, _args: any, _onEvent?: any) => ({
      success: true,
      output: 'file contents here',
    })),
  } as unknown as ToolRunner;
}

function makeMockCompiler() {
  return {
    compileForExecutor: vi.fn(() => ({
      systemPrefix: 'You are an executor.',
      userMessage: 'Do the thing.',
    })),
  } as any;
}

describe('Executor', () => {
  let events: OrchestratorEvent[];
  let onEvent: OrchestratorEventHandler;

  beforeEach(() => {
    events = [];
    onEvent = (event) => events.push(event);
  });

  describe('executeStep with tool-calling loop', () => {
    it('sends tool definitions to LLM via chat', async () => {
      const provider = makeMockProvider(['I will read the file.\n\nNo more tool calls needed.']);
      const registry = makeMockRegistry(provider);
      const toolRunner = makeMockToolRunner();
      const compiler = makeMockCompiler();
      const executor = new Executor(registry, compiler, toolRunner);

      await executor.executeStep(makeStep(), 'relevant code', onEvent);

      expect(provider.streamChat).toHaveBeenCalled();
      const callArgs = (provider.streamChat.mock.calls as any[][])[0];
      expect(callArgs[1]).toHaveProperty('tools');
    });

    it('parses tool_call blocks from LLM response and executes them', async () => {
      const toolCallResponse = `I need to read the file first.

<tool_call>
{"name": "read_file", "arguments": {"path": "src/auth.ts"}}
</tool_call>`;
      const finalResponse = 'The auth module contains...';

      const provider = makeMockProvider([toolCallResponse, finalResponse]);
      const registry = makeMockRegistry(provider);
      const toolRunner = makeMockToolRunner();
      const compiler = makeMockCompiler();
      const executor = new Executor(registry, compiler, toolRunner);

      await executor.executeStep(makeStep(), 'relevant code', onEvent);

      expect(toolRunner.executeTool).toHaveBeenCalledWith(
        'read_file',
        { path: 'src/auth.ts' },
        onEvent,
      );
    });

    it('feeds tool results back to LLM as tool messages', async () => {
      const toolCallResponse = `<tool_call>
{"name": "read_file", "arguments": {"path": "src/auth.ts"}}
</tool_call>`;
      const finalResponse = 'Done.';

      const provider = makeMockProvider([toolCallResponse, finalResponse]);
      const registry = makeMockRegistry(provider);
      const toolRunner = makeMockToolRunner();
      const compiler = makeMockCompiler();
      const executor = new Executor(registry, compiler, toolRunner);

      await executor.executeStep(makeStep(), 'relevant code', onEvent);

      // Second call should include tool result message
      expect(provider.streamChat.mock.calls.length).toBeGreaterThanOrEqual(2);
      const secondCallMessages = (provider.streamChat.mock.calls as any[][])[1]?.[0];
      const toolMessage = secondCallMessages?.find((m: any) => m.role === 'tool');
      expect(toolMessage).toBeDefined();
      expect(toolMessage.content).toContain('file contents here');
    });

    it('loops until LLM responds without tool calls', async () => {
      const call1 = `<tool_call>
{"name": "read_file", "arguments": {"path": "a.ts"}}
</tool_call>`;
      const call2 = `<tool_call>
{"name": "read_file", "arguments": {"path": "b.ts"}}
</tool_call>`;
      const finalResponse = 'All done analyzing the code.';

      const provider = makeMockProvider([call1, call2, finalResponse]);
      const registry = makeMockRegistry(provider);
      const toolRunner = makeMockToolRunner();
      const compiler = makeMockCompiler();
      const executor = new Executor(registry, compiler, toolRunner);

      await executor.executeStep(makeStep(), 'relevant code', onEvent);

      expect(toolRunner.executeTool).toHaveBeenCalledTimes(2);
      expect(provider.streamChat).toHaveBeenCalledTimes(3);
    });

    it('caps iterations to prevent infinite loops', async () => {
      const infiniteToolCall = `<tool_call>
{"name": "read_file", "arguments": {"path": "loop.ts"}}
</tool_call>`;

      // Return tool calls for 20+ iterations
      const responses = Array(25).fill(infiniteToolCall);
      const provider = makeMockProvider(responses);
      const registry = makeMockRegistry(provider);
      const toolRunner = makeMockToolRunner();
      const compiler = makeMockCompiler();
      const executor = new Executor(registry, compiler, toolRunner);

      await executor.executeStep(makeStep(), 'relevant code', onEvent);

      // Should cap at maxIterations (default 15) not 25
      expect(provider.streamChat.mock.calls.length).toBeLessThanOrEqual(16);
    });

    it('returns result with success and filesChanged', async () => {
      const provider = makeMockProvider(['The analysis is complete.']);
      const registry = makeMockRegistry(provider);
      const toolRunner = makeMockToolRunner();
      const compiler = makeMockCompiler();
      const executor = new Executor(registry, compiler, toolRunner);

      const result = await executor.executeStep(makeStep(), 'relevant code', onEvent);

      expect(result).toHaveProperty('stepId', 'step_1');
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('filesChanged');
    });

    // Regression: success was computed as `anyToolSucceeded || filesChanged.length > 0`,
    // which conflates "made a change" with "succeeded". A read-only step that the
    // model answers without calling any tool is a legitimate success.
    it('reports success for a read-only step that calls no tools', async () => {
      const provider = makeMockProvider(['I inspected the module; no changes needed.']);
      const registry = makeMockRegistry(provider);
      const toolRunner = makeMockToolRunner();
      const compiler = makeMockCompiler();
      const executor = new Executor(registry, compiler, toolRunner);

      const result = await executor.executeStep(makeStep(), 'relevant code', onEvent);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(toolRunner.executeTool).not.toHaveBeenCalled();
    });

    // Regression: a runaway step that never converges was reported as success:true
    // purely because its tool calls happened to succeed before we cut it off.
    it('reports failure when the tool loop exhausts the iteration cap', async () => {
      const infiniteToolCall = `<tool_call>
{"name": "read_file", "arguments": {"path": "loop.ts"}}
</tool_call>`;
      const provider = makeMockProvider(Array(25).fill(infiniteToolCall));
      const registry = makeMockRegistry(provider);
      const toolRunner = makeMockToolRunner();
      const compiler = makeMockCompiler();
      const executor = new Executor(registry, compiler, toolRunner);

      const result = await executor.executeStep(makeStep(), 'relevant code', onEvent);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/iteration|converge/i);
    });
  });

  describe('parseToolCalls', () => {
    it('extracts multiple tool calls from a single response', async () => {
      const response = `Let me check both files.

<tool_call>
{"name": "read_file", "arguments": {"path": "a.ts"}}
</tool_call>

<tool_call>
{"name": "read_file", "arguments": {"path": "b.ts"}}
</tool_call>`;

      const provider = makeMockProvider([response, 'Done.']);
      const registry = makeMockRegistry(provider);
      const toolRunner = makeMockToolRunner();
      const compiler = makeMockCompiler();
      const executor = new Executor(registry, compiler, toolRunner);

      await executor.executeStep(makeStep(), '', onEvent);

      expect(toolRunner.executeTool).toHaveBeenCalledTimes(2);
    });
  });
});
