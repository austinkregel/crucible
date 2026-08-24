import type { LLMProvider } from '../providers/types';
import type {
  SubAgentSupervisor,
  SubAgentSpec,
  AgentHandle,
  AgentLifecycle,
  SupervisorOptions,
} from '../contracts/supervisor';
import type { RunId, AgentId, AgentRef } from '../contracts/ids';
import { asAgentId } from '../contracts/ids';
import type { UserPromptBroker } from '../contracts/broker';
import type { BudgetConfig } from '../contracts/budget';
import type { AgentRegistry } from './registry';
import type { SubAgentRunner, SubAgentResult } from './runner';
import { DefaultBudgetTracker } from './budgetTracker';
import { resolveBudget } from './budgetConfig';
import { createHumanChannel } from './humanChannel';

/**
 * Runs sub-agents as a bounded concurrent pool. Each agent gets its own AbortController,
 * BudgetTracker, and broker-backed HumanChannel, and its own ToolContext (built inside the
 * runner) — so parallel agents never share mutable state. This is the piece that turns the
 * per-agent isolation from lane #1 into actual parallelism.
 */
export class DefaultSupervisor implements SubAgentSupervisor {
  private slotsInUse = 0;
  private waiters: Array<() => void> = [];
  private managed = new Map<AgentId, { handle: AgentHandle; controller: AbortController; runId: RunId }>();

  constructor(
    private runner: SubAgentRunner,
    private registry: AgentRegistry,
    private broker: UserPromptBroker,
    private getProvider: () => { provider: LLMProvider; model: string } | undefined,
    private budgetConfig: BudgetConfig,
    private options: SupervisorOptions,
  ) {}

  spawn(runId: RunId, spec: SubAgentSpec): AgentHandle {
    const agentId = asAgentId(generateId());
    const ref: AgentRef = {
      runId,
      agentId,
      parentAgentId: spec.parentAgentId,
      agentType: spec.agentType,
    };
    const controller = new AbortController();

    let lifecycle: AgentLifecycle = 'queued';
    const setState = (s: AgentLifecycle) => {
      lifecycle = s;
      this.options.onEvent({ kind: 'lifecycle', ref, state: s });
    };
    setState('queued');

    const budget = new DefaultBudgetTracker(ref, spec.budget ?? resolveBudget(this.budgetConfig, spec.agentType));
    const human = createHumanChannel(this.broker, ref, budget);

    const result: Promise<SubAgentResult> = (async () => {
      await this.acquireSlot();
      try {
        if (controller.signal.aborted) {
          setState('cancelled');
          return cancelledResult(agentId, spec.agentType);
        }
        const cfg = this.getProvider();
        if (!cfg) {
          setState('failed');
          return failedResult(agentId, spec.agentType, 'No LLM provider available for sub-agent execution.');
        }
        setState('running');
        const r = await this.runner.run(
          spec.agentType,
          spec.prompt,
          cfg.provider,
          cfg.model,
          undefined,
          controller.signal,
          {
            ref,
            human,
            budget,
            onAgentEvent: (event) => this.options.onEvent({ kind: 'agentEvent', event }),
          },
        );
        setState(controller.signal.aborted ? 'cancelled' : r.success ? 'done' : 'failed');
        return r;
      } catch (err: any) {
        setState('failed');
        return failedResult(agentId, spec.agentType, err?.message ?? String(err));
      } finally {
        this.releaseSlot();
      }
    })();

    const handle: AgentHandle = {
      ref,
      signal: controller.signal,
      result,
      state: () => lifecycle,
      cancel: () => {
        controller.abort();
        this.broker.cancelAgent(agentId);
      },
    };
    this.managed.set(agentId, { handle, controller, runId });
    return handle;
  }

  spawnMany(runId: RunId, specs: SubAgentSpec[]): AgentHandle[] {
    return specs.map((spec) => this.spawn(runId, spec));
  }

  handles(runId?: RunId): AgentHandle[] {
    const all = Array.from(this.managed.values());
    return (runId ? all.filter((e) => e.runId === runId) : all).map((e) => e.handle);
  }

  cancel(agentId: AgentId): void {
    this.managed.get(agentId)?.handle.cancel();
  }

  cancelRun(runId: RunId): void {
    for (const entry of this.managed.values()) {
      if (entry.runId === runId) entry.controller.abort();
    }
    this.broker.cancelRun(runId);
  }

  cancelAll(): void {
    for (const entry of this.managed.values()) entry.controller.abort();
  }

  /** Acquire a concurrency slot, waiting in FIFO order when the pool is full. */
  private async acquireSlot(): Promise<void> {
    if (this.slotsInUse < this.options.maxConcurrency) {
      this.slotsInUse++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    // The releaser hands this slot off directly; slotsInUse already accounts for it.
  }

  /** Release a slot, handing it directly to the next waiter if one is queued. */
  private releaseSlot(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.slotsInUse--;
    }
  }
}

function cancelledResult(agentId: string, agentName: string): SubAgentResult {
  return { sessionId: agentId, agentName, output: '', messages: [], success: false, error: 'Cancelled' };
}

function failedResult(agentId: string, agentName: string, error: string): SubAgentResult {
  return { sessionId: agentId, agentName, output: '', messages: [], success: false, error };
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}
