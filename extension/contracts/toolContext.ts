/**
 * Lane #1 — per-agent tool context. THE KEYSTONE.
 *
 * Today `ToolRunner` holds `policy` as a mutable field and swaps it around each sub-agent
 * run (extension/agent/runner.ts). Under real parallelism that shared mutable field is the
 * containment bug: two concurrent agents clobber each other's policy. This contract dissolves
 * it — policy and all per-agent runtime state travel *in* a `ToolContext` handed to each tool
 * call, and the runner becomes stateless with respect to the running agent.
 *
 * The refactor this freezes:
 *   - AgentTool.execute(args)                  -> execute(args, ctx: ToolContext)
 *   - ToolRunner.executeTool(name, args, onEvent)
 *                                              -> executeTool(name, args, ctx)
 *   - ToolRunner no longer has setPolicy/getPolicy; policy lives on ctx.
 *
 * Depends on: ids, broker (HumanChannel), ../tools/types (ToolAccessPolicy, ToolResult).
 */

import type { AgentRef, AgentId, RunId } from './ids';
import type { ToolAccessPolicy, ToolResult } from '../tools/types';
import type { HumanChannel } from './broker';

/**
 * Domain event emitted by a tool or agent as it works. The wire layer (protocol.ts) wraps
 * this for the webview; the supervisor (#2) forwards it. Every event is agent-scoped via
 * `ref`, which is what lets the UI (#4) attribute activity to the right lane. This is the
 * agent-aware successor to orchestrator/types.ts `OrchestratorEvent` (which had no agentId).
 */
export interface AgentEvent {
  ref: AgentRef;
  type:
    | 'streamToken'
    | 'toolCallStarted'
    | 'toolCallCompleted'
    | 'toolCallFailed'
    | 'notice'        // non-blocking "I'm assuming X / I'm stuck" — surfaced, not awaited
    | 'error';
  data: unknown;
}

/**
 * Everything a tool needs at runtime, scoped to one agent, immutable for the life of the
 * call. No tool ever reaches for shared runner state again.
 */
export interface ToolContext {
  readonly runId: RunId;
  readonly agentId: AgentId;
  readonly ref: AgentRef;

  /** This agent's policy. Immutable here; concurrent agents each get their own. */
  readonly policy: ToolAccessPolicy;

  /** Per-agent cancellation. Aborting this agent fires only this signal. */
  readonly signal: AbortSignal;

  /** Emit an agent-scoped event (auto-tagged with `ref` by the implementation). */
  emit(event: Omit<AgentEvent, 'ref'>): void;

  /**
   * The ONLY path a tool may take to reach the human — approvals and free-form questions
   * both route here, through the broker (#3), so they are attributable and queued. Replaces
   * the direct `vscode.window.showWarningMessage` calls in runner.ts / permissions.ts.
   */
  readonly human: HumanChannel;
}

/** Revised tool interface. The `ctx` parameter is the whole of lane #1's surface change. */
export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  timeout?: number;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
