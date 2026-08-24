/**
 * Shared identity spine for the concurrent sub-agent system.
 *
 * Branded string types so the compiler refuses to swap a RunId for an AgentId for a
 * QuestionId at a call site — the three flow through every other contract and the wire,
 * and confusing them is the most likely cross-lane bug.
 *
 * Type-only. Constructors live wherever ids are minted (the supervisor for AgentId, the
 * broker for QuestionId, the message handler for RunId). Implementers cast at the mint
 * site; consumers never construct.
 */

export type Brand<T, B extends string> = T & { readonly __brand: B };

/** One top-level user request / agent run. Was the untyped `requestId`. */
export type RunId = Brand<string, 'RunId'>;

/**
 * One agent within a run. The top-level (user-facing) agent is the run's *root* agent and
 * also has an AgentId. Sub-agents carry `parentAgentId` to form the run's agent tree, which
 * the UI (#4) renders as lanes and the supervisor (#2) uses for cancellation cascades.
 */
export type AgentId = Brand<string, 'AgentId'>;

/** One outstanding question to the human. Minted by the broker (#3), one per ask. */
export type QuestionId = Brand<string, 'QuestionId'>;

/** Cast helpers — use ONLY at the mint site. Kept here so branding stays centralized. */
export const asRunId = (s: string): RunId => s as RunId;
export const asAgentId = (s: string): AgentId => s as AgentId;
export const asQuestionId = (s: string): QuestionId => s as QuestionId;

/** Where an agent sits in the run tree. Every agent-scoped event/question carries this. */
export interface AgentRef {
  runId: RunId;
  agentId: AgentId;
  /** Absent for the root agent; set for every spawned sub-agent. */
  parentAgentId?: AgentId;
  /** Profile/type name, e.g. "explore", "general". For display + budget lookup. */
  agentType: string;
}
