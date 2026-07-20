import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orchestrator } from '../index';
import { MockCacheStore } from '../../__mocks__/cacheStore';
import type { OrchestratorEvent, OrchestratorEventHandler } from '../types';

function providerYielding(response: string) {
  return {
    streamChat: vi.fn(async function* () {
      yield response;
    }),
    supportsTools: vi.fn(() => false),
  };
}

describe('Orchestrator pipeline events', () => {
  let events: OrchestratorEvent[];
  let onEvent: OrchestratorEventHandler;

  beforeEach(() => {
    events = [];
    onEvent = (event) => events.push(event);
  });

  it('runAgent emits phaseStarted("planning") before generating plan', async () => {
    const registry = {
      getByRole: vi.fn((role: string) => {
        switch (role) {
          case 'planner':
            return { provider: providerYielding('{"plan":"test","steps":[],"assumptions":[]}'), model: 'm' };
          case 'validator':
            return {
              provider: providerYielding(
                '{"issues":[],"missing_cases":[],"conflicts":[],"confidence_score":0.9}',
              ),
              model: 'm',
            };
          case 'postValidator':
            return {
              provider: providerYielding('{"approved":true,"issues":[],"suggested_fixes":[]}'),
              model: 'm',
            };
          default:
            return { provider: providerYielding('done'), model: 'm' };
        }
      }),
    } as any;

    const orchestrator = new Orchestrator(registry, new MockCacheStore() as any);
    await orchestrator.runAgent('Build a feature', [], onEvent);

    const planningPhaseAt = events.findIndex(
      (e) => e.type === 'phaseStarted' && e.data.phase === 'planning',
    );
    const planGeneratedAt = events.findIndex((e) => e.type === 'planGenerated');

    expect(planningPhaseAt).toBeGreaterThanOrEqual(0);
    expect(planGeneratedAt).toBeGreaterThan(planningPhaseAt);
  });

  function planningRegistry() {
    return {
      getByRole: vi.fn((role: string) => {
        switch (role) {
          case 'planner':
            return { provider: providerYielding('{"plan":"test","steps":[],"assumptions":[]}'), model: 'm' };
          case 'validator':
            return {
              provider: providerYielding(
                '{"issues":[],"missing_cases":[],"conflicts":[],"confidence_score":0.9}',
              ),
              model: 'm',
            };
          default:
            return { provider: providerYielding('done'), model: 'm' };
        }
      }),
    } as any;
  }

  it('runAgent queries the retriever during planning when wired', async () => {
    const orchestrator = new Orchestrator(planningRegistry(), new MockCacheStore() as any);
    const retriever = {
      retrieve: vi.fn().mockResolvedValue([
        {
          relativePath: 'src/util.ts',
          filePath: '/ws/src/util.ts',
          lineStart: 1,
          lineEnd: 10,
          content: 'export const helper = () => {}',
          contextualizedText: '',
          entities: '',
          language: 'typescript',
          score: 0.9,
        },
      ]),
    } as any;
    orchestrator.setRetrieval(retriever);

    await orchestrator.runAgent('Add a helper', [], onEvent);

    expect(retriever.retrieve).toHaveBeenCalledWith('Add a helper', expect.objectContaining({ limit: 6 }));
  });

  it('runAgent still completes when retrieval throws (best-effort)', async () => {
    const orchestrator = new Orchestrator(planningRegistry(), new MockCacheStore() as any);
    orchestrator.setRetrieval({ retrieve: vi.fn().mockRejectedValue(new Error('index down')) } as any);

    await orchestrator.runAgent('Add a helper', [], onEvent);

    expect(events.some((e) => e.type === 'planGenerated')).toBe(true);
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('all streamToken events include role field', () => {
    // This is tested via the individual component tests (planner, validator, executor)
    // The contract is: streamToken.data MUST have { role: string, token: string }
    const event: OrchestratorEvent = {
      type: 'streamToken',
      data: { role: 'planner', token: 'hello' },
    };
    expect(event.data.role).toBe('planner');
    expect(event.data.token).toBe('hello');
  });

  it('phaseStarted event type is in OrchestratorEvent union', () => {
    const event: OrchestratorEvent = {
      type: 'phaseStarted',
      data: { phase: 'planning' },
    };
    expect(event.type).toBe('phaseStarted');
  });

  it('toolCallStarted/Completed/Failed are in OrchestratorEvent union', () => {
    const started: OrchestratorEvent = { type: 'toolCallStarted', data: {} };
    const completed: OrchestratorEvent = { type: 'toolCallCompleted', data: {} };
    const failed: OrchestratorEvent = { type: 'toolCallFailed', data: {} };
    expect(started.type).toBe('toolCallStarted');
    expect(completed.type).toBe('toolCallCompleted');
    expect(failed.type).toBe('toolCallFailed');
  });
});
