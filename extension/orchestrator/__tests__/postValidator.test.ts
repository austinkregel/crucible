import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PostValidator } from '../postValidator';
import type { Plan, ExecutionResult, OrchestratorEvent } from '../types';

function createMockStreamChat(tokens: string[]) {
  return async function* () {
    for (const t of tokens) yield t;
  };
}

function createMockRegistry(tokens: string[], role = 'postValidator') {
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

const samplePlan: Plan = {
  plan: 'Test plan',
  steps: [{ id: 's1', goal: 'Do thing', files: ['a.ts'], risks: [], constraints: [], status: 'done' }],
  assumptions: [],
};

const sampleResults: ExecutionResult[] = [
  { stepId: 's1', success: true, diff: 'some diff', filesChanged: ['a.ts'] },
];

describe('PostValidator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns approved when no postValidator role configured', async () => {
    const registry = { getByRole: vi.fn(() => undefined) } as any;
    const pv = new PostValidator(registry);

    const result = await pv.validate(samplePlan, sampleResults);

    expect(result.approved).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.suggestedFixes).toEqual([]);
  });

  it('parses valid JSON response', async () => {
    const json = JSON.stringify({
      approved: false,
      issues: ['Missing test'],
      suggested_fixes: ['Add unit test'],
    });
    const registry = createMockRegistry([json]);
    const pv = new PostValidator(registry);

    const result = await pv.validate(samplePlan, sampleResults);

    expect(result.approved).toBe(false);
    expect(result.issues).toEqual(['Missing test']);
    expect(result.suggestedFixes).toEqual(['Add unit test']);
  });

  it('handles non-JSON response (defaults to approved)', async () => {
    const registry = createMockRegistry(['This is not JSON']);
    const pv = new PostValidator(registry);

    const result = await pv.validate(samplePlan, sampleResults);

    expect(result.approved).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('handles malformed JSON (defaults to approved)', async () => {
    const registry = createMockRegistry(['{bad json}']);
    const pv = new PostValidator(registry);

    const result = await pv.validate(samplePlan, sampleResults);

    expect(result.approved).toBe(true);
  });

  it('emits streamToken events', async () => {
    const registry = createMockRegistry(['t1', 't2']);
    const pv = new PostValidator(registry);
    const events: OrchestratorEvent[] = [];

    await pv.validate(samplePlan, sampleResults, (e) => events.push(e));

    const streamEvents = events.filter((e) => e.type === 'streamToken');
    expect(streamEvents).toHaveLength(2);
    expect(streamEvents[0].data.role).toBe('postValidator');
  });

  it('handles execution results with errors', async () => {
    const json = JSON.stringify({
      approved: false,
      issues: ['Step failed'],
      suggested_fixes: ['Retry step'],
    });
    const registry = createMockRegistry([json]);
    const pv = new PostValidator(registry);

    const failedResults: ExecutionResult[] = [
      { stepId: 's1', success: false, error: 'Compilation error', filesChanged: [] },
    ];

    const result = await pv.validate(samplePlan, failedResults);
    expect(result.approved).toBe(false);
    expect(result.issues).toContain('Step failed');
  });
});
