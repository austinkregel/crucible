import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PromptBroker } from '../promptBroker';
import type { AgentQuestion } from '../../contracts/broker';
import type { AgentRef, QuestionId } from '../../contracts/ids';
import { asRunId, asAgentId, asQuestionId } from '../../contracts/ids';
import type { ExtToWebview } from '../../contracts/protocol';

function makeRef(overrides: Partial<AgentRef> = {}): AgentRef {
  return {
    runId: asRunId('run-1'),
    agentId: asAgentId('agent-1'),
    agentType: 'general',
    ...overrides,
  };
}

function makeQuestion(ref: AgentRef, overrides: Partial<AgentQuestion> = {}): AgentQuestion {
  return { kind: 'text', ref, prompt: 'why?', ...overrides };
}

/** Deterministic id generator for assertions. */
function seqIds(): () => string {
  let n = 0;
  return () => `q${++n}`;
}

describe('PromptBroker', () => {
  let posted: ExtToWebview[];
  let post: (msg: ExtToWebview) => void;

  beforeEach(() => {
    posted = [];
    post = (msg) => posted.push(msg);
  });

  it('mints a QuestionId and posts an agentQuestion on enqueue', () => {
    const broker = new PromptBroker(post, seqIds());
    void broker.enqueue(makeQuestion(makeRef()));

    expect(posted).toEqual([
      { type: 'agentQuestion', id: 'q1', question: makeQuestion(makeRef()) },
    ]);
    expect(broker.pending()).toHaveLength(1);
  });

  it('resolves the enqueue promise when resolve() is called with the matching id', async () => {
    const broker = new PromptBroker(post, seqIds());
    const promise = broker.enqueue(makeQuestion(makeRef()));

    broker.resolve(asQuestionId('q1'), { text: 'because' });

    await expect(promise).resolves.toEqual({ text: 'because' });
    expect(broker.pending()).toHaveLength(0);
    expect(posted).toContainEqual({ type: 'agentQuestionResolved', id: 'q1' });
  });

  it('ignores resolve() for a non-matching / unknown id', async () => {
    const broker = new PromptBroker(post, seqIds());
    const promise = broker.enqueue(makeQuestion(makeRef()));

    let settled = false;
    void promise.then(() => { settled = true; });

    broker.resolve(asQuestionId('does-not-exist') as QuestionId, { text: 'nope' });
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(broker.pending()).toHaveLength(1);
    // no resolved message emitted for an unknown id
    expect(posted.some((m) => m.type === 'agentQuestionResolved')).toBe(false);
  });

  it('settles concurrent enqueues independently', async () => {
    const broker = new PromptBroker(post, seqIds());
    const p1 = broker.enqueue(makeQuestion(makeRef()));
    const p2 = broker.enqueue(makeQuestion(makeRef()));
    const p3 = broker.enqueue(makeQuestion(makeRef()));

    expect(broker.pending()).toHaveLength(3);

    broker.resolve(asQuestionId('q2'), { text: 'second' });
    await expect(p2).resolves.toEqual({ text: 'second' });
    expect(broker.pending().map((p) => p.id)).toEqual(['q1', 'q3']);

    broker.resolve(asQuestionId('q1'), { text: 'first' });
    broker.resolve(asQuestionId('q3'), { text: 'third' });
    await expect(p1).resolves.toEqual({ text: 'first' });
    await expect(p3).resolves.toEqual({ text: 'third' });
    expect(broker.pending()).toHaveLength(0);
  });

  it('cancelAgent rejects only that agent\'s outstanding questions with cancelled:true', async () => {
    const broker = new PromptBroker(post, seqIds());
    const refA = makeRef({ agentId: asAgentId('a') });
    const refB = makeRef({ agentId: asAgentId('b') });

    const pA1 = broker.enqueue(makeQuestion(refA)); // q1
    const pA2 = broker.enqueue(makeQuestion(refA)); // q2
    const pB = broker.enqueue(makeQuestion(refB));  // q3

    broker.cancelAgent(asAgentId('a'));

    await expect(pA1).resolves.toEqual({ cancelled: true });
    await expect(pA2).resolves.toEqual({ cancelled: true });
    expect(broker.pending().map((p) => p.id)).toEqual(['q3']);
    expect(posted).toContainEqual({ type: 'agentQuestionResolved', id: 'q1' });
    expect(posted).toContainEqual({ type: 'agentQuestionResolved', id: 'q2' });

    broker.resolve(asQuestionId('q3'), { text: 'still here' });
    await expect(pB).resolves.toEqual({ text: 'still here' });
  });

  it('cancelRun rejects every outstanding question in that run', async () => {
    const broker = new PromptBroker(post, seqIds());
    const refA = makeRef({ runId: asRunId('r1'), agentId: asAgentId('a') });
    const refB = makeRef({ runId: asRunId('r1'), agentId: asAgentId('b') });
    const refOther = makeRef({ runId: asRunId('r2'), agentId: asAgentId('c') });

    const pA = broker.enqueue(makeQuestion(refA)); // q1
    const pB = broker.enqueue(makeQuestion(refB)); // q2
    const pOther = broker.enqueue(makeQuestion(refOther)); // q3

    broker.cancelRun(asRunId('r1'));

    await expect(pA).resolves.toEqual({ cancelled: true });
    await expect(pB).resolves.toEqual({ cancelled: true });
    expect(broker.pending().map((p) => p.id)).toEqual(['q3']);

    broker.resolve(asQuestionId('q3'), { text: 'unrelated run' });
    await expect(pOther).resolves.toEqual({ text: 'unrelated run' });
  });

  describe('timeoutMs', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('auto-settles with cancelled:true after the deadline', async () => {
      const broker = new PromptBroker(post, seqIds());
      const promise = broker.enqueue(makeQuestion(makeRef(), { timeoutMs: 1000 }));

      expect(broker.pending()).toHaveLength(1);
      vi.advanceTimersByTime(1000);

      await expect(promise).resolves.toEqual({ cancelled: true });
      expect(broker.pending()).toHaveLength(0);
      expect(posted).toContainEqual({ type: 'agentQuestionResolved', id: 'q1' });
    });

    it('waits forever when timeoutMs is absent', async () => {
      const broker = new PromptBroker(post, seqIds());
      const promise = broker.enqueue(makeQuestion(makeRef()));
      let settled = false;
      void promise.then(() => { settled = true; });

      vi.advanceTimersByTime(10_000_000);
      await Promise.resolve();

      expect(settled).toBe(false);
      expect(broker.pending()).toHaveLength(1);
    });

    it('does not fire the timeout after an early resolve', async () => {
      const broker = new PromptBroker(post, seqIds());
      const promise = broker.enqueue(makeQuestion(makeRef(), { timeoutMs: 1000 }));

      broker.resolve(asQuestionId('q1'), { text: 'in time' });
      vi.advanceTimersByTime(5000);

      await expect(promise).resolves.toEqual({ text: 'in time' });
      // only one resolved message — the timeout did not emit a second one
      expect(posted.filter((m) => m.type === 'agentQuestionResolved')).toHaveLength(1);
    });
  });
});
