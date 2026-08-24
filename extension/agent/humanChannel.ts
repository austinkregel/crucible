/**
 * Lane #3 — the tool-facing `HumanChannel`.
 *
 * `createHumanChannel` binds a broker to one agent's `AgentRef` and returns the narrow,
 * blocking surface a tool sees via `ToolContext.human`. `ask()` is the general question;
 * `approve()` is the approval fast-path that maps an ['Allow','Allow & Remember','Deny']
 * choice to a structured `ApprovalDecision`.
 *
 * THE ONE CROSS-LANE COUPLING (#3 ↔ #5): while an agent is blocked on a human its wall-clock
 * budget must pause. So before enqueuing we call `tracker?.markBlocked()`, and in a `finally`
 * after the question settles we call `tracker?.markUnblocked()`. That is the entire seam.
 */

import type {
  UserPromptBroker,
  HumanChannel,
  AgentQuestion,
  AgentAnswer,
  ApprovalDecision,
} from '../contracts/broker';
import type { AgentRef } from '../contracts/ids';
import type { BudgetTracker } from '../contracts/budget';

const APPROVAL_ALLOW = 'Allow';
const APPROVAL_ALLOW_REMEMBER = 'Allow & Remember';
const APPROVAL_DENY = 'Deny';

export function createHumanChannel(
  broker: UserPromptBroker,
  ref: AgentRef,
  tracker?: BudgetTracker,
): HumanChannel {
  async function enqueueBlocked(question: AgentQuestion): Promise<AgentAnswer> {
    tracker?.markBlocked();
    try {
      return await broker.enqueue(question);
    } finally {
      tracker?.markUnblocked();
    }
  }

  return {
    async approve(req): Promise<ApprovalDecision> {
      const answer = await enqueueBlocked({
        ...req,
        ref,
        kind: 'approval',
        options: req.options ?? [APPROVAL_ALLOW, APPROVAL_ALLOW_REMEMBER, APPROVAL_DENY],
      });

      if (answer.cancelled) {
        return { allowed: false, remember: false };
      }

      const remember = answer.remember === true || answer.choice === APPROVAL_ALLOW_REMEMBER;
      const allowed = answer.choice === APPROVAL_ALLOW || answer.choice === APPROVAL_ALLOW_REMEMBER;
      return { allowed, remember };
    },

    ask(req): Promise<AgentAnswer> {
      return enqueueBlocked({ ...req, ref });
    },
  };
}
