import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { _configStore } from '../../__mocks__/vscode';
import { Orchestrator } from '../index';
import type { OrchestratorEvent, Plan } from '../types';
import { MockCacheStore } from '../../__mocks__/cacheStore';

function createMockStreamChat(tokens: string[]) {
  return async function* () {
    for (const t of tokens) yield t;
  };
}

function makePlanJson(confidence = 0.9) {
  return JSON.stringify({
    plan: 'Test plan',
    steps: [{ id: 's1', goal: 'Step one', files: ['a.ts'], risks: [], constraints: [] }],
    assumptions: ['Assumption A'],
  });
}

function makeValidationJson(score: number) {
  return JSON.stringify({
    issues: score < 0.7 ? ['Problem'] : [],
    missing_cases: [],
    conflicts: [],
    confidence_score: score,
  });
}

function makePostValidationJson() {
  return JSON.stringify({ approved: true, issues: [], suggested_fixes: [] });
}

function createFullRegistry(planTokens: string[], validationTokens: string[], executorTokens: string[], postTokens: string[]) {
  const roles: Record<string, any> = {
    planner: {
      provider: { streamChat: vi.fn(() => createMockStreamChat(planTokens)()) },
      model: 'planner-model',
    },
    validator: {
      provider: { streamChat: vi.fn(() => createMockStreamChat(validationTokens)()) },
      model: 'validator-model',
    },
    executor: {
      provider: { streamChat: vi.fn(() => createMockStreamChat(executorTokens)()) },
      model: 'executor-model',
    },
    postValidator: {
      provider: { streamChat: vi.fn(() => createMockStreamChat(postTokens)()) },
      model: 'post-model',
    },
  };

  return {
    getByRole: vi.fn((role: string) => roles[role] || undefined),
  } as any;
}

