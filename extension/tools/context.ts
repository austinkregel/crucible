import type { ToolAccessPolicy } from './types';
import type { ToolContext, AgentEvent } from '../contracts/toolContext';
import type { HumanChannel } from '../contracts/broker';
import type { AgentRef } from '../contracts/ids';

/**
 * Builds a per-agent ToolContext. This is the mechanism that replaces the old shared,
 * mutable `ToolRunner.policy`: every agent (top-level or sub-agent) gets its OWN context,
 * so two agents running at once can never observe or clobber each other's policy.
 *
 * `sink` receives fully-formed AgentEvents (ref already attached); callers bridge it to
 * whatever channel they forward events on (the orchestrator's onEvent, the supervisor, etc).
 */
export function createToolContext(params: {
  ref: AgentRef;
  policy: ToolAccessPolicy;
  signal: AbortSignal;
  human: HumanChannel;
  sink: (event: AgentEvent) => void;
}): ToolContext {
  const { ref, policy, signal, human, sink } = params;
  return {
    runId: ref.runId,
    agentId: ref.agentId,
    ref,
    policy,
    signal,
    human,
    emit(event) {
      sink({ ...event, ref });
    },
  };
}
