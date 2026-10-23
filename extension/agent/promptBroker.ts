/**
 * Lane #3 — the human-question broker (host side).
 *
 * One human, N concurrent sub-agents. `PromptBroker` is a queue keyed by QuestionId and
 * grouped by AgentId/RunId: it mints an id per ask, posts the question to the webview, and
 * blocks the caller until the human answers, the question times out, or the asking agent/run
 * is cancelled. Cancelling one agent rejects only its outstanding questions.
 *
 * Posting is abstracted through the `post` callback so this class never touches the message
 * handler or the webview directly.
 */

import type { UserPromptBroker, AgentQuestion, AgentAnswer } from '../contracts/broker';
import type { QuestionId, AgentId, RunId } from '../contracts/ids';
import { asQuestionId } from '../contracts/ids';
import type { ExtToWebview } from '../contracts/protocol';

interface PendingQuestion {
  id: QuestionId;
  question: AgentQuestion;
  settle: (answer: AgentAnswer) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class PromptBroker implements UserPromptBroker {
  private readonly pendingById = new Map<QuestionId, PendingQuestion>();

  constructor(
    private readonly post: (msg: ExtToWebview) => void,
    private readonly generateId: () => string = defaultGenerateId,
  ) {}

  enqueue(question: AgentQuestion): Promise<AgentAnswer> {
    const id = asQuestionId(this.generateId());

    return new Promise<AgentAnswer>((resolvePromise) => {
      const entry: PendingQuestion = {
        id,
        question,
        settle: (answer: AgentAnswer) => {
          const current = this.pendingById.get(id);
          if (!current) return; // already settled
          if (current.timer) clearTimeout(current.timer);
          this.pendingById.delete(id);
          resolvePromise(answer);
        },
      };

      const { timeoutMs } = question;
      if (timeoutMs != null && timeoutMs >= 0) {
        entry.timer = setTimeout(() => {
          if (!this.pendingById.has(id)) return;
          entry.settle({ cancelled: true });
          this.post({ type: 'agentQuestionResolved', id });
        }, timeoutMs);
      }

      this.pendingById.set(id, entry);
      this.post({ type: 'agentQuestion', id, question });
    });
  }

  resolve(id: QuestionId, answer: AgentAnswer): void {
    const entry = this.pendingById.get(id);
    if (!entry) return; // unknown / already-settled id ignored
    entry.settle(answer);
    this.post({ type: 'agentQuestionResolved', id });
  }

  cancelAgent(agentId: AgentId): void {
    this.cancelMatching((entry) => entry.question.ref.agentId === agentId);
  }

  cancelRun(runId: RunId): void {
    this.cancelMatching((entry) => entry.question.ref.runId === runId);
  }

  pending(): Array<{ id: QuestionId; question: AgentQuestion }> {
    return Array.from(this.pendingById.values(), (entry) => ({
      id: entry.id,
      question: entry.question,
    }));
  }

  private cancelMatching(predicate: (entry: PendingQuestion) => boolean): void {
    // Snapshot first: settle() mutates the map.
    const matched = Array.from(this.pendingById.values()).filter(predicate);
    for (const entry of matched) {
      entry.settle({ cancelled: true });
      this.post({ type: 'agentQuestionResolved', id: entry.id });
    }
  }
}

function defaultGenerateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}