describe('Orchestrator', () => {
  let events: OrchestratorEvent[];
  let store: MockCacheStore;

  beforeEach(() => {
    vi.clearAllMocks();
    events = [];
    store = new MockCacheStore();
    _configStore['adversarial.confidenceThreshold'] = 0.7;
    _configStore['adversarial.maxIterations'] = 3;
    _configStore['adversarial.postValidation'] = true;

    (vscode.workspace.findFiles as any).mockResolvedValue([]);
    (vscode.window as any).activeTextEditor = undefined;
    (vscode.workspace as any).asRelativePath = vi.fn((u: any) => u?.fsPath || u);
  });

  describe('runPlanOnly', () => {
    it('emits planning and validation phases then planComplete', async () => {
      const registry = createFullRegistry(
        [makePlanJson()],
        [makeValidationJson(0.9)],
        [],
        [],
      );
      const orchestrator = new Orchestrator(registry, store as any);

      await orchestrator.runPlanOnly('Do something', [], (e) => events.push(e));

      const types = events.map((e) => e.type);
      expect(types).toContain('phaseStarted');
      expect(types).toContain('planGenerated');
      expect(types).toContain('validationComplete');
      expect(types).toContain('planComplete');
    });

    it('refines plan when confidence is below threshold', async () => {
      let validationCallCount = 0;
      const validatorProvider = {
        streamChat: vi.fn(() => {
          validationCallCount++;
          if (validationCallCount <= 1) {
            return createMockStreamChat([makeValidationJson(0.3)])();
          }
          return createMockStreamChat([makeValidationJson(0.9)])();
        }),
      };

      let planCallCount = 0;
      const plannerProvider = {
        streamChat: vi.fn(() => {
          planCallCount++;
          return createMockStreamChat([makePlanJson()])();
        }),
      };

      const registry = {
        getByRole: vi.fn((role: string) => {
          if (role === 'planner') return { provider: plannerProvider, model: 'm' };
          if (role === 'validator') return { provider: validatorProvider, model: 'm' };
          return undefined;
        }),
      } as any;

      const orchestrator = new Orchestrator(registry, store as any);
      await orchestrator.runPlanOnly('Do something', [], (e) => events.push(e));

      const types = events.map((e) => e.type);
      expect(types).toContain('planRefined');
      expect(types).toContain('planComplete');
    });

    it('emits error on exception', async () => {
      const registry = {
        getByRole: vi.fn(() => { throw new Error('kaboom'); }),
      } as any;

      const orchestrator = new Orchestrator(registry, store as any);
      await orchestrator.runPlanOnly('query', [], (e) => events.push(e));

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.data.message).toContain('kaboom');
    });

    // Regression: the adversarial planning flow "died" silently when the
    // pre-flight model-readiness check threw. Pre-flight ran BEFORE the
    // try/catch, so the failure escaped as an unhandled rejection instead of
    // an `error` event -- leaving the UI stuck mid-planning with no feedback.
    it('does not reject and surfaces an error event when preflight fails', async () => {
      const registry = {
        getByRole: vi.fn(() => { throw new Error('preflight boom'); }),
      } as any;

      const orchestrator = new Orchestrator(registry, store as any);

      // Must resolve (not reject) so the caller can post agentEnd + error.
      await expect(
        orchestrator.runPlanOnly('query', [], (e) => events.push(e)),
      ).resolves.toBeUndefined();

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.data.message).toContain('preflight boom');
    });
  });

  describe('runAgentWithPlan', () => {
    it('executes plan steps and emits execution events', async () => {
      const registry = createFullRegistry(
        [],
        [],
        ['Executed step.'],
        [makePostValidationJson()],
      );
      const plan: Plan = {
        plan: 'Test',
        steps: [{ id: 's1', goal: 'Step', files: [], risks: [], constraints: [], status: 'pending' }],
        assumptions: [],
      };

      const orchestrator = new Orchestrator(registry, store as any);
      await orchestrator.runAgentWithPlan(plan, (e) => events.push(e));

      const types = events.map((e) => e.type);
      expect(types).toContain('phaseStarted');
      expect(types).toContain('stepStarted');
      expect(types).toContain('stepCompleted');
      expect(types).toContain('postValidationComplete');
      expect(types).toContain('complete');
    });

    it('handles step execution failure gracefully', async () => {
      const failingProvider = {
        streamChat: vi.fn(() => {
          throw new Error('Model unavailable');
        }),
      };
      const registry = {
        getByRole: vi.fn((role: string) => {
          if (role === 'executor') return { provider: failingProvider, model: 'm' };
          if (role === 'postValidator') return undefined;
          return undefined;
        }),
      } as any;

      const plan: Plan = {
        plan: 'Fail test',
        steps: [{ id: 's1', goal: 'Broken step', files: [], risks: [], constraints: [], status: 'pending' }],
        assumptions: [],
      };

      const orchestrator = new Orchestrator(registry, store as any);
      await orchestrator.runAgentWithPlan(plan, (e) => events.push(e));

      const types = events.map((e) => e.type);
      expect(types).toContain('stepFailed');
    });

    // Regression: executeStep signals failure by *returning* success:false (circuit
    // breaker / error abort), it does not throw. The orchestrator only emitted
    // stepFailed from its catch block, so failed steps were reported as
    // stepCompleted -- which the webview renders as a green "done" step,
    // swallowing the error entirely.
    it('emits stepFailed (not stepCompleted) when a step returns success:false', async () => {
      const failingProvider = {
        streamChat: vi.fn(() => { throw new Error('Model unavailable'); }),
      };
      const registry = {
        getByRole: vi.fn((role: string) =>
          role === 'executor' ? { provider: failingProvider, model: 'm' } : undefined,
        ),
      } as any;

      const plan: Plan = {
        plan: 'Fail test',
        steps: [{ id: 's1', goal: 'Broken step', files: [], risks: [], constraints: [], status: 'pending' }],
        assumptions: [],
      };

      const orchestrator = new Orchestrator(registry, store as any);
      await orchestrator.runAgentWithPlan(plan, (e) => events.push(e));

      const types = events.map((e) => e.type);
      expect(types).toContain('stepFailed');
      expect(types).not.toContain('stepCompleted');
      expect(plan.steps[0].status).toBe('failed');

      const failure = events.find((e) => e.type === 'stepFailed');
      expect(failure!.data.success).toBe(false);
      expect(failure!.data.error).toBeTruthy();
    });

    it('emits stepCompleted (not stepFailed) when a step succeeds', async () => {
      const registry = createFullRegistry([], [], ['Done, no tools needed.'], [makePostValidationJson()]);
      const plan: Plan = {
        plan: 'Happy path',
        steps: [{ id: 's1', goal: 'Step', files: [], risks: [], constraints: [], status: 'pending' }],
        assumptions: [],
      };

      const orchestrator = new Orchestrator(registry, store as any);
      await orchestrator.runAgentWithPlan(plan, (e) => events.push(e));

      const types = events.map((e) => e.type);
      expect(types).toContain('stepCompleted');
      expect(types).not.toContain('stepFailed');
      expect(plan.steps[0].status).toBe('done');
    });

    it('skips post-validation when disabled', async () => {
      _configStore['adversarial.postValidation'] = false;

      const registry = createFullRegistry([], [], ['Done.'], []);
      const plan: Plan = {
        plan: 'Test',
        steps: [{ id: 's1', goal: 'Step', files: [], risks: [], constraints: [], status: 'pending' }],
        assumptions: [],
      };

      const orchestrator = new Orchestrator(registry, store as any);
      await orchestrator.runAgentWithPlan(plan, (e) => events.push(e));

      const types = events.map((e) => e.type);
      expect(types).not.toContain('postValidationComplete');
      expect(types).toContain('complete');
    });
  });

  describe('runAgent', () => {
    it('runs full pipeline: plan -> validate -> execute -> post-validate', async () => {
      const registry = createFullRegistry(
        [makePlanJson()],
        [makeValidationJson(0.9)],
        ['Implemented.'],
        [makePostValidationJson()],
      );

      const orchestrator = new Orchestrator(registry, store as any);
      await orchestrator.runAgent('Build feature', [], (e) => events.push(e));

      const types = events.map((e) => e.type);
      expect(types).toContain('planGenerated');
      expect(types).toContain('validationComplete');
      expect(types).toContain('stepStarted');
      expect(types).toContain('stepCompleted');
      expect(types).toContain('complete');
    });

    it('stops with error when plan fails validation after max iterations', async () => {
      _configStore['adversarial.maxIterations'] = 1;

      const registry = createFullRegistry(
        [makePlanJson()],
        [makeValidationJson(0.3)],
        [],
        [],
      );

      const orchestrator = new Orchestrator(registry, store as any);
      await orchestrator.runAgent('Build feature', [], (e) => events.push(e));

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.data.message).toContain('confidence threshold');
    });

    // Regression companion to runPlanOnly: full agent mode must also convert a
    // preflight failure into an `error` event rather than an unhandled rejection.
    it('does not reject and surfaces an error event when preflight fails', async () => {
      const registry = {
        getByRole: vi.fn(() => { throw new Error('preflight boom'); }),
      } as any;

      const orchestrator = new Orchestrator(registry, store as any);

      await expect(
        orchestrator.runAgent('query', [], (e) => events.push(e)),
      ).resolves.toBeUndefined();

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.data.message).toContain('preflight boom');
    });
  });
});
