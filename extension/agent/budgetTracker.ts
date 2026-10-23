import type { AgentRef } from '../contracts/ids';
import type {
  AgentBudget,
  BudgetLimit,
  BudgetStatus,
  BudgetTracker,
} from '../contracts/budget';

/** Order in which limits are checked; the first tripped limit becomes `reason`. */
const LIMIT_ORDER: BudgetLimit[] = [
  'maxIterations',
  'maxToolCalls',
  'maxTokens',
  'maxWallClockMs',
  'maxCostUsd',
];

/**
 * Pure, per-agent budget tracker. No VS Code — deterministic and unit-testable.
 *
 * Wall-clock accounting tracks ACTIVE elapsed time only. The clock runs while the agent is
 * working and is paused between markBlocked()/markUnblocked() (time spent blocked on a human,
 * see the #3<->#5 coupling in contracts/README.md). A `now` function may be injected so tests
 * can drive time deterministically; it defaults to Date.now.
 */
export class DefaultBudgetTracker implements BudgetTracker {
  readonly ref: AgentRef;
  readonly budget: AgentBudget;

  private readonly now: () => number;

  private iterations = 0;
  private toolCalls = 0;
  private tokens = 0;
  private costUsd = 0;

  /** Active wall-clock accumulated across resumed intervals (ms). */
  private accumulatedMs = 0;
  /** Timestamp the current active interval started, or null while blocked/paused. */
  private runningSince: number | null;
  /** How many overlapping blocks are outstanding (markBlocked can nest). */
  private blockDepth = 0;

  constructor(ref: AgentRef, budget: AgentBudget, now: () => number = Date.now) {
    this.ref = ref;
    this.budget = budget;
    this.now = now;
    // The clock starts running the moment the tracker is created (agent is active).
    this.runningSince = this.now();
  }

  chargeIteration(): void {
    this.iterations += 1;
  }

  chargeToolCall(): void {
    this.toolCalls += 1;
  }

  chargeTokens(estimated: number): void {
    this.tokens += estimated;
  }

  chargeCost(usd: number): void {
    this.costUsd += usd;
  }

  markBlocked(): void {
    this.blockDepth += 1;
    if (this.blockDepth > 1) {
      // Already paused by an outer block; nothing further to freeze.
      return;
    }
    // Fold the active interval into the accumulator and stop the clock.
    if (this.runningSince !== null) {
      this.accumulatedMs += this.now() - this.runningSince;
      this.runningSince = null;
    }
  }

  markUnblocked(): void {
    if (this.blockDepth === 0) {
      // Defensive: unmatched unblock is a no-op rather than a crash.
      return;
    }
    this.blockDepth -= 1;
    if (this.blockDepth === 0) {
      // Resume the clock for the now-active agent.
      this.runningSince = this.now();
    }
  }

  check(): BudgetStatus {
    return this.snapshot();
  }

  snapshot(): BudgetStatus {
    const usage: Record<BudgetLimit, number> = {
      maxIterations: this.iterations,
      maxToolCalls: this.toolCalls,
      maxTokens: this.tokens,
      maxWallClockMs: this.activeElapsedMs(),
      maxCostUsd: this.costUsd,
    };

    const remaining = {} as Record<BudgetLimit, number>;
    let reason: BudgetLimit | undefined;

    for (const limit of LIMIT_ORDER) {
      const cap = this.budget[limit];
      if (cap === undefined) {
        remaining[limit] = Infinity;
        continue;
      }
      remaining[limit] = cap - usage[limit];
      if (reason === undefined && usage[limit] >= cap) {
        reason = limit;
      }
    }

    return {
      exhausted: reason !== undefined,
      reason,
      remaining,
    };
  }

  /** Active wall-clock so far (ms): accumulated intervals plus the currently running one. */
  private activeElapsedMs(): number {
    const live = this.runningSince === null ? 0 : this.now() - this.runningSince;
    return this.accumulatedMs + live;
  }
}
