import { describe, it, expect, vi } from 'vitest';
import { createHumanChannel } from '../humanChannel';
import { PromptBroker } from '../promptBroker';
import type { UserPromptBroker, AgentAnswer, AgentQuestion } from '../../contracts/broker';
import type { AgentRef } from '../../contracts/ids';
import { asRunId, asAgentId, asQuestionId } from '../../contracts/ids';
import type { BudgetTracker, BudgetStatus } from '../../contracts/budget';
import type { ExtToWebview } from '../../contracts/protocol';

function makeRef(overrides: Partial<AgentRef> = {}): AgentRef {
  return {
    runId: asRunId('run-1'),
    agentId: asAgentId('agent-1'),
    agentType: 'general',
    ...overrides,
  };
}

/** Spy tracker that records the call order of markBlocked / markUnblocked. */
function makeTracker(ref: AgentRef) {
  const calls: string[] = [];
  const tracker: BudgetTracker = {
    ref,
    budget: {},
    chargeIteration: () => {},
    chargeToolCall: () => {},
    chargeTokens: () => {},
    chargeCost: () => {},
    check: () => ({ exhausted: false, remaining: {} as BudgetStatus['remaining'] }),
    markBlocked: vi.fn(() => { calls.push('blocked'); }),
    markUnblocked: vi.fn(() => { calls.push('unblocked'); }),
    snapshot: () => ({ exhausted: false, remaining: {} as BudgetStatus['remaining'] }),
  };
  return { tracker, calls };
}

/** Broker stub whose enqueue we drive manually. */
function stubBroker() {
  let settle!: (a: AgentAnswer) => void;
  const enqueue = vi.fn(
    (_question: AgentQuestion) => new Promise<AgentAnswer>((res) => { settle = res; }),
  );
  const broker: UserPromptBroker = {
    enqueue,
    resolve: vi.fn(),
    cancelAgent: vi.fn(),
    cancelRun: vi.fn(),
    pending: vi.fn(() => []),
  };
  return { broker, enqueue, settleEnqueue: (a: AgentAnswer) => settle(a) };
}

describe('createHumanChannel', () => {
  it('ask() enqueues with the bound ref and returns the broker answer', async () => {
    const ref = makeRef();
    const { broker, enqueue, settleEnqueue } = stubBroker();
    const channel = createHumanChannel(broker, ref);

    const p = channel.ask({ kind: 'text', ref, prompt: 'name?' });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][0]).toMatchObject({ kind: 'text', ref, prompt: 'name?' });

    settleEnqueue({ text: 'Ada' });
    await expect(p).resolves.toEqual({ text: 'Ada' });
  });

  it('calls markBlocked before enqueue and markUnblocked after it settles', async () => {
    const ref = makeRef();
    const { tracker, calls } = makeTracker(ref);
    const { broker, settleEnqueue } = stubBroker();
    const channel = createHumanChannel(broker, ref, tracker);

    const p = channel.ask({ kind: 'text', ref, prompt: 'q' });

    // Blocked immediately; not yet unblocked while the question is outstanding.
    expect(tracker.markBlocked).toHaveBeenCalledTimes(1);
    expect(tracker.markUnblocked).not.toHaveBeenCalled();

    settleEnqueue({ text: 'a' });
    await p;

    expect(tracker.markUnblocked).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['blocked', 'unblocked']);
  });

  it('unblocks even when the question is cancelled', async () => {
    const ref = makeRef();
    const { tracker } = makeTracker(ref);
    const { broker, settleEnqueue } = stubBroker();
    const channel = createHumanChannel(broker, ref, tracker);

    const p = channel.ask({ kind: 'text', ref, prompt: 'q' });
    settleEnqueue({ cancelled: true });
    await p;

    expect(tracker.markUnblocked).toHaveBeenCalledTimes(1);
  });

  describe('approve()', () => {
    it('defaults the approval options and maps Allow to allowed', async () => {
      const ref = makeRef();
      const { broker, enqueue, settleEnqueue } = stubBroker();
      const channel = createHumanChannel(broker, ref);

      const p = channel.approve({ ref, prompt: 'rm -rf?' });
      expect(enqueue.mock.calls[0][0]).toMatchObject({
        kind: 'approval',
        options: ['Allow', 'Allow & Remember', 'Deny'],
      });

      settleEnqueue({ choice: 'Allow' });
      await expect(p).resolves.toEqual({ allowed: true, remember: false });
    });

    it('maps Allow & Remember to allowed + remember', async () => {
      const ref = makeRef();
      const { broker, settleEnqueue } = stubBroker();
      const channel = createHumanChannel(broker, ref);

      const p = channel.approve({ ref, prompt: 'write?' });
      settleEnqueue({ choice: 'Allow & Remember' });
      await expect(p).resolves.toEqual({ allowed: true, remember: true });
    });

    it('maps Deny to not allowed', async () => {
      const ref = makeRef();
      const { broker, settleEnqueue } = stubBroker();
      const channel = createHumanChannel(broker, ref);

      const p = channel.approve({ ref, prompt: 'write?' });
      settleEnqueue({ choice: 'Deny' });
      await expect(p).resolves.toEqual({ allowed: false, remember: false });
    });

    it('treats cancellation/timeout as a denial', async () => {
      const ref = makeRef();
      const { broker, settleEnqueue } = stubBroker();
      const channel = createHumanChannel(broker, ref);

      const p = channel.approve({ ref, prompt: 'write?' });
      settleEnqueue({ cancelled: true });
      await expect(p).resolves.toEqual({ allowed: false, remember: false });
    });
  });

  it('integrates with the real PromptBroker end-to-end', async () => {
    const posted: ExtToWebview[] = [];
    let seq = 0;
    const broker = new PromptBroker((m) => posted.push(m), () => `q${++seq}`);
    const ref = makeRef();
    const { tracker } = makeTracker(ref);
    const channel = createHumanChannel(broker, ref, tracker);

    const p = channel.approve({ ref, prompt: 'go?' });
    expect(broker.pending()).toHaveLength(1);
    expect(tracker.markBlocked).toHaveBeenCalledTimes(1);

    broker.resolve(asQuestionId('q1'), { choice: 'Allow' });
    await expect(p).resolves.toEqual({ allowed: true, remember: false });
    expect(tracker.markUnblocked).toHaveBeenCalledTimes(1);
    expect(broker.pending()).toHaveLength(0);
  });
});
