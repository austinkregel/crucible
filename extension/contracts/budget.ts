/**
 * Lane #5 — per-agent budgets.
 *
 * Replaces the hard-coded MAX_SUBAGENT_ITERATIONS = 20 and the 300_000ms tool timeout with
 * per-agent-type budgets. All limits are optional; an omitted limit is unbounded. Budgets are
 * per agent, so N parallel agents are each bounded independently.
 *
 * CROSS-LANE COUPLING (the only one): wall-clock must NOT count time an agent spends blocked
 * on a human. The HumanChannel implementation (#3) calls markBlocked() before enqueuing a
 * question and markUnblocked() after it resolves. That is the entire seam between #3 and #5.
 *
 * Depends on: ids.
 */

import type { AgentRef } from './ids';

/** All optional; omitted = unbounded. Resolved per agent type from config, with a default. */
export interface AgentBudget {
  /** Max agent loop iterations (turns). Supersedes MAX_SUBAGENT_ITERATIONS. */
  maxIterations?: number;
  /** Max total tool invocations. */
  maxToolCalls?: number;
  /** Max tokens (in+out, estimated) charged across the agent's run. */
  maxTokens?: number;
  /** Max wall-clock, EXCLUDING time blocked on the human. */
  maxWallClockMs?: number;
  /** Optional cost ceiling in USD, if provider pricing is known. */
  maxCostUsd?: number;
}

export type BudgetLimit = keyof AgentBudget;

export interface BudgetStatus {
  exhausted: boolean;
  /** Which limit tripped, when exhausted. */
  reason?: BudgetLimit;
  /** Remaining headroom per limit (Infinity where unbounded). Snapshot, for UI/logs. */
  remaining: Record<BudgetLimit, number>;
}

/**
 * Per-agent tracker. Created by the supervisor (#2) when it spawns an agent, consulted by the
 * agent loop each iteration/tool call. Pure logic — no VS Code, fully unit-testable against
 * this interface alone.
 */
export interface BudgetTracker {
  readonly ref: AgentRef;
  readonly budget: AgentBudget;

  chargeIteration(): void;
  chargeToolCall(): void;
  chargeTokens(estimated: number): void;
  chargeCost(usd: number): void;

  /** Called by the loop before continuing; if exhausted, the loop stops the agent. */
  check(): BudgetStatus;

  /** #3 coupling: freeze wall-clock accrual while blocked on the human. */
  markBlocked(): void;
  markUnblocked(): void;

  snapshot(): BudgetStatus;
}

/**
 * Config shape. Contributed under `crucible.subagents.budgets` in package.json; `default`
 * applies to any agent type without a specific entry.
 *
 *   "crucible.subagents.budgets": {
 *     "default":  { "maxIterations": 40, "maxWallClockMs": 600000 },
 *     "explore":  { "maxIterations": 60 },
 *     "general":  { "maxIterations": 80, "maxToolCalls": 200 }
 *   }
 */
export interface BudgetConfig {
  default: AgentBudget;
  [agentType: string]: AgentBudget;
}
