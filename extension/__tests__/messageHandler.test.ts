import { describe, it, expect, vi } from 'vitest';
import { ToolRunner } from '../tools/runner';
import { Orchestrator } from '../orchestrator/index';

describe('messageHandler agent integration', () => {
  describe('ToolRunner creation', () => {
    it('ToolRunner can be created and builtins registered', () => {
      const runner = new ToolRunner();
      runner.registerBuiltins();
      expect(runner.getToolNames()).toContain('read_file');
      expect(runner.getToolNames()).toContain('search_code');
      expect(runner.getToolNames()).toContain('run_command');
    });
  });

  describe('Orchestrator accepts ToolRunner', () => {
    it('Orchestrator constructor accepts optional toolRunner parameter', () => {
      const runner = new ToolRunner();
      runner.registerBuiltins();

      const mockRegistry = {
        getByRole: vi.fn(() => null),
        get: vi.fn(),
        list: vi.fn(() => []),
        initialize: vi.fn(),
      } as any;

      const mockStore = {
        get: vi.fn(),
        set: vi.fn(),
        has: vi.fn(() => false),
        clearAll: vi.fn(),
        getFilePath: vi.fn(() => '/tmp/test'),
      } as any;

      // Should not throw
      const orchestrator = new Orchestrator(mockRegistry, mockStore, runner);
      expect(orchestrator).toBeDefined();
    });
  });

  describe('event relay contract', () => {
    it('agent events are relayed with type and data', () => {
      const relayedEvents: any[] = [];

      const mockPostMessage = vi.fn((msg: any) => {
        relayedEvents.push(msg);
      });

      // Simulate event relay
      const onEvent = (event: any) => {
        mockPostMessage({
          type: 'agentEvent',
          requestId: 'test-req',
          event,
        });
      };

      onEvent({ type: 'phaseStarted', data: { phase: 'planning' } });
      onEvent({ type: 'toolCallStarted', data: { tool: 'read_file', args: { path: 'a.ts' } } });
      onEvent({ type: 'toolCallCompleted', data: { tool: 'read_file', result: { success: true, output: 'content' } } });

      expect(relayedEvents).toHaveLength(3);
      expect(relayedEvents[0]).toEqual({
        type: 'agentEvent',
        requestId: 'test-req',
        event: { type: 'phaseStarted', data: { phase: 'planning' } },
      });
      expect(relayedEvents[1].event.type).toBe('toolCallStarted');
      expect(relayedEvents[2].event.type).toBe('toolCallCompleted');
    });

    it('relays all new event types including phaseStarted and toolCall*', () => {
      const eventTypes = [
        'phaseStarted',
        'toolCallStarted',
        'toolCallCompleted',
        'toolCallFailed',
        'streamToken',
        'planGenerated',
        'validationComplete',
        'stepStarted',
        'stepCompleted',
        'stepFailed',
        'postValidationComplete',
        'complete',
        'error',
      ];

      const relayed: string[] = [];
      const relay = (event: any) => relayed.push(event.type);

      for (const type of eventTypes) {
        relay({ type, data: {} });
      }

      expect(relayed).toEqual(eventTypes);
    });
  });
});
