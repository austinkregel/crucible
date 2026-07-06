import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolRunner } from '../runner';
import { ASK_POLICY, createAgentPolicy } from '../policies';
import type { AgentTool, ToolResult } from '../types';

function makeMockTool(name: string): AgentTool {
  return {
    name,
    description: `Mock ${name}`,
    parameters: {},
    execute: vi.fn().mockResolvedValue({ success: true, output: 'ok' }),
  };
}

describe('ToolRunner policy enforcement', () => {
  let runner: ToolRunner;

  beforeEach(() => {
    runner = new ToolRunner();
    runner.register(makeMockTool('read_file'));
    runner.register(makeMockTool('write_file'));
    runner.register(makeMockTool('edit_file'));
    runner.register(makeMockTool('list_files'));
    runner.register(makeMockTool('search_code'));
    runner.register(makeMockTool('run_command'));
  });

  it('allows all tools when no policy is set', async () => {
    const result = await runner.executeTool('write_file', { path: 'test.txt', content: 'hi' });
    expect(result.success).toBe(true);
  });

  describe('with ASK_POLICY', () => {
    beforeEach(() => {
      runner.setPolicy(ASK_POLICY);
    });

    it('allows read_file', async () => {
      const result = await runner.executeTool('read_file', { path: 'foo.ts' });
      expect(result.success).toBe(true);
    });

    it('allows list_files', async () => {
      const result = await runner.executeTool('list_files', {});
      expect(result.success).toBe(true);
    });

    it('allows search_code', async () => {
      const result = await runner.executeTool('search_code', { pattern: 'foo' });
      expect(result.success).toBe(true);
    });

    it('blocks write_file', async () => {
      const result = await runner.executeTool('write_file', { path: 'test.txt', content: 'hi' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not allowed');
    });

    it('blocks edit_file', async () => {
      const result = await runner.executeTool('edit_file', { path: 'test.txt' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not allowed');
    });

    it('blocks run_command', async () => {
      const result = await runner.executeTool('run_command', { command: 'ls' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not allowed');
    });

    it('emits toolCallFailed event when tool is blocked', async () => {
      const onEvent = vi.fn();
      await runner.executeTool('write_file', { path: 'x' }, onEvent);
      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'toolCallFailed' }),
      );
    });
  });

  describe('with agent policy', () => {
    beforeEach(() => {
      runner.setPolicy(createAgentPolicy('/workspace'));
    });

    it('allows write_file', async () => {
      const result = await runner.executeTool('write_file', { path: 'test.txt', content: 'hi' });
      expect(result.success).toBe(true);
    });

    it('allows run_command', async () => {
      const result = await runner.executeTool('run_command', { command: 'ls' });
      expect(result.success).toBe(true);
    });
  });

  describe('setPolicy / getPolicy', () => {
    it('getPolicy returns null when no policy set', () => {
      expect(runner.getPolicy()).toBeNull();
    });

    it('setPolicy stores and getPolicy retrieves it', () => {
      runner.setPolicy(ASK_POLICY);
      expect(runner.getPolicy()).toBe(ASK_POLICY);
    });
  });

  describe('terminal policy enforcement', () => {
    it('blocks run_command when terminalAllowed is false even if in allowedTools', async () => {
      runner.setPolicy({
        allowedTools: ['read_file', 'run_command'],
        terminalAllowed: false,
      });
      const onEvent = vi.fn();
      const result = await runner.executeTool('run_command', { command: 'ls' }, onEvent);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Terminal access is not allowed');
      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'toolCallFailed' }),
      );
    });
  });

  describe('getToolDefinitions respects policy', () => {
    it('returns all tools when no policy is set', () => {
      const defs = runner.getToolDefinitions();
      expect(defs).toHaveLength(6);
    });

    it('filters to allowed tools when policy is set', () => {
      runner.setPolicy(ASK_POLICY);
      const defs = runner.getToolDefinitions();
      const names = defs.map((d) => d.function.name);
      expect(names).toEqual(['read_file', 'list_files', 'search_code']);
    });
  });
});
