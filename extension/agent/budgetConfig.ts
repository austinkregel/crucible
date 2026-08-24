import * as vscode from 'vscode';
import type { AgentBudget, BudgetConfig } from '../contracts/budget';

/**
 * Built-in defaults, used when `crucible.subagents.budgets` is absent. These mirror the example
 * in contracts/budget.ts and replace the old hard-coded MAX_SUBAGENT_ITERATIONS / tool timeout.
 */
export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  default: { maxIterations: 40, maxWallClockMs: 600000 },
  explore: { maxIterations: 60 },
  general: { maxIterations: 80, maxToolCalls: 200 },
};

/**
 * Resolve the effective budget for one agent type by merging its type-specific entry over the
 * `default` entry. Type-specific limits win; limits present only on `default` are inherited.
 */
export function resolveBudget(config: BudgetConfig, agentType: string): AgentBudget {
  const base = config.default ?? {};
  const specific = config[agentType];
  if (!specific || specific === base) {
    return { ...base };
  }
  return { ...base, ...specific };
}

/**
 * Read `crucible.subagents.budgets` from the workspace configuration, falling back to
 * DEFAULT_BUDGET_CONFIG when unset. Always guarantees a `default` entry so resolveBudget is safe.
 */
export function loadBudgetConfig(): BudgetConfig {
  const config = vscode.workspace.getConfiguration('crucible');
  const raw = config.get<BudgetConfig | undefined>('subagents.budgets', undefined);

  if (!raw || typeof raw !== 'object' || !raw.default) {
    return DEFAULT_BUDGET_CONFIG;
  }

  return raw;
}
