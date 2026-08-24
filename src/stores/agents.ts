import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useVSCode } from '../composables/useVSCode';
import type {
  ExtToWebview,
  WebviewToExt,
  AgentTreeMsg,
  AgentEventMsg,
  AgentQuestionMsg,
  AgentQuestionResolvedMsg,
  AgentEvent,
  AgentQuestion,
  AgentAnswer,
} from '@ext/contracts/protocol';
import type { RunId, AgentId, QuestionId, AgentRef } from '@ext/contracts/ids';

/**
 * Lane #4 — webview store for concurrent sub-agents + attributed human questions.
 *
 * Unlike the chat store (which intentionally tracks a single `currentRequestId`), this store
 * is built for MANY agents running at once and MANY questions pending at once:
 *   - `agents`    — one lane per AgentId, each with its own event stream (agents never clobber
 *                   each other because everything is keyed by `ref.agentId`).
 *   - `questions` — every outstanding question, keyed by QuestionId. Several may be pending
 *                   simultaneously; each is attributed to its asking agent via `question.ref`.
 */

export type AgentLifecycleState = AgentTreeMsg['state'];

/** One agent's lane: identity + lifecycle + its own append-only event stream. */
export interface AgentLane {
  ref: AgentRef;
  state: AgentLifecycleState;
  events: AgentEvent[];
  /** Monotonic insertion order, so the UI can list lanes stably by first appearance. */
  seq: number;
}

/** A question awaiting a human answer, still carrying its wire id for correlation. */
export interface PendingQuestion {
  id: QuestionId;
  question: AgentQuestion;
  seq: number;
}

const TERMINAL_STATES: readonly AgentLifecycleState[] = ['done', 'failed', 'cancelled'];

export const useAgentsStore = defineStore('agents', () => {
  // Keyed by AgentId (branded string) — plain records keep Vue reactivity simple & testable.
  const agents = ref<Record<string, AgentLane>>({});
  // Keyed by QuestionId — MULTIPLE may be present at once.
  const questions = ref<Record<string, PendingQuestion>>({});
  let seqCounter = 0;

  /** All agent lanes, ordered by first appearance. */
  const laneList = computed<AgentLane[]>(() =>
    Object.values(agents.value).sort((a, b) => a.seq - b.seq),
  );

  /** Lanes that are still live (not done/failed/cancelled). */
  const activeLanes = computed<AgentLane[]>(() =>
    laneList.value.filter((l) => !TERMINAL_STATES.includes(l.state)),
  );

  /** Every pending question, ordered by arrival — surfaced together in the panel. */
  const pendingQuestions = computed<PendingQuestion[]>(() =>
    Object.values(questions.value).sort((a, b) => a.seq - b.seq),
  );

  const pendingQuestionCount = computed(() => pendingQuestions.value.length);
  const hasPendingQuestions = computed(() => pendingQuestions.value.length > 0);

  /** How many distinct agents are blocked waiting on the human right now. */
  const waitingAgentCount = computed(() => {
    const ids = new Set<string>();
    for (const q of pendingQuestions.value) ids.add(q.question.ref.agentId);
    return ids.size;
  });

  /** Look up the lane an event/question belongs to (may be undefined if tree not seen yet). */
  function laneFor(agentId: AgentId): AgentLane | undefined {
    return agents.value[agentId];
  }

  /** Questions attributed to one specific agent. */
  function questionsForAgent(agentId: AgentId): PendingQuestion[] {
    return pendingQuestions.value.filter((q) => q.question.ref.agentId === agentId);
  }

  function ensureLane(ref: AgentRef): AgentLane {
    const existing = agents.value[ref.agentId];
    if (existing) {
      // Keep identity fresh (e.g. parent/type may have arrived only now).
      existing.ref = ref;
      return existing;
    }
    const lane: AgentLane = { ref, state: 'queued', events: [], seq: seqCounter++ };
    agents.value[ref.agentId] = lane;
    return lane;
  }

  // ---- inbound wire handlers (from ExtToWebview) ----

  function applyTree(msg: AgentTreeMsg) {
    const lane = ensureLane(msg.ref);
    lane.state = msg.state;
  }

  function applyEvent(msg: AgentEventMsg) {
    const lane = ensureLane(msg.event.ref);
    lane.events.push(msg.event);
  }

  function applyQuestion(msg: AgentQuestionMsg) {
    // Make sure a lane exists so the question is always attributable in the UI.
    ensureLane(msg.question.ref);
    questions.value[msg.id] = { id: msg.id, question: msg.question, seq: seqCounter++ };
  }

  function applyQuestionResolved(msg: AgentQuestionResolvedMsg) {
    delete questions.value[msg.id];
  }

  /** Single entry point the webview routes every agent-scoped ExtToWebview message through. */
  function handleMessage(msg: ExtToWebview) {
    switch (msg.type) {
      case 'agentTree':
        applyTree(msg);
        break;
      case 'agentEvent':
        applyEvent(msg);
        break;
      case 'agentQuestion':
        applyQuestion(msg);
        break;
      case 'agentQuestionResolved':
        applyQuestionResolved(msg);
        break;
    }
  }

  // ---- outbound actions (post WebviewToExt) ----

  function post(message: WebviewToExt) {
    useVSCode().postMessage(message);
  }

  /** Answer one question. Optimistically drops it locally; a `resolved` msg is idempotent. */
  function answerQuestion(id: QuestionId, answer: AgentAnswer) {
    post({ type: 'answerQuestion', id, answer });
    delete questions.value[id];
  }

  /** Cancel a single agent's lane (from its cancel button). */
  function cancelAgent(agentId: AgentId) {
    post({ type: 'cancelAgent', agentId });
  }

  /** Cancel a whole run (all its agents). */
  function cancelRun(runId: RunId) {
    post({ type: 'cancelRun', runId });
  }

  /** Wipe everything — used when a new session starts. */
  function reset() {
    agents.value = {};
    questions.value = {};
    seqCounter = 0;
  }

  return {
    // state
    agents,
    questions,
    // getters
    laneList,
    activeLanes,
    pendingQuestions,
    pendingQuestionCount,
    hasPendingQuestions,
    waitingAgentCount,
    // lookups
    laneFor,
    questionsForAgent,
    // inbound
    handleMessage,
    applyTree,
    applyEvent,
    applyQuestion,
    applyQuestionResolved,
    // outbound
    answerQuestion,
    cancelAgent,
    cancelRun,
    reset,
  };
});
