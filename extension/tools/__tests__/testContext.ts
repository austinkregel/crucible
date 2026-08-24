import type { ToolContext, ToolAccessPolicy, AgentEvent } from '../types';
import type { HumanChannel } from '../../contracts/broker';
import { createToolContext } from '../context';
import { asRunId, asAgentId } from '../../contracts/ids';

/**
 * Test helper: build a ToolContext for exercising a tool's execute(args, ctx) directly.
 * Defaults to a permissive policy (no path restrictions) and an auto-approving human, so
 * most tests just call `makeToolContext()`. Pass a policy to test path/approval behavior,
 * or a `sink` to capture emitted events.
 */
export function makeToolContext(
  policy: ToolAccessPolicy = { allowedTools: [], terminalAllowed: true },
  opts: { sink?: (e: AgentEvent) => void; human?: HumanChannel } = {},
): ToolContext {
  return createToolContext({
    ref: { runId: asRunId('test'), agentId: asAgentId('test'), agentType: 'test' },
    policy,
    signal: new AbortController().signal,
    human:
      opts.human ?? {
        approve: async () => ({ allowed: true, remember: false }),
        ask: async () => ({}),
      },
    sink: opts.sink ?? (() => {}),
  });
}
