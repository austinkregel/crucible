import { describe, it, expect } from 'vitest';
import { DefaultBudgetTracker } from '../budgetTracker';
import type { AgentBudget } from '../../contracts/budget';
import { asAgentId, asRunId, type AgentRef } from '../../contracts/ids';

function makeRef(agentType = 'general'): AgentRef {
  return {
    runId: asRunId('run-1'),
    agentId: asAgentId('agent-1'),
    agentType,
  };
}

/** A manually-advanced clock for deterministic wall-clock tests. */
function fakeClock(start = 1_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('DefaultBudgetTracker', () => {
  it('exposes ref and budget', () => {
    const ref = makeRef();
    const budget: AgentBudget = { maxIterations: 3 };
    const tracker = new DefaultBudgetTracker(ref, budget);
    expect(tracker.ref).toBe(ref);
    expect(tracker.budget).toBe(budget);
  });

  it('trips maxIterations with the correct reason', () => {
    const tracker = new DefaultBudgetTracker(makeRef(), { maxIterations: 2 });
    tracker.chargeIteration();
    expect(tracker.check().exhausted).toBe(false);
    tracker.chargeIteration();
    const status = tracker.check();
    expect(status.exhausted).toBe(true);
    expect(status.reason).toBe('maxIterations');
    expect(status.remaining.maxIterations).toBe(0);
  });

  it('trips maxToolCalls with the correct reason', () => {
    const tracker = new DefaultBudgetTracker(makeRef(), { maxToolCalls: 1 });
    expect(tracker.check().exhausted).toBe(false);
    tracker.chargeToolCall();
    const status = tracker.check();
    expect(status.exhausted).toBe(true);
    expect(status.reason).toBe('maxToolCalls');
  });

  it('trips maxTokens with the correct reason', () => {
    const tracker = new DefaultBudgetTracker(makeRef(), { maxTokens: 100 });
    tracker.chargeTokens(60);
    expect(tracker.check().exhausted).toBe(false);
    tracker.chargeTokens(40);
    const status = tracker.check();
    expect(status.exhausted).toBe(true);
    expect(status.reason).toBe('maxTokens');
    expect(status.remaining.maxTokens).toBe(0);
  });

  it('trips maxCostUsd with the correct reason', () => {
    const tracker = new DefaultBudgetTracker(makeRef(), { maxCostUsd: 0.5 });
    tracker.chargeCost(0.25);
    expect(tracker.check().exhausted).toBe(false);
    tracker.chargeCost(0.3);
    const status = tracker.check();
    expect(status.exhausted).toBe(true);
    expect(status.reason).toBe('maxCostUsd');
    expect(status.remaining.maxCostUsd).toBeCloseTo(-0.05, 10);
  });

  it('trips maxWallClockMs based on active elapsed time', () => {
    const clock = fakeClock();
    const tracker = new DefaultBudgetTracker(makeRef(), { maxWallClockMs: 1000 }, clock.now);
    clock.advance(999);
    expect(tracker.check().exhausted).toBe(false);
    clock.advance(1);
    const status = tracker.check();
    expect(status.exhausted).toBe(true);
    expect(status.reason).toBe('maxWallClockMs');
  });

  it('reports the first tripped limit in fixed order as reason', () => {
    const tracker = new DefaultBudgetTracker(makeRef(), { maxIterations: 1, maxToolCalls: 1 });
    tracker.chargeIteration();
    tracker.chargeToolCall();
    // Both tripped; iterations is checked first.
    expect(tracker.check().reason).toBe('maxIterations');
  });

  it('reports Infinity remaining for unbounded limits and never exhausts', () => {
    const tracker = new DefaultBudgetTracker(makeRef(), {});
    tracker.chargeIteration();
    tracker.chargeToolCall();
    tracker.chargeTokens(1_000_000);
    tracker.chargeCost(999);
    const status = tracker.check();
    expect(status.exhausted).toBe(false);
    expect(status.reason).toBeUndefined();
    expect(status.remaining.maxIterations).toBe(Infinity);
    expect(status.remaining.maxToolCalls).toBe(Infinity);
    expect(status.remaining.maxTokens).toBe(Infinity);
    expect(status.remaining.maxWallClockMs).toBe(Infinity);
    expect(status.remaining.maxCostUsd).toBe(Infinity);
  });

  it('reports remaining headroom for bounded limits before exhaustion', () => {
    const tracker = new DefaultBudgetTracker(makeRef(), { maxIterations: 10 });
    tracker.chargeIteration();
    tracker.chargeIteration();
    const status = tracker.check();
    expect(status.remaining.maxIterations).toBe(8);
    expect(status.exhausted).toBe(false);
  });

  it('markBlocked freezes wall-clock accrual; markUnblocked resumes it', () => {
    const clock = fakeClock();
    const tracker = new DefaultBudgetTracker(makeRef(), { maxWallClockMs: 1000 }, clock.now);

    clock.advance(400); // 400ms active
    tracker.markBlocked();
    clock.advance(10_000); // blocked on human — must NOT count
    expect(tracker.check().exhausted).toBe(false);
    expect(tracker.snapshot().remaining.maxWallClockMs).toBe(600);

    tracker.markUnblocked();
    clock.advance(500); // 900ms active total
    expect(tracker.check().exhausted).toBe(false);
    expect(tracker.snapshot().remaining.maxWallClockMs).toBe(100);

    clock.advance(100); // 1000ms active — now exhausted
    const status = tracker.check();
    expect(status.exhausted).toBe(true);
    expect(status.reason).toBe('maxWallClockMs');
  });

  it('handles nested markBlocked/markUnblocked without double counting', () => {
    const clock = fakeClock();
    const tracker = new DefaultBudgetTracker(makeRef(), { maxWallClockMs: 1000 }, clock.now);

    clock.advance(200);
    tracker.markBlocked();
    tracker.markBlocked(); // nested block
    clock.advance(5000);
    tracker.markUnblocked(); // still blocked (outer)
    clock.advance(5000);
    expect(tracker.snapshot().remaining.maxWallClockMs).toBe(800);
    tracker.markUnblocked(); // now active again
    clock.advance(300);
    expect(tracker.snapshot().remaining.maxWallClockMs).toBe(500);
  });

  it('treats an unmatched markUnblocked as a no-op', () => {
    const clock = fakeClock();
    const tracker = new DefaultBudgetTracker(makeRef(), { maxWallClockMs: 1000 }, clock.now);
    tracker.markUnblocked(); // no prior block
    clock.advance(300);
    // Clock kept running normally.
    expect(tracker.snapshot().remaining.maxWallClockMs).toBe(700);
  });

  it('snapshot and check agree', () => {
    const tracker = new DefaultBudgetTracker(makeRef(), { maxIterations: 5 });
    tracker.chargeIteration();
    expect(tracker.check()).toEqual(tracker.snapshot());
  });
});
