import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolRunner } from '../runner';
import type { AgentTool, ToolResult } from '../types';
import type { OrchestratorEventHandler } from '../../orchestrator/types';

function makeMockTool(name: string, result?: ToolResult): AgentTool {
  return {
    name,
    description: `Mock ${name} tool`,
    parameters: { type: 'object', properties: {} },
    execute: vi.fn().mockResolvedValue(result ?? { success: true, output: 'ok' }),
  };
}

describe('ToolRunner', () => {
  let runner: ToolRunner;
  let events: Array<{ type: string; data: any }>;
  let onEvent: OrchestratorEventHandler;

  beforeEach(() => {
    events = [];
    onEvent = (event) => events.push(event);
    runner = new ToolRunner();
  });

  describe('tool registration', () => {
    it('registers a tool and retrieves it by name', () => {
      const tool = makeMockTool('read_file');
      runner.register(tool);
      expect(runner.getTool('read_file')).toBe(tool);
    });

    it('returns undefined for unregistered tools', () => {
      expect(runner.getTool('nonexistent')).toBeUndefined();
    });

    it('lists all registered tool names', () => {
      runner.register(makeMockTool('read_file'));
      runner.register(makeMockTool('write_file'));
      runner.register(makeMockTool('search_code'));
      expect(runner.getToolNames()).toEqual(['read_file', 'write_file', 'search_code']);
    });
  });

  describe('registerBuiltins', () => {
    it('registers all built-in tools', () => {
      runner.registerBuiltins();
      const names = runner.getToolNames();
      expect(names).toContain('read_file');
      expect(names).toContain('write_file');
      expect(names).toContain('edit_file');
      expect(names).toContain('search_code');
      expect(names).toContain('run_command');
      expect(names).toContain('list_files');
    });
  });

  describe('getToolDefinitions', () => {
    it('returns OpenAI-compatible function schemas for all tools', () => {
      runner.register(makeMockTool('read_file'));
      const defs = runner.getToolDefinitions();
      expect(defs).toHaveLength(1);
      expect(defs[0]).toEqual({
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Mock read_file tool',
          parameters: { type: 'object', properties: {} },
        },
      });
    });
  });

  describe('executeTool', () => {
    it('calls the correct tool implementation', async () => {
      const tool = makeMockTool('read_file', { success: true, output: 'file content' });
      runner.register(tool);

      const result = await runner.executeTool('read_file', { path: 'foo.ts' }, onEvent);
      expect(tool.execute).toHaveBeenCalledWith({ path: 'foo.ts' });
      expect(result.success).toBe(true);
      expect(result.output).toBe('file content');
    });

    it('emits toolCallStarted before execution', async () => {
      const tool = makeMockTool('read_file');
      let emittedBeforeExecute = false;

      (tool.execute as any).mockImplementation(async () => {
        emittedBeforeExecute = events.some((e) => e.type === 'toolCallStarted');
        return { success: true, output: 'ok' };
      });

      runner.register(tool);
      await runner.executeTool('read_file', { path: 'a.ts' }, onEvent);

      expect(emittedBeforeExecute).toBe(true);
      expect(events[0]).toMatchObject({
        type: 'toolCallStarted',
        data: { tool: 'read_file', args: { path: 'a.ts' } },
      });
    });

    it('emits toolCallCompleted with result after success', async () => {
      const tool = makeMockTool('read_file', { success: true, output: 'content' });
      runner.register(tool);

      await runner.executeTool('read_file', { path: 'a.ts' }, onEvent);

      const completed = events.find((e) => e.type === 'toolCallCompleted');
      expect(completed).toBeDefined();
      expect(completed!.data.tool).toBe('read_file');
      expect(completed!.data.result.success).toBe(true);
      expect(completed!.data.result.output).toBe('content');
    });

    it('emits toolCallFailed with error on failure', async () => {
      const tool = makeMockTool('read_file');
      (tool.execute as any).mockRejectedValue(new Error('disk error'));
      runner.register(tool);

      const result = await runner.executeTool('read_file', { path: 'a.ts' }, onEvent);

      expect(result.success).toBe(false);
      expect(result.error).toBe('disk error');

      const failed = events.find((e) => e.type === 'toolCallFailed');
      expect(failed).toBeDefined();
      expect(failed!.data.tool).toBe('read_file');
      expect(failed!.data.error).toBe('disk error');
    });

    it('emits toolCallFailed when tool returns success:false', async () => {
      const tool = makeMockTool('read_file', {
        success: false,
        output: '',
        error: 'File not found',
      });
      runner.register(tool);

      const result = await runner.executeTool('read_file', { path: 'nope.ts' }, onEvent);
      expect(result.success).toBe(false);

      const failed = events.find((e) => e.type === 'toolCallFailed');
      expect(failed).toBeDefined();
      expect(failed!.data.error).toBe('File not found');
    });

    it('rejects unknown tool names with descriptive error', async () => {
      const result = await runner.executeTool('nonexistent_tool', {}, onEvent);
      expect(result.success).toBe(false);
      expect(result.error).toContain('nonexistent_tool');
      expect(result.error).toContain('not found');
    });

    it('includes duration_ms in completed/failed events', async () => {
      const tool = makeMockTool('read_file', { success: true, output: 'ok' });
      runner.register(tool);

      await runner.executeTool('read_file', {}, onEvent);

      const completed = events.find((e) => e.type === 'toolCallCompleted');
      expect(completed!.data).toHaveProperty('duration_ms');
      expect(typeof completed!.data.duration_ms).toBe('number');
    });

    it('works without an event handler', async () => {
      const tool = makeMockTool('read_file', { success: true, output: 'ok' });
      runner.register(tool);

      const result = await runner.executeTool('read_file', { path: 'a.ts' });
      expect(result.success).toBe(true);
    });
  });
});
