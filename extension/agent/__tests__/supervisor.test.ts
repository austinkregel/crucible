import { describe, it, expect, vi } from 'vitest';
import { DefaultSupervisor } from '../supervisor';
import { DEFAULT_BUDGET_CONFIG } from '../budgetConfig';
import { asRunId, type AgentId } from '../../contracts/ids';
import type { SubAgentSpec, SupervisorEvent, AgentLifecycle } from '../../contracts/supervisor';
import type { SubAgentResult } from '../runner';

/** A promise whose resolution we control by hand — no timers, fully deterministic. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Yield the microtask queue until `cond` holds (or we give up). No real time passes. */
async function waitUntil(cond: () => boolean, ticks = 1000): Promise<void> {
  for (let i = 0; i < ticks && !cond(); i++) {
    await Promise.resolve();
  }
}

function ok(agentId: string, agentName: string): SubAgentResult {
  return { sessionId: agentId, agentName, output: 'done', messages: [], success: true };
}

function makeSpec(agentType = 'general'): SubAgentSpec {
  return { agentType, prompt: 'do the thing', description: 'desc' };
}

interface Harness {
  supervisor: DefaultSupervisor;
  runner: { run: ReturnType<typeof vi.fn>; setAuditLogger: ReturnType<typeof vi.fn> };
  broker: {
    enqueue: ReturnType<typeof vi.fn>;
    resolve: ReturnType<typeof vi.fn>;
    cancelAgent: ReturnType<typeof vi.fn>;
    cancelRun: ReturnType<typeof vi.fn>;
    pending: () => never[];
  };
  events: SupervisorEvent[];
}

function makeHarness(opts: {
  maxConcurrency: number;
  run: ReturnType<typeof vi.fn>;
  provider?: () => { provider: any; model: string } | undefined;
}): Harness {
  const runner = { run: opts.run, setAuditLogger: vi.fn() };
  const registry = {
    get: vi.fn((name: string) => ({
      name,
      mode: 'subagent',
      policy: { allowedTools: [], terminalAllowed: false },
    })),
  };
  const broker = {
    enqueue: vi.fn(),
    resolve: vi.fn(),
    cancelAgent: vi.fn(),
    cancelRun: vi.fn(),
    pending: () => [],
  };
  const events: SupervisorEvent[] = [];
  const getProvider = opts.provider ?? (() => ({ provider: {} as any, model: 'm' }));

  const supervisor = new DefaultSupervisor(
    runner as any,
    registry as any,
    broker as any,
    getProvider,
    DEFAULT_BUDGET_CONFIG,
    { maxConcurrency: opts.maxConcurrency, onEvent: (e) => events.push(e) },
  );

  return { supervisor, runner: runner as any, broker: broker as any, events };
}

/** Lifecycle states emitted for a given agentId, in order. */
function lifecycleFor(events: SupervisorEvent[], agentId: AgentId): AgentLifecycle[] {
  return events
    .filter((e): e is Extract<SupervisorEvent, { kind: 'lifecycle' }> => e.kind === 'lifecycle')
    .filter((e) => e.ref.agentId === agentId)
    .map((e) => e.state);
}

describe('DefaultSupervisor', () => {
  it('spawnMany runs every spec and aggregates success', async () => {
    const run = vi.fn(async (agentType: string) => ok('sess', agentType));
    const { supervisor } = makeHarness({ maxConcurrency: 4, run });

    const runId = asRunId('run-1');
    const handles = supervisor.spawnMany(runId, [makeSpec(), makeSpec(), makeSpec()]);
    expect(handles).toHaveLength(3);

    const results = await Promise.all(handles.map((h) => h.result));
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.success)).toBe(true);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('never runs more than maxConcurrency agents at once', async () => {
    let live = 0;
    let peak = 0;
    const releasers: Array<() => void> = [];

    const run = vi.fn(async (agentType: string) => {
      live++;
      peak = Math.max(peak, live);
      const d = deferred<void>();
      releasers.push(d.resolve);
      await d.promise;
      live--;
      return ok('sess', agentType);
    });

    const { supervisor } = makeHarness({ maxConcurrency: 2, run });
    const handles = supervisor.spawnMany(asRunId('run-1'), [
      makeSpec(),
      makeSpec(),
      makeSpec(),
      makeSpec(),
    ]);

    // Only the first 2 should have entered run(); the other 2 are queued behind the slots.
    await waitUntil(() => releasers.length >= 2);
    expect(releasers.length).toBe(2);
    expect(live).toBe(2);

    // Release the first batch; the queued 2 must now (and only now) start.
    releasers.shift()!();
    releasers.shift()!();
    await waitUntil(() => releasers.length >= 2);
    expect(releasers.length).toBe(2);

    // Drain the rest.
    releasers.shift()!();
    releasers.shift()!();
    await Promise.all(handles.map((h) => h.result));

    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBe(2);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it('cancel(agentId) aborts the signal, calls broker.cancelAgent, and result still resolves', async () => {
    const d = deferred<void>();
    let capturedSignal: AbortSignal | undefined;
    const run = vi.fn(async (agentType: string, _prompt: string, _p: any, _m: string, _oe: any, signal: AbortSignal) => {
      capturedSignal = signal;
      await d.promise;
      return ok('sess', agentType);
    });

    const { supervisor, broker } = makeHarness({ maxConcurrency: 2, run });
    const handle = supervisor.spawn(asRunId('run-1'), makeSpec());

    await waitUntil(() => capturedSignal !== undefined);
    expect(capturedSignal!.aborted).toBe(false);

    supervisor.cancel(handle.ref.agentId);
    expect(capturedSignal!.aborted).toBe(true);
    expect(broker.cancelAgent).toHaveBeenCalledWith(handle.ref.agentId);

    // Let the (mock) run finish; the handle's result must resolve, never reject.
    d.resolve();
    await expect(handle.result).resolves.toBeDefined();
  });

  it('emits lifecycle queued -> running -> done for a normal run', async () => {
    const run = vi.fn(async (agentType: string) => ok('sess', agentType));
    const { supervisor, events } = makeHarness({ maxConcurrency: 2, run });

    const handle = supervisor.spawn(asRunId('run-1'), makeSpec());
    await handle.result;

    expect(lifecycleFor(events, handle.ref.agentId)).toEqual(['queued', 'running', 'done']);
  });

  it('marks failure when no provider is available', async () => {
    const run = vi.fn(async (agentType: string) => ok('sess', agentType));
    const { supervisor, events } = makeHarness({
      maxConcurrency: 2,
      run,
      provider: () => undefined,
    });

    const handle = supervisor.spawn(asRunId('run-1'), makeSpec());
    const result = await handle.result;

    expect(result.success).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(lifecycleFor(events, handle.ref.agentId)).toEqual(['queued', 'failed']);
  });
});
