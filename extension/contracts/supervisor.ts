/**
 * Lane #2 — the concurrent sub-agent supervisor.
 *
 * Replaces the sequential spawn path (TaskTool -> SubAgentRunner.run, one at a time) and the
 * dead runConcurrent(). Runs a bounded pool of agents in parallel, each with its own
 * AbortController, its own BudgetTracker (#5), and its own ToolContext (#1). Emits
 * agent-scoped lifecycle + AgentEvents that the message handler forwards to the webview (#4).
 *
 * This is the serial spine with #1: it cannot exist until ToolContext (#1) does, because
 * spawning an agent = building its ToolContext. Its *interface*, though, is what #4 renders
 * and #5 attaches budgets to, so it is frozen here in Phase 0.
 *
 * Depends on: ids, toolContext (AgentEvent), budget (AgentBudget), ../agent/runner (SubAgentResult).
 */

import type { AgentId, AgentRef, RunId } from './ids';
import type { AgentEvent } from './toolContext';
import type { AgentBudget } from './budget';
import type { SubAgentResult } from '../agent/runner';

export interface SubAgentSpec {
  agentType: string;
  prompt: string;
  description: string;
  /** Root agent's id when a sub-agent spawns (kept locked closed today — see README). */
  parentAgentId?: AgentId;
  /** Budget override; falls back to the per-type config default when omitted. */
  budget?: AgentBudget;
}

export type AgentLifecycle = 'queued' | 'running' | 'blocked' | 'done' | 'failed' | 'cancelled';

/** Handle to one running agent. The supervisor returns these; the UI keys lanes off `ref`. */
export interface AgentHandle {
  readonly ref: AgentRef;
  readonly signal: AbortSignal;
  /** Resolves with the agent's result; never rejects — failure is `success: false`. */
  readonly result: Promise<SubAgentResult>;
  state(): AgentLifecycle;
  /** Cooperative cancel: aborts the signal and rejects the agent's outstanding questions. */
  cancel(): void;
}

export interface SupervisorOptions {
  /** Max agents running at once. Excess spawns queue. */
  maxConcurrency: number;
  /** Forwards every agent-scoped event (lifecycle + AgentEvent) to the host/webview. */
  onEvent: (event: SupervisorEvent) => void;
}

/** Lifecycle transitions ride alongside the domain AgentEvents on one channel. */
export type SupervisorEvent =
  | { kind: 'lifecycle'; ref: AgentRef; state: AgentLifecycle }
  | { kind: 'agentEvent'; event: AgentEvent };

export interface SubAgentSupervisor {
  /** Spawn one agent under a run. Queues if the pool is full; returns immediately. */
  spawn(runId: RunId, spec: SubAgentSpec): AgentHandle;
  /** Spawn many; the honest replacement for runConcurrent(). */
  spawnMany(runId: RunId, specs: SubAgentSpec[]): AgentHandle[];
  /** All live handles, e.g. for a run-level "agents in flight" view. */
  handles(runId?: RunId): AgentHandle[];
  /** Cancel one agent / a whole run / everything. */
  cancel(agentId: AgentId): void;
  cancelRun(runId: RunId): void;
  cancelAll(): void;
}
