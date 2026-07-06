import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Planner } from '../planner';
import { ContextCompiler } from '../../context/compiler';
import type { CollectedContext } from '../../context/collector';
import type { ProviderRegistry } from '../../providers/registry';
import type { OrchestratorEvent } from '../types';

function createMockStreamChat(tokens: string[]) {
  return async function* () {
    for (const t of tokens) yield t;
  };
}

function createMockRegistry(tokens: string[], role = 'planner'): ProviderRegistry {
  return {
    getByRole: vi.fn((r: string) => {
      if (r !== role) return undefined;
      return {
        provider: { streamChat: vi.fn(() => createMockStreamChat(tokens)()) },
        model: 'test-model',
      };
    }),
  } as any;
}

const emptyContext: CollectedContext = { files: [], mentions: [] };

describe('Planner', () => {
  let compiler: ContextCompiler;

  beforeEach(() => {
    vi.clearAllMocks();
    compiler = new ContextCompiler();
  });

  it('generatePlan() with valid JSON response parses plan correctly', async () => {
    const json = JSON.stringify({
      plan: 'Test plan',
      steps: [
        { id: 's1', goal: 'Do thing', files: ['a.ts'], risks: [], constraints: [] },
      ],
      assumptions: ['Assumption'],
    });
    const registry = createMockRegistry([json]);
    const planner = new Planner(registry, compiler);

    const plan = await planner.generatePlan('test query', emptyContext);

    expect(plan.plan).toBe('Test plan');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].id).toBe('s1');
    expect(plan.steps[0].goal).toBe('Do thing');
    expect(plan.assumptions).toContain('Assumption');
  });

  it('generatePlan() with non-JSON response returns raw text as plan', async () => {
    const registry = createMockRegistry(['This is not JSON']);
    const planner = new Planner(registry, compiler);

    const plan = await planner.generatePlan('test query', emptyContext);

    expect(plan.plan).toBe('This is not JSON');
    expect(plan.steps).toHaveLength(0);
  });

  it('generatePlan() throws when no planner role configured', async () => {
    const registry = {
      getByRole: vi.fn(() => undefined),
    } as any;
    const planner = new Planner(registry, compiler);

    await expect(planner.generatePlan('test', emptyContext)).rejects.toThrow(
      /No planner model configured/,
    );
  });

  it('generatePlan() emits streamToken events', async () => {
    const registry = createMockRegistry(['token1', 'token2']);
    const planner = new Planner(registry, compiler);
    const events: OrchestratorEvent[] = [];

    await planner.generatePlan('test', emptyContext, (e) => events.push(e));

    const streamEvents = events.filter((e) => e.type === 'streamToken');
    expect(streamEvents).toHaveLength(2);
    expect(streamEvents[0].data.token).toBe('token1');
    expect(streamEvents[1].data.token).toBe('token2');
  });

  it('refinePlan() works with valid JSON response', async () => {
    const json = JSON.stringify({
      plan: 'Refined plan',
      steps: [
        { id: 's1', goal: 'Refined step', files: ['b.ts'], risks: [], constraints: [] },
      ],
      assumptions: ['Updated assumption'],
    });
    const registry = createMockRegistry([json]);
    const planner = new Planner(registry, compiler);

    const currentPlan = {
      plan: 'Old plan',
      steps: [],
      assumptions: [],
    };

    const plan = await planner.refinePlan(currentPlan, 'needs improvement', emptyContext);

    expect(plan.plan).toBe('Refined plan');
    expect(plan.steps[0].goal).toBe('Refined step');
    expect(plan.assumptions).toContain('Updated assumption');
  });
});
