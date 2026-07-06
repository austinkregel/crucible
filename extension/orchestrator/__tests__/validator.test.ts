import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Validator } from '../validator';
import { ContextCompiler } from '../../context/compiler';
import type { CollectedContext } from '../../context/collector';
import type { Plan, OrchestratorEvent } from '../types';

function createMockStreamChat(tokens: string[]) {
  return async function* () {
    for (const t of tokens) yield t;
  };
}

function createMockRegistry(tokens: string[], role = 'validator') {
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

const samplePlan: Plan = {
  plan: 'Test plan',
  steps: [{ id: 's1', goal: 'Do thing', files: ['a.ts'], risks: [], constraints: [], status: 'pending' }],
  assumptions: [],
};

describe('Validator', () => {
  let compiler: ContextCompiler;

  beforeEach(() => {
    vi.clearAllMocks();
    compiler = new ContextCompiler();
  });

  it('validate() parses valid JSON validation response', async () => {
    const json = JSON.stringify({
      issues: ['Issue 1'],
      missing_cases: ['Edge case'],
      conflicts: ['Conflict A'],
      confidence_score: 0.85,
    });
    const registry = createMockRegistry([json]);
    const validator = new Validator(registry, compiler);

    const result = await validator.validate(samplePlan, emptyContext);

    expect(result.issues).toEqual(['Issue 1']);
    expect(result.missingCases).toEqual(['Edge case']);
    expect(result.conflicts).toEqual(['Conflict A']);
    expect(result.confidenceScore).toBe(0.85);
    expect(result.approved).toBe(false);
  });

  it('validate() handles non-JSON response', async () => {
    const registry = createMockRegistry(['This is not valid JSON']);
    const validator = new Validator(registry, compiler);

    const result = await validator.validate(samplePlan, emptyContext);

    expect(result.confidenceScore).toBe(0.5);
    expect(result.issues).toEqual([]);
    expect(result.raw).toBe('This is not valid JSON');
  });

  it('validate() handles malformed JSON', async () => {
    const registry = createMockRegistry(['{invalid json}']);
    const validator = new Validator(registry, compiler);

    const result = await validator.validate(samplePlan, emptyContext);

    expect(result.confidenceScore).toBe(0.3);
    expect(result.issues).toContainEqual('Failed to parse validation response');
  });

  it('validate() throws when no validator role', async () => {
    const registry = { getByRole: vi.fn(() => undefined) } as any;
    const validator = new Validator(registry, compiler);

    await expect(validator.validate(samplePlan, emptyContext)).rejects.toThrow(
      /No validator model configured/,
    );
  });

  it('validate() clamps confidence score between 0 and 1', async () => {
    const overJson = JSON.stringify({ confidence_score: 5.0, issues: [], missing_cases: [], conflicts: [] });
    const overRegistry = createMockRegistry([overJson]);
    const validator1 = new Validator(overRegistry, compiler);
    const result1 = await validator1.validate(samplePlan, emptyContext);
    expect(result1.confidenceScore).toBe(1);

    const underJson = JSON.stringify({ confidence_score: -2.0, issues: [], missing_cases: [], conflicts: [] });
    const underRegistry = createMockRegistry([underJson]);
    const validator2 = new Validator(underRegistry, compiler);
    const result2 = await validator2.validate(samplePlan, emptyContext);
    expect(result2.confidenceScore).toBe(0);
  });

  it('validate() emits streamToken events', async () => {
    const registry = createMockRegistry(['tok1', 'tok2']);
    const validator = new Validator(registry, compiler);
    const events: OrchestratorEvent[] = [];

    await validator.validate(samplePlan, emptyContext, (e) => events.push(e));

    const streamEvents = events.filter((e) => e.type === 'streamToken');
    expect(streamEvents).toHaveLength(2);
    expect(streamEvents[0].data.role).toBe('validator');
  });

  describe('formatCritique', () => {
    it('formats issues, missing cases, and conflicts', () => {
      const validator = new Validator({} as any, compiler);
      const result = validator.formatCritique({
        issues: ['Bug A'],
        missingCases: ['Edge B'],
        conflicts: ['Conflict C'],
        confidenceScore: 0.4,
        approved: false,
      });

      expect(result).toContain('Bug A');
      expect(result).toContain('Edge B');
      expect(result).toContain('Conflict C');
    });

    it('returns "No issues found." when all empty', () => {
      const validator = new Validator({} as any, compiler);
      const result = validator.formatCritique({
        issues: [],
        missingCases: [],
        conflicts: [],
        confidenceScore: 0.9,
        approved: true,
      });

      expect(result).toBe('No issues found.');
    });
  });
});
