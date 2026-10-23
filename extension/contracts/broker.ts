/**
 * Lane #3 — the human-question broker.
 *
 * One human, N concurrent sub-agents that may each block on a question. The broker is a
 * queue keyed by QuestionId and grouped by AgentId: it serializes asks to the user fairly,
 * carries attribution so the user always sees *which* agent is asking, and lets a cancelled
 * agent's outstanding questions be rejected without touching the others.
 *
 * Two surfaces:
 *   - HumanChannel  — what a tool sees (via ToolContext.human). Narrow, blocking.
 *   - UserPromptBroker — the host-side singleton. The message handler resolves it when the
 *     webview posts an answer.
 *
 * Depends on: ids.
 */

import type { AgentRef, QuestionId, AgentId, RunId } from './ids';

/** Approval is a question with fixed options; kept as its own kind for a tighter UI. */
export type QuestionKind = 'approval' | 'choice' | 'text';

export interface AgentQuestion {
  kind: QuestionKind;
  /** Who is asking — mandatory. Drives attribution + cancellation grouping. */
  ref: AgentRef;
  /** Human-readable prompt. For approvals, a summary of the action. */
  prompt: string;
  /** For 'approval'/'choice': the selectable options. Omitted for 'text'. */
  options?: string[];
  /**
   * Optional auto-resolve deadline. Distinct from budget wall-clock: this is "the user never
   * answered". Null/absent = wait indefinitely (agent stays blocked, budget paused).
   */
  timeoutMs?: number;
}

export interface AgentAnswer {
  /** Chosen option (for approval/choice) or null when cancelled/timed out. */
  choice?: string | null;
  /** Free text (for 'text'). */
  text?: string;
  /** "Allow & Remember" semantics — approval only. */
  remember?: boolean;
  /** True when the agent was cancelled or the question timed out rather than answered. */
  cancelled?: boolean;
}

/** Structured decision for the approval fast-path (thin wrapper over AgentAnswer). */
export interface ApprovalDecision {
  allowed: boolean;
  remember: boolean;
}

/** Tool-facing surface. Both calls BLOCK until the human responds (or cancel/timeout). */
export interface HumanChannel {
  /** Approval gate — replaces the native modal in runner.ts/permissions.ts. */
  approve(req: Omit<AgentQuestion, 'kind'>): Promise<ApprovalDecision>;
  /** Free-form / multiple-choice question — backs the new `ask_user` tool. */
  ask(req: AgentQuestion): Promise<AgentAnswer>;
}

/** Host-side broker. One instance per session; injected wherever HumanChannel is built. */
export interface UserPromptBroker {
  /** Enqueue a question, post it to the webview, and block until resolved. Mints QuestionId. */
  enqueue(question: AgentQuestion): Promise<AgentAnswer>;
  /** Called by the message handler when the webview posts an answer. */
  resolve(id: QuestionId, answer: AgentAnswer): void;
  /** Reject every outstanding question for one agent (agent cancelled). */
  cancelAgent(agentId: AgentId): void;
  /** Reject every outstanding question for a whole run (run cancelled). */
  cancelRun(runId: RunId): void;
  /** Currently-blocked questions, e.g. for a "3 agents waiting on you" UI affordance. */
  pending(): Array<{ id: QuestionId; question: AgentQuestion }>;
}
